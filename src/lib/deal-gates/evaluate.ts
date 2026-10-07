// ============================================================================
// The gate evaluator — the SINGLE source of gate logic (docs/24 §A, Session
// 2's decision that the database never re-derives this). Pure functions, no
// DB import, same discipline as src/lib/dd/progress.ts and
// src/lib/memo/compose.ts: given the catalogue and the deal's own rows, say
// what is satisfied and what is blocking. Nothing here writes anything —
// the caller (src/lib/data/deal-gates.ts) decides what to do with the
// answer, including writing the stage_transition clearance record the
// database checks for.
// ============================================================================
import {
  type DocTypeRow, type DealDocumentRow, type DealInvestorRow, type DealFlags,
  conditionHolds, isClearedStatus, investorStatusAtLeast,
} from "./types";

function isCleared(
  docs: DealDocumentRow[], docTypeKey: string, dealInvestorId: string | null,
): boolean {
  const row = docs.find((d) => d.docTypeKey === docTypeKey && d.dealInvestorId === dealInvestorId);
  return isClearedStatus(row?.status);
}

export interface StageExitResult {
  satisfied: boolean;
  /** Deal-scoped transition-gated doc_type keys not yet Final/Signed. */
  blockingDealDocs: string[];
  /** The investor-scoped rule for this stage, if one applies (Stage 2/3 only). */
  investorRequirement: { applicable: boolean; satisfied: boolean; detail: string };
}

/**
 * Can the deal leave `stage`? Checks every deal-scoped transition gate tagged
 * to this stage, plus the investor-scoped rule the brief defines for leaving
 * Stage 2 and Stage 3 specifically (no equivalent rule exists for 0, 1 or 4 —
 * not inventing one).
 */
export function evaluateStageExit(
  stage: 0 | 1 | 2 | 3 | 4,
  docTypes: DocTypeRow[],
  dealDocuments: DealDocumentRow[],
  investors: DealInvestorRow[],
  flags: DealFlags,
): StageExitResult {
  const dealGateTypes = docTypes.filter((dt) =>
    dt.scope === "deal" && dt.stage === stage && dt.gateKind === "transition" && dt.isActive
    && conditionHolds(dt.gateCondition, flags, null));
  const blockingDealDocs = dealGateTypes
    .filter((dt) => !isCleared(dealDocuments, dt.key, null))
    .map((dt) => dt.key);

  const investorGateTypes = docTypes.filter((dt) =>
    dt.scope === "investor" && dt.stage === stage && dt.gateKind === "transition" && dt.isActive);

  let investorRequirement: StageExitResult["investorRequirement"] = { applicable: false, satisfied: true, detail: "" };

  if (investorGateTypes.length > 0 && stage === 2) {
    const qualifying = investors.filter((inv) =>
      investorStatusAtLeast(inv.status, "soft_circled")
      && investorGateTypes.every((dt) =>
        !conditionHolds(dt.gateCondition, flags, inv.investorType) || isCleared(dealDocuments, dt.key, inv.dealInvestorId)));
    investorRequirement = {
      applicable: true,
      satisfied: qualifying.length > 0,
      detail: qualifying.length > 0
        ? ""
        : "No investor at Soft-circled or later has every investor-scoped Stage 2 document Final/Signed",
    };
  } else if (investorGateTypes.length > 0 && stage === 3) {
    const committed = investors.filter((inv) => inv.status === "committed");
    const allSatisfy = committed.every((inv) =>
      investorGateTypes.every((dt) =>
        !conditionHolds(dt.gateCondition, flags, inv.investorType) || isCleared(dealDocuments, dt.key, inv.dealInvestorId)));
    investorRequirement = {
      applicable: true,
      satisfied: allSatisfy,
      detail: allSatisfy ? "" : "Not every committed investor has every investor-scoped gate document Final/Signed",
    };
  }

  return {
    satisfied: blockingDealDocs.length === 0 && investorRequirement.satisfied,
    blockingDealDocs,
    investorRequirement,
  };
}

export interface ActionGateResult {
  satisfied: boolean;
  blockingDocTypes: string[];
}

/**
 * Is `action` unblocked? Two shapes, both driven by the SAME doc_type rows
 * (`gate_kind = 'action' and gate_action = action`), distinguished only by
 * whether the caller names a specific investor:
 *
 *  - a specific `dealInvestorId` is given (e.g. "release this investor's
 *    pitch pack and portal access") -> that investor's own document must be
 *    cleared;
 *  - none is given (e.g. "instruct any Stage 3 Commission document") -> the
 *    brief's "for at least one qualifying investor" shape: ANY investor's
 *    document being cleared unblocks the deal-wide action. Simplification,
 *    flagged: this does not additionally require that investor to be at a
 *    specific funnel status (the brief's abort_cost_agreement rule says "for
 *    at least one soft-circled investor") — only one such rule exists today
 *    and the status qualifier was judged not worth a second code path for.
 */
export function evaluateActionGate(
  action: string,
  docTypes: DocTypeRow[],
  dealDocuments: DealDocumentRow[],
  investors: DealInvestorRow[],
  dealInvestorId: string | null,
): ActionGateResult {
  const gateTypes = docTypes.filter((dt) => dt.gateKind === "action" && dt.gateAction === action && dt.isActive);
  const blocking: string[] = [];

  for (const dt of gateTypes) {
    if (dt.scope === "deal") {
      if (!isCleared(dealDocuments, dt.key, null)) blocking.push(dt.key);
      continue;
    }
    // scope === 'investor'
    if (dealInvestorId) {
      if (!isCleared(dealDocuments, dt.key, dealInvestorId)) blocking.push(dt.key);
    } else {
      const anyCleared = investors.some((inv) => isCleared(dealDocuments, dt.key, inv.dealInvestorId));
      if (!anyCleared) blocking.push(dt.key);
    }
  }

  return { satisfied: blocking.length === 0, blockingDocTypes: blocking };
}
