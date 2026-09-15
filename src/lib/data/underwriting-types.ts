// ============================================================================
// Versioned underwriting — pure types & constants.
// ----------------------------------------------------------------------------
// No server imports, so a client component can hold these shapes.
//
// An "underwriting version" IS an `investment_cases` row. There is no separate
// table: that record was already versioned per opportunity, already immutable
// once approved, and already the thing `conversion.ts` carries into the asset.
// Adding a second versioned underwriting object beside it would have been the
// duplication Phase 0 exists to prevent.
// ============================================================================

/**
 * draft      — being written. Several may exist for one opportunity.
 * current    — THE working version. At most one per opportunity (partial unique index).
 * approved   — signed off by the investment committee. Immutable.
 * superseded — replaced by a later approval. Immutable.
 */
export type CaseStatus = "draft" | "current" | "approved" | "superseded";

export const CASE_STATUSES: CaseStatus[] = ["draft", "current", "approved", "superseded"];

/** The shared reporting spine. Strategy-specific inputs live in `assumptions`. */
export interface UnderwritingVersion {
  caseId: string;
  orgId: string;
  opportunityId: string;
  version: number;
  status: CaseStatus;

  strategy: string | null;
  thesis: string | null;
  businessPlanAssumptions: string | null;
  changeRationale: string | null;

  // Cost
  acquisitionPrice: number | null;
  acquisitionCosts: number | null;
  capex: number | null;
  /** Generated in Postgres: price + costs + capex. Never written by the app. */
  totalCost: number | null;
  equity: number | null;

  // Income
  grossRentalIncome: number | null;
  noi: number | null;
  erv: number | null;
  occupancyPct: number | null;

  // Debt
  debt: number | null;
  ltvPct: number | null;
  debtCostPct: number | null;

  // Value & return
  valuation: number | null;
  exitValue: number | null;
  entryYieldPct: number | null;
  exitYieldPct: number | null;
  holdPeriodYears: number | null;
  targetIrr: number | null;
  targetEquityMultiple: number | null;

  assumptions: Record<string, unknown>;

  acquisitionDate: string | null;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  supersededAt: string | null;
}
