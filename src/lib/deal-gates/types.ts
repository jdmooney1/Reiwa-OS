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
  /** This investor's own flags (deal_investor.flags) — the most specific of
   * the three layers conditionHolds() can be given; see loadGateContext.
   * Optional so a literal built for a test need not supply it; loadGateContext
   * always populates it for real. */
  flags?: DealFlags;
}

export interface DealFlags {
  geared?: boolean;
  hedged?: boolean;
  jurisdiction?: "UK" | "NL";
  /**
   * Snake_case, deliberately NOT camelCased like the rest of this
   * interface: `geared`/`hedged`/`jurisdiction` are passed through from the
   * raw `flags` jsonb column with no translation layer at all, and this key
   * does the same — a flag set directly in SQL (`regulated_disclosure`) and
   * one read here must be the identical string, or they silently stop
   * agreeing. Resolved, not raw: loadGateContext merges the platform
   * setting (platform_settings, key 'regulated_disclosure') underneath the
   * opportunity's own `flags` column before this is ever built, the same
   * precedence app.doc_type_applies applies on the SQL side (0051). By the
   * time a DealFlags reaches conditionHolds(), there is nothing further to
   * resolve.
   */
  regulated_disclosure?: boolean;
}

/**
 * `gate_condition` has two readings depending on `gate_kind` (docs/24 §5,
 * app.doc_type_applies in migration 0047/0051 — this is the TypeScript side
 * of the same rule, not a shared implementation: one is a DB applicability
 * filter for auto-creation, this is the gate evaluator; they must agree in
 * MEANING, not in code, since they run in different languages against
 * different inputs).
 *
 * `flags` is expected to already be the fully merged view for whatever this
 * condition is being checked against — platform setting, then deal flags,
 * then (for an investor-scoped check) that investor's own flags layered on
 * top, exactly as app.doc_type_applies is called with `o.flags || di.flags`
 * on the SQL side. This function does no merging itself.
 */
export function conditionHolds(
  condition: string | null, flags: DealFlags, investorType: string | null,
): boolean {
  if (condition == null) return true;
  if (condition === "geared") return flags.geared === true;
  if (condition === "hedged") return flags.hedged === true;
  if (condition.startsWith("jurisdiction:")) return flags.jurisdiction === condition.slice("jurisdiction:".length);
  if (condition.startsWith("investor_type:")) return investorType === condition.slice("investor_type:".length);
  if (condition === "regulated_disclosure") return flags.regulated_disclosure === true;
  return true;
}
