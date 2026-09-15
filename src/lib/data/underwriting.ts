// ============================================================================
// Versioned underwriting — the data layer over `investment_cases`.
// ----------------------------------------------------------------------------
// Every call runs under withSession, so RLS enforces org isolation and write
// scope. Two questions must always have a single, unambiguous answer:
//
//   currentVersion(opportunity)  — what are we working on?
//   approvedVersion(opportunity) — what did the IC sign off?
//
// Neither is a convention here. Both are partial unique indexes in migration
// 0008, so the database refuses a second one rather than trusting this file to
// be careful.
//
// Approval is NOT performed here. A version becomes approved only as a
// consequence of recording an investment committee decision (see ic-decisions.ts),
// because an approval with no minute attached is the thing that cannot be
// explained three years later.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";
import type { CaseStatus, UnderwritingVersion } from "@/lib/data/underwriting-types";

export type { CaseStatus, UnderwritingVersion } from "@/lib/data/underwriting-types";
export { CASE_STATUSES } from "@/lib/data/underwriting-types";

function mapCase(r: Record<string, any>): UnderwritingVersion {
  return {
    caseId: r.case_id, orgId: r.org_id, opportunityId: r.opportunity_id,
    version: Number(r.version), status: r.status,
    strategy: str(r.strategy), thesis: str(r.thesis),
    businessPlanAssumptions: str(r.business_plan_assumptions),
    changeRationale: str(r.change_rationale),
    acquisitionPrice: num(r.acquisition_price), acquisitionCosts: num(r.acquisition_costs),
    capex: num(r.capex), totalCost: num(r.total_cost), equity: num(r.equity),
    grossRentalIncome: num(r.gross_rental_income), noi: num(r.noi), erv: num(r.erv),
    occupancyPct: num(r.occupancy_pct),
    debt: num(r.debt), ltvPct: num(r.ltv_pct), debtCostPct: num(r.debt_cost_pct),
    valuation: num(r.valuation), exitValue: num(r.exit_value),
    entryYieldPct: num(r.entry_yield_pct), exitYieldPct: num(r.exit_yield_pct),
    holdPeriodYears: num(r.hold_period_years), targetIrr: num(r.target_irr),
    targetEquityMultiple: num(r.target_equity_multiple),
    assumptions: (r.assumptions ?? {}) as Record<string, unknown>,
    acquisitionDate: str(r.acquisition_date),
    createdBy: r.created_by ?? null, createdAt: r.created_at,
    approvedBy: r.approved_by ?? null, approvedAt: r.approved_at ?? null,
    supersededAt: r.superseded_at ?? null,
  };
}

/** The writable spine. `totalCost` is absent deliberately — Postgres generates it. */
export interface UnderwritingInput {
  strategy?: string | null;
  thesis?: string | null;
  businessPlanAssumptions?: string | null;
  changeRationale?: string | null;
  acquisitionPrice?: number | null;
  acquisitionCosts?: number | null;
  acquisitionDate?: string | null;
  capex?: number | null;
  equity?: number | null;
  grossRentalIncome?: number | null;
  noi?: number | null;
  erv?: number | null;
  occupancyPct?: number | null;
  debt?: number | null;
  ltvPct?: number | null;
  debtCostPct?: number | null;
  valuation?: number | null;
  exitValue?: number | null;
  entryYieldPct?: number | null;
  exitYieldPct?: number | null;
  holdPeriodYears?: number | null;
  targetIrr?: number | null;
  targetEquityMultiple?: number | null;
  assumptions?: Record<string, unknown>;
}

const COLUMNS: Record<keyof UnderwritingInput, string> = {
  strategy: "strategy", thesis: "thesis",
  businessPlanAssumptions: "business_plan_assumptions", changeRationale: "change_rationale",
  acquisitionPrice: "acquisition_price", acquisitionCosts: "acquisition_costs",
  acquisitionDate: "acquisition_date", capex: "capex", equity: "equity",
  grossRentalIncome: "gross_rental_income", noi: "noi", erv: "erv",
  occupancyPct: "occupancy_pct", debt: "debt", ltvPct: "ltv_pct",
  debtCostPct: "debt_cost_pct", valuation: "valuation", exitValue: "exit_value",
  entryYieldPct: "entry_yield_pct", exitYieldPct: "exit_yield_pct",
  holdPeriodYears: "hold_period_years", targetIrr: "target_irr",
  targetEquityMultiple: "target_equity_multiple", assumptions: "assumptions",
};

function columnsFor(input: UnderwritingInput) {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [key, col] of Object.entries(COLUMNS) as [keyof UnderwritingInput, string][]) {
    if (key in input) {
      cols.push(col);
      vals.push(key === "assumptions" ? JSON.stringify(input[key] ?? {}) : input[key]);
    }
  }
  return { cols, vals };
}

export async function listVersions(session: Session, opportunityId: string): Promise<UnderwritingVersion[]> {
  return withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query(
      "select * from investment_cases where opportunity_id = $1 order by version desc", [opportunityId]);
    return rows.map(mapCase);
  });
}

export async function getVersion(session: Session, caseId: string): Promise<UnderwritingVersion | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query("select * from investment_cases where case_id = $1", [caseId]);
    return rows[0] ? mapCase(rows[0]) : null;
  });
}

/** The single working version, or null if none has been promoted to `current`. */
export async function currentVersion(session: Session, opportunityId: string): Promise<UnderwritingVersion | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      "select * from investment_cases where opportunity_id = $1 and status = 'current'", [opportunityId]);
    return rows[0] ? mapCase(rows[0]) : null;
  });
}

/** The single live IC-approved version, or null. Superseded approvals are excluded. */
export async function approvedVersion(session: Session, opportunityId: string): Promise<UnderwritingVersion | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      "select * from investment_cases where opportunity_id = $1 and status = 'approved'", [opportunityId]);
    return rows[0] ? mapCase(rows[0]) : null;
  });
}

/**
 * Create the next version for an opportunity.
 *
 * `version` is allocated from the existing maximum inside the same transaction.
 * That is a read-then-write, and the unique (opportunity_id, version) constraint
 * is what makes it safe: two concurrent creators do not both get version 4 —
 * one of them fails and retries, which is the correct outcome for a record
 * whose numbering people will cite in a committee.
 *
 * `makeCurrent` promotes it in the same transaction, demoting whatever was
 * current to `draft`. An approved version is never demoted: it is superseded,
 * and only by a later approval.
 */
export async function createVersion(
  session: Session,
  opportunityId: string,
  input: UnderwritingInput = {},
  opts: { makeCurrent?: boolean; createdBy?: string | null } = {},
): Promise<string> {
  const { makeCurrent = true, createdBy = session.userId ?? null } = opts;
  return withSession(session, async (tx) => {
    const org = await tx.query<{ org_id: string }>(
      "select org_id from opportunities where opportunity_id = $1", [opportunityId]);
    if (!org.rows[0]) throw new Error("Opportunity not found or not permitted");

    const next = await tx.query<{ v: number }>(
      "select coalesce(max(version), 0) + 1 as v from investment_cases where opportunity_id = $1",
      [opportunityId]);
    const version = Number(next.rows[0].v);

    if (makeCurrent) {
      await tx.query(
        "update investment_cases set status = 'draft' where opportunity_id = $1 and status = 'current'",
        [opportunityId]);
    }

    const { cols, vals } = columnsFor(input);
    const base = ["org_id", "opportunity_id", "version", "status", "created_by"];
    const baseVals = [org.rows[0].org_id, opportunityId, version, makeCurrent ? "current" : "draft", createdBy];
    const all = [...base, ...cols];
    const params = [...baseVals, ...vals];
    const placeholders = all.map((_, i) => `$${i + 1}`).join(", ");

    const res = await tx.query<{ case_id: string }>(
      `insert into investment_cases(${all.join(", ")}) values (${placeholders}) returning case_id`, params);
    return res.rows[0].case_id;
  });
}

/**
 * Edit a version that is still being worked on.
 *
 * There is no guard here against editing an approved version, and that is
 * deliberate: the trigger in migration 0008 refuses it. A check in this file
 * would be a second, weaker copy of a rule the database already enforces —
 * and the one that gets forgotten when another caller appears.
 */
export async function updateVersion(
  session: Session, caseId: string, input: UnderwritingInput,
): Promise<void> {
  const { cols, vals } = columnsFor(input);
  if (cols.length === 0) return;
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  await withSession(session, (tx) =>
    tx.query(`update investment_cases set ${sets.join(", ")} where case_id = $${cols.length + 1}`,
      [...vals, caseId]));
}

/** Promote a draft to the working version, demoting the incumbent. */
export async function makeCurrent(session: Session, caseId: string): Promise<void> {
  await withSession(session, async (tx) => {
    const row = await tx.query<{ opportunity_id: string; status: CaseStatus }>(
      "select opportunity_id, status from investment_cases where case_id = $1", [caseId]);
    const found = row.rows[0];
    if (!found) throw new Error("Underwriting version not found or not permitted");
    if (found.status === "approved" || found.status === "superseded") {
      throw new Error(`An ${found.status} underwriting version cannot be reopened as the working version`);
    }
    await tx.query(
      "update investment_cases set status = 'draft' where opportunity_id = $1 and status = 'current'",
      [found.opportunity_id]);
    await tx.query("update investment_cases set status = 'current' where case_id = $1", [caseId]);
  });
}
