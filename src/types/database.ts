// ============================================================================
// Reiwa OS — shared domain enums
// ----------------------------------------------------------------------------
// The small set of vocabularies used across more than one module: currency,
// market, asset type, strategy and risk bands. Everything else lives with the
// module that owns it:
//
//   * Opportunity record      → src/lib/data/opportunity-types.ts
//   * Deal file (DD, contacts,
//     documents, decisions)   → src/lib/data/deal-file-types.ts
//   * Asset Intelligence      → src/lib/asset-intelligence/types.ts
//   * Investor Portal         → src/lib/data/investor-portal.ts
//
// This file deliberately no longer describes a `Deal` row. There is one record
// — the opportunity — and it becomes an asset on acquisition. Anything that
// reintroduces a parallel deal model belongs nowhere.
// ============================================================================

export type Currency = "GBP" | "EUR" | "USD" | "JPY";

export type Market =
  | "London" | "Amsterdam" | "Paris" | "Berlin" | "Frankfurt"
  | "Madrid" | "Milan" | "Dublin" | "Other";

export type AssetType =
  | "office" | "retail" | "industrial" | "logistics" | "residential"
  | "multifamily" | "hotel" | "student_housing" | "healthcare"
  | "data_centre" | "mixed_use" | "land" | "other";

export type Strategy =
  | "core" | "core_plus" | "value_add" | "opportunistic" | "development";

export type RiskLevel = "low" | "medium" | "high";

export type RiskStatus = "open" | "mitigated" | "accepted" | "closed";

export type RiskCategory =
  | "market" | "tenant" | "structural" | "legal" | "financial"
  | "regulatory" | "planning" | "esg" | "tax" | "fx" | "execution" | "other";

/**
 * Output of the legacy 11-criterion investment score. Retained only because
 * src/lib/scoring/model.ts is kept as reference material; it is not used by any
 * screen and is superseded by the Five Tests verdict (Pursue / Watch / Pass) in
 * Phase 1.
 */
export type Recommendation =
  | "strong_proceed" | "proceed" | "proceed_with_caution" | "weak" | "reject";
