// ============================================================================
// Shared shapes for the gate evaluator (docs/24). Pure types only.
// ============================================================================

export type DealInvestorStatus =
  | "matched" | "teaser_sent" | "nda_signed" | "pack_released"
  | "ioi_received" | "soft_circled" | "committed" | "completed" | "declined";

/** Linear funnel order. `declined` is terminal and deliberately unranked —
 * it is excluded from every "at or later than X" comparison rather than
 * sorted into the sequence it left. */
export const INVESTOR_STATUS_RANK: Record<Exclude<DealInvestorStatus, "declined">, number> = {
  matched: 0, teaser_sent: 1, nda_signed: 2, pack_released: 3,
  ioi_received: 4, soft_circled: 5, committed: 6, completed: 7,
};

export function investorStatusAtLeast(status: DealInvestorStatus, threshold: DealInvestorStatus): boolean {
  if (status === "declined") return false;
  return INVESTOR_STATUS_RANK[status] >= INVESTOR_STATUS_RANK[threshold as Exclude<DealInvestorStatus, "declined">];
}

export type DealDocumentStatus =
  | "not_started" | "requested" | "instructed" | "draft"
  | "in_review" | "final" | "signed" | "superseded" | "not_applicable";

const CLEARED: ReadonlySet<DealDocumentStatus> = new Set(["final", "signed"]);
export function isClearedStatus(status: DealDocumentStatus | null | undefined): boolean {
  return status != null && CLEARED.has(status);
}

export interface DocTypeRow {
  key: string;
  stage: 0 | 1 | 2 | 3 | 4;
  scope: "deal" | "investor" | "counterparty";
  gateKind: "none" | "transition" | "action";
  gateAction: string | null;
  gateCondition: string | null;
  isActive: boolean;
}

export interface DealDocumentRow {
  docTypeKey: string;
  dealInvestorId: string | null;
  status: DealDocumentStatus;
}

export interface DealInvestorRow {
  dealInvestorId: string;
  status: DealInvestorStatus;
  investorType: string | null;
}

export interface DealFlags {
  geared?: boolean;
  hedged?: boolean;
  jurisdiction?: "UK" | "NL";
}

/**
 * `gate_condition` has two readings depending on `gate_kind` (docs/24 §5,
 * app.doc_type_applies in migration 0047 — this is the TypeScript side of
 * the same rule, not a shared implementation: one is a DB applicability
 * filter for auto-creation, this is the gate evaluator; they must agree in
 * MEANING, not in code, since they run in different languages against
 * different inputs).
 */
export function conditionHolds(
  condition: string | null, flags: DealFlags, investorType: string | null,
): boolean {
  if (condition == null) return true;
  if (condition === "geared") return flags.geared === true;
  if (condition === "hedged") return flags.hedged === true;
  if (condition.startsWith("jurisdiction:")) return flags.jurisdiction === condition.slice("jurisdiction:".length);
  if (condition.startsWith("investor_type:")) return investorType === condition.slice("investor_type:".length);
  // 'regulated_disclosure': a platform-level setting with nowhere to read
  // from yet (docs/24 catalogue note) — default to applicable, same as the
  // DB side, rather than silently hiding a document type.
  return true;
}
