// ============================================================================
// Opportunity risks — the pre-acquisition risk register.
// ----------------------------------------------------------------------------
// Two relationships are the reason this is a table and not a view over DD:
//
//   * A material diligence FINDING is promoted into a persistent risk. The DD
//     item keeps its finding; the risk records the position the firm is taking
//     on it. Neither is a copy — `source_dd_item_id` links them, so a reader can
//     always get from a risk back to the work that found it.
//   * At acquisition, open risks carry into `asset_risks`. The column shapes
//     here deliberately mirror that table so the migration is an INSERT/SELECT,
//     and `migrated_to_asset_risk_id` (unique where set) means the same risk
//     cannot be carried twice.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";
import { AppError } from "@/lib/errors";
import { staffNamesOn, nameOf } from "@/lib/data/directory";

export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type OppRiskStatus = "open" | "mitigated" | "accepted" | "closed";

export interface OpportunityRisk {
  riskId: string;
  orgId: string;
  opportunityId: string;
  title: string;
  category: string;
  description: string | null;
  severity: RiskSeverity;
  probability: number | null;
  financialImpact: number | null;
  mitigation: string | null;
  ownerUserId: string | null;
  /**
   * The owner's display name, resolved through the staff directory.
   *
   * Since migration 0011 a colleague in the same organisation resolves normally.
   * Null now means only that no name is recorded against that user, so it still
   * does not mean unowned — the register keeps the two apart rather than showing
   * an owned risk as unassigned.
   */
  ownerName: string | null;
  status: OppRiskStatus;
  sourceDdItemId: string | null;
  migratedToAssetRiskId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapRisk(r: Record<string, any>): OpportunityRisk {
  return {
    riskId: r.risk_id, orgId: r.org_id, opportunityId: r.opportunity_id,
    title: r.title, category: r.category, description: str(r.description),
    severity: r.severity, probability: num(r.probability),
    financialImpact: num(r.financial_impact), mitigation: str(r.mitigation),
    ownerUserId: r.owner_user_id ?? null,
    // Supplied by the caller from the staff directory, not by a column.
    ownerName: null, status: r.status,
    sourceDdItemId: r.source_dd_item_id ?? null,
    migratedToAssetRiskId: r.migrated_to_asset_risk_id ?? null,
    createdBy: r.created_by ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export interface NewRisk {
  title: string;
  category?: string;
  description?: string | null;
  severity?: RiskSeverity;
  probability?: number | null;
  financialImpact?: number | null;
  mitigation?: string | null;
  ownerUserId?: string | null;
  sourceDdItemId?: string | null;
}

export async function listRisks(session: Session, opportunityId: string): Promise<OpportunityRisk[]> {
  return withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query<Record<string, any>>(
      "select * from opportunity_risks where opportunity_id = $1 order by created_at",
      [opportunityId]);
    const directory = await staffNamesOn(tx, rows.map((r) => r.owner_user_id));
    return rows.map((r) => ({
      ...mapRisk(r),
      ownerName: nameOf(directory, r.owner_user_id ?? null),
    }));
  });
}

export async function createRisk(
  session: Session, opportunityId: string, input: NewRisk,
): Promise<string> {
  return withSession(session, async (tx) => {
    const opp = await tx.query<{ org_id: string }>(
      "select org_id from opportunities where opportunity_id = $1", [opportunityId]);
    if (!opp.rows[0]) throw new Error("Opportunity not found or not permitted");
    const res = await tx.query<{ risk_id: string }>(
      `insert into opportunity_risks
         (org_id, opportunity_id, title, category, description, severity, probability,
          financial_impact, mitigation, owner_user_id, source_dd_item_id, created_by)
       values ($1,$2,$3,coalesce($4,'other'),$5,coalesce($6,'medium'),$7,$8,$9,$10,$11,$12)
       returning risk_id`,
      [opp.rows[0].org_id, opportunityId, input.title, input.category ?? null,
       input.description ?? null, input.severity ?? null, input.probability ?? null,
       input.financialImpact ?? null, input.mitigation ?? null, input.ownerUserId ?? null,
       input.sourceDdItemId ?? null, session.userId ?? null]);
    return res.rows[0].risk_id;
  });
}

/**
 * Promote a diligence finding into a persistent risk.
 *
 * The DD item is the source, not the content: its finding text seeds the
 * description, but from here the risk has its own life — severity, mitigation,
 * owner and status move independently of whether the workstream is cleared. A
 * workstream can be closed ("we have the survey") while the risk it revealed
 * stays open ("the roof still needs replacing").
 *
 * Refuses a second promotion of the same finding, so a double click does not
 * produce two identical risks in the register.
 */
export async function promoteFindingToRisk(
  session: Session,
  ddItemId: string,
  overrides: Partial<NewRisk> = {},
): Promise<string> {
  return withSession(session, async (tx) => {
    const item = await tx.query<Record<string, any>>(
      "select * from opportunity_dd_items where dd_item_id = $1", [ddItemId]);
    const dd = item.rows[0];
    if (!dd) throw new Error("Due diligence item not found or not permitted");

    const already = await tx.query<{ risk_id: string }>(
      "select risk_id from opportunity_risks where source_dd_item_id = $1", [ddItemId]);
    if (already.rows[0]) {
      throw new AppError("This finding has already been promoted to a risk.");
    }

    const severity: RiskSeverity = overrides.severity
      ?? (dd.risk_level === "high" ? "high" : dd.risk_level === "low" ? "low" : "medium");

    const res = await tx.query<{ risk_id: string }>(
      `insert into opportunity_risks
         (org_id, opportunity_id, title, category, description, severity, probability,
          financial_impact, mitigation, owner_user_id, source_dd_item_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning risk_id`,
      [dd.org_id, dd.opportunity_id,
       overrides.title ?? dd.item,
       overrides.category ?? dd.section,
       overrides.description ?? dd.finding ?? dd.question ?? null,
       severity,
       overrides.probability ?? null,
       overrides.financialImpact ?? null,
       overrides.mitigation ?? null,
       overrides.ownerUserId ?? dd.owner_user_id ?? null,
       ddItemId, session.userId ?? null]);
    return res.rows[0].risk_id;
  });
}

export interface RiskPatch {
  title?: string;
  category?: string;
  description?: string | null;
  severity?: RiskSeverity;
  probability?: number | null;
  financialImpact?: number | null;
  mitigation?: string | null;
  ownerUserId?: string | null;
  status?: OppRiskStatus;
}

const RISK_COLUMNS: Record<keyof RiskPatch, string> = {
  title: "title", category: "category", description: "description",
  severity: "severity", probability: "probability", financialImpact: "financial_impact",
  mitigation: "mitigation", ownerUserId: "owner_user_id", status: "status",
};

export async function updateRisk(session: Session, riskId: string, patch: RiskPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(RISK_COLUMNS) as [keyof RiskPatch, string][]) {
    if (key in patch) { params.push(patch[key]); sets.push(`${col} = $${params.length}`); }
  }
  if (sets.length === 0) return;
  params.push(riskId);
  await withSession(session, (tx) =>
    tx.query(`update opportunity_risks set ${sets.join(", ")} where risk_id = $${params.length}`, params));
}

/** Risks that should carry into the asset at acquisition: open or accepted. */
export async function carryForwardRisks(
  session: Session, opportunityId: string,
): Promise<OpportunityRisk[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `select * from opportunity_risks
        where opportunity_id = $1
          and status in ('open', 'accepted')
          and migrated_to_asset_risk_id is null
        order by created_at`, [opportunityId]);
    return rows.map(mapRisk);
  });
}
