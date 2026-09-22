// ============================================================================
// Deal file — pure types and constants (no server imports).
// ----------------------------------------------------------------------------
// Safe to import from client components. The data layer (deal-file.ts) re-exports
// everything here so server code has a single import site.
//
// These are children of ONE record: the opportunity. There is no `dealId`.
// ============================================================================

export type DdJurisdiction = "UK" | "Netherlands" | "Japan" | "Cross-border";
export type DdPriority = "low" | "medium" | "high" | "critical";
export type DdRiskLevel = "low" | "medium" | "high";

export type DdStatus =
  | "not_started" | "requested" | "in_progress" | "received"
  | "reviewed" | "issue_identified" | "resolved" | "not_applicable";

export const DD_STATUS_ORDER: DdStatus[] = [
  "not_started", "requested", "in_progress", "received",
  "reviewed", "issue_identified", "resolved", "not_applicable",
];

/**
 * The Reiwa due diligence section spine, in memo order. Held in TypeScript
 * rather than a database check constraint: the frameworks differ by market and
 * the methodology is not final.
 */
export type DdSection =
  | "Executive Summary" | "Submarket Overview" | "Location and Micro Situation"
  | "Asset Description" | "Tenure and Ownership" | "Income Profile and Tenancy"
  | "Tenant Covenant Review" | "Planning and Heritage" | "ESG and Compliance"
  | "Market Commentary" | "Valuation Metrics" | "Insurance and Reinstatement Cost"
  | "Capex Plan" | "Business Plan Scenarios" | "Exit Strategy"
  | "Vendor and Deal Dynamics" | "SWOT" | "Japan Rationale"
  | "Cross Border Tax and Holding Structure" | "Currency Risk and Hedging"
  | "Further DD Required";

export const DD_SECTIONS: DdSection[] = [
  "Executive Summary", "Submarket Overview", "Location and Micro Situation",
  "Asset Description", "Tenure and Ownership", "Income Profile and Tenancy",
  "Tenant Covenant Review", "Planning and Heritage", "ESG and Compliance",
  "Market Commentary", "Valuation Metrics", "Insurance and Reinstatement Cost",
  "Capex Plan", "Business Plan Scenarios", "Exit Strategy",
  "Vendor and Deal Dynamics", "SWOT", "Japan Rationale",
  "Cross Border Tax and Holding Structure", "Currency Risk and Hedging",
  "Further DD Required",
];

export interface DdItem {
  itemId: string;
  opportunityId: string;
  section: string;
  item: string;
  question: string | null;
  jurisdiction: DdJurisdiction;
  priority: DdPriority;
  status: DdStatus;
  riskLevel: DdRiskLevel | null;
  owner: string | null;
  dueDate: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DealContact {
  contactId: string;
  opportunityId: string | null;
  name: string;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Document categories. A register entry only — Reiwa OS does not yet hold the
 * file itself, and holds nothing extracted from it. Both arrive in Phase 3.
 */
export type DocCategory =
  | "Offering Memorandum" | "Broker Brochure" | "Rent Roll" | "Tenancy Schedule"
  | "Lease" | "Title" | "Valuation" | "Technical DD" | "Planning" | "EPC"
  | "Capex Quote" | "Tax Memo" | "Legal Memo" | "Photos" | "Floorplans"
  | "Financial Model" | "Other";

export const DOC_CATEGORIES: DocCategory[] = [
  "Offering Memorandum", "Broker Brochure", "Rent Roll", "Tenancy Schedule",
  "Lease", "Title", "Valuation", "Technical DD", "Planning", "EPC",
  "Capex Quote", "Tax Memo", "Legal Memo", "Photos", "Floorplans",
  "Financial Model", "Other",
];

export interface DealDocument {
  documentId: string;
  opportunityId: string;
  fileName: string;
  fileType: string | null;
  category: string;
  /** Null until Supabase Storage is wired in (Phase 3). */
  storagePath: string | null;
  notes: string | null;
  uploadedAt: string;
}

export type DecisionType =
  | "screening" | "investment_committee" | "bid" | "exclusivity"
  | "legal" | "completion" | "abort" | "other";

export const DECISION_TYPES: DecisionType[] = [
  "screening", "investment_committee", "bid", "exclusivity",
  "legal", "completion", "abort", "other",
];

export interface DecisionEntry {
  decisionId: string;
  opportunityId: string;
  decisionDate: string;
  decisionType: DecisionType;
  decision: string;
  rationale: string | null;
  nextSteps: string | null;
  author: string | null;
  createdAt: string;
}

/** Everything hanging off one opportunity, assembled for the detail page. */
export interface DealFile {
  ddItems: DdItem[];
  contacts: DealContact[];
  documents: DealDocument[];
  decisions: DecisionEntry[];
}

// ---- Due diligence progress (pure) -----------------------------------------

export const isDdOpen = (s: DdStatus): boolean =>
  s === "not_started" || s === "requested" || s === "in_progress" ||
  s === "received" || s === "issue_identified";

export const isDdCleared = (s: DdStatus): boolean =>
  s === "reviewed" || s === "resolved";

export const isDdIssue = (s: DdStatus): boolean => s === "issue_identified";

export interface DdProgress {
  total: number;
  /** Excludes Not Applicable. */
  inScope: number;
  cleared: number;
  open: number;
  issues: number;
  /** cleared / inScope, as a whole percentage. 100 when nothing is in scope. */
  pct: number;
  byStatus: Record<DdStatus, number>;
}

const ZERO_BY_STATUS = (): Record<DdStatus, number> => ({
  not_started: 0, requested: 0, in_progress: 0, received: 0,
  reviewed: 0, issue_identified: 0, resolved: 0, not_applicable: 0,
});

export function computeProgress(items: { status: DdStatus }[]): DdProgress {
  const byStatus = ZERO_BY_STATUS();
  let cleared = 0, open = 0, issues = 0, inScope = 0;
  for (const it of items) {
    byStatus[it.status] += 1;
    if (it.status !== "not_applicable") inScope += 1;
    if (isDdCleared(it.status)) cleared += 1;
    if (isDdOpen(it.status)) open += 1;
    if (isDdIssue(it.status)) issues += 1;
  }
  return {
    total: items.length,
    inScope,
    cleared,
    open,
    issues,
    pct: inScope > 0 ? Math.round((cleared / inScope) * 100) : 100,
    byStatus,
  };
}

/**
 * Open workstreams that are either flagged issues or high/critical priority,
 * ordered most pressing first.
 */
export function criticalOpenItems(items: DdItem[]): DdItem[] {
  const rank = (it: DdItem) =>
    (isDdIssue(it.status) ? 0 : 1) * 100 +
    (it.priority === "critical" ? 0 : it.priority === "high" ? 1 : 2) * 10 +
    (it.riskLevel === "high" ? 0 : it.riskLevel === "medium" ? 1 : 2);
  return items
    .filter((it) =>
      isDdOpen(it.status) &&
      (isDdIssue(it.status) || it.priority === "critical" || it.priority === "high"))
    .sort((a, b) => rank(a) - rank(b));
}
