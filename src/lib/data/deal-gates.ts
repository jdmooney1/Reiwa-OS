// ============================================================================
// Gate orchestration: loads real rows for the pure evaluator
// (src/lib/deal-gates/evaluate.ts), and writes the clearance/override
// records it decides are warranted. The evaluator decides; this module is
// the only thing that acts on that decision — the single source of gate
// logic stays in one language, in one place (docs/24 §A).
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { evaluateStageExit, evaluateActionGate, type ActionGateResult } from "@/lib/deal-gates/evaluate";
import type { DocTypeRow, DealDocumentRow, DealInvestorRow, DealFlags } from "@/lib/deal-gates/types";

export interface GateContext {
  docTypes: DocTypeRow[];
  dealDocuments: DealDocumentRow[];
  investors: DealInvestorRow[];
  flags: DealFlags;
}

export async function loadGateContext(tx: Queryable, opportunityId: string): Promise<GateContext> {
  const docTypeRows = await tx.query<Record<string, any>>(
    "select key, stage, scope, gate_kind, gate_action, gate_condition, is_active from doc_type");
  const docTypes: DocTypeRow[] = docTypeRows.rows.map((r) => ({
    key: r.key, stage: Number(r.stage) as 0 | 1 | 2 | 3 | 4, scope: r.scope, gateKind: r.gate_kind,
    gateAction: r.gate_action, gateCondition: r.gate_condition, isActive: r.is_active,
  }));

  const docRows = await tx.query<Record<string, any>>(
    "select doc_type_key, deal_investor_id, status from deal_document where opportunity_id = $1", [opportunityId]);
  const dealDocuments: DealDocumentRow[] = docRows.rows.map((r) => ({
    docTypeKey: r.doc_type_key, dealInvestorId: r.deal_investor_id, status: r.status,
  }));

  const invRows = await tx.query<Record<string, any>>(
    "select deal_investor_id, status, investor_type from deal_investor where opportunity_id = $1", [opportunityId]);
  const investors: DealInvestorRow[] = invRows.rows.map((r) => ({
    dealInvestorId: r.deal_investor_id, status: r.status, investorType: r.investor_type,
  }));

  const oppRow = await tx.query<{ flags: DealFlags }>(
    "select flags from opportunities where opportunity_id = $1", [opportunityId]);
  const flags = oppRow.rows[0]?.flags ?? {};

  return { docTypes, dealDocuments, investors, flags };
}

export interface ReadinessSummaryRow {
  stage: 0 | 1 | 2 | 3 | 4;
  gateDocTotal: number;
  gateDocCleared: number;
  investorRequirement: { applicable: boolean; satisfied: boolean; detail: string };
  satisfied: boolean;
}

/** One row per stage 0-3 — "Stage 1: 5 of 7 gate documents final" etc. Stage 4
 * has no exit rule (there is nowhere to leave it to), so it is not scored. */
export async function readinessSummary(session: Session, opportunityId: string): Promise<ReadinessSummaryRow[]> {
  return withSession(session, async (tx) => {
    const ctx = await loadGateContext(tx, opportunityId);
    const rows: ReadinessSummaryRow[] = [];
    for (const stage of [0, 1, 2, 3] as const) {
      const exit = evaluateStageExit(stage, ctx.docTypes, ctx.dealDocuments, ctx.investors, ctx.flags);
      const gateTypes = ctx.docTypes.filter((dt) => dt.scope === "deal" && dt.stage === stage && dt.gateKind === "transition" && dt.isActive);
      rows.push({
        stage,
        gateDocTotal: gateTypes.length,
        gateDocCleared: gateTypes.length - exit.blockingDealDocs.length,
        investorRequirement: exit.investorRequirement,
        satisfied: exit.satisfied,
      });
    }
    return rows;
  });
}

/**
 * Advance or retreat document_stage by exactly one step. Multi-step moves
 * are not supported from here — each step's own exit gate is checked and
 * cleared (or overridden) on its own record, so the clearance history says
 * which specific stage was left and on what basis, rather than one record
 * covering a jump.
 *
 * Stage 4 is refused here — reaching Hold happens only through
 * convertToAsset() (src/lib/data/conversion.ts), which grants its own
 * Stage-4 clearance as part of the acquisition event, per I4.
 */
export async function transitionDocumentStage(
  session: Session, opportunityId: string, direction: "forward" | "backward",
  overrideReason?: string | null,
): Promise<void> {
  return withSession(session, async (tx) => {
    const oppRes = await tx.query<{ document_stage: number; org_id: string }>(
      "select document_stage, org_id from opportunities where opportunity_id = $1", [opportunityId]);
    const opp = oppRes.rows[0];
    if (!opp) throw new Error("Opportunity not found or not permitted");
    const fromStage = Number(opp.document_stage);
    const toStage = direction === "forward" ? fromStage + 1 : fromStage - 1;
    if (toStage < 0) throw new AppError("Deal readiness is already at Screen (Stage 0).");
    if (toStage > 3) {
      throw new AppError(
        "Reaching Hold (Stage 4) happens automatically when the opportunity converts to an asset — use Convert to Asset.",
      );
    }

    if (direction === "backward") {
      if (!overrideReason) throw new AppError("Moving deal readiness backward requires an override reason.");
      await tx.query(
        `insert into stage_transition (org_id, opportunity_id, from_stage, to_stage, override, override_reason, recorded_by)
         values ($1,$2,$3,$4,true,$5,$6)`,
        [opp.org_id, opportunityId, fromStage, toStage, overrideReason, session.userId]);
    } else {
      const ctx = await loadGateContext(tx, opportunityId);
      const exit = evaluateStageExit(fromStage as 0 | 1 | 2 | 3, ctx.docTypes, ctx.dealDocuments, ctx.investors, ctx.flags);
      if (exit.satisfied) {
        await tx.query(
          "insert into stage_transition (org_id, opportunity_id, from_stage, to_stage, recorded_by) values ($1,$2,$3,$4,$5)",
          [opp.org_id, opportunityId, fromStage, toStage, session.userId]);
      } else if (overrideReason) {
        // RLS on stage_transition (0041) enforces admin/ic_member for an
        // override=true row — a non-privileged session is refused there,
        // not here.
        await tx.query(
          `insert into stage_transition (org_id, opportunity_id, from_stage, to_stage, override, override_reason, recorded_by)
           values ($1,$2,$3,$4,true,$5,$6)`,
          [opp.org_id, opportunityId, fromStage, toStage, overrideReason, session.userId]);
      } else {
        const blocking = [
          ...exit.blockingDealDocs,
          ...(exit.investorRequirement.satisfied ? [] : [exit.investorRequirement.detail]),
        ];
        throw new AppError(
          `Stage ${fromStage} is not yet clear to leave: ${blocking.join("; ")}. Provide an override reason to proceed anyway.`,
        );
      }
    }

    await tx.query(
      "update opportunities set document_stage = $1, document_stage_updated_at = now() where opportunity_id = $2",
      [toStage, opportunityId]);
  });
}

/** Read-only: is `action` currently unblocked? For a UI deciding whether to
 * offer a control, or an action deciding whether to refuse before writing
 * anything the database would refuse anyway. */
export async function checkActionGate(
  session: Session, opportunityId: string, action: string, dealInvestorId: string | null = null,
): Promise<ActionGateResult> {
  return withSession(session, async (tx) => {
    const ctx = await loadGateContext(tx, opportunityId);
    return evaluateActionGate(action, ctx.docTypes, ctx.dealDocuments, ctx.investors, dealInvestorId);
  });
}

/** Log an override of an action gate. Permission (admin/ic_member) is
 * enforced by RLS on gate_override (0041), not duplicated here. */
export async function recordActionGateOverride(
  session: Session, opportunityId: string, action: string, reason: string,
  opts: { gateDocTypeKey?: string | null; dealInvestorId?: string | null } = {},
): Promise<void> {
  return withSession(session, async (tx) => {
    const org = await tx.query<{ org_id: string }>("select org_id from opportunities where opportunity_id = $1", [opportunityId]);
    if (!org.rows[0]) throw new Error("Opportunity not found or not permitted");
    await tx.query(
      `insert into gate_override (org_id, opportunity_id, deal_investor_id, gate_doc_type_key, action, reason, recorded_by)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [org.rows[0].org_id, opportunityId, opts.dealInvestorId ?? null, opts.gateDocTypeKey ?? null, action, reason, session.userId]);
  });
}
