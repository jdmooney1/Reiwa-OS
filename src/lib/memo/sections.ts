// ============================================================================
// Investment Memo — section model & output formats
// ----------------------------------------------------------------------------
// The memo is a structured document assembled from the deal file. Section keys
// are stable; labels and ordering live here. Output formats select and reframe
// which sections are included.
// ============================================================================

export type MemoSectionKey =
  | "executive_summary"
  | "key_metrics"
  | "investment_thesis"
  | "asset_overview"
  | "location_market"
  | "income_tenancy"
  | "business_plan"
  | "financial_analysis"
  | "capex_plan"
  | "planning_heritage_esg"
  | "japan_rationale"
  | "tax_structuring"
  | "fx_sensitivity"
  | "risk_mitigation"
  | "exit_strategy"
  | "recommendation"
  | "further_dd";

export interface MemoSectionDef {
  key: MemoSectionKey;
  label: string;
}

export const MEMO_SECTIONS: MemoSectionDef[] = [
  { key: "executive_summary", label: "Executive Summary" },
  { key: "key_metrics", label: "Key Metrics" },
  { key: "investment_thesis", label: "Investment Thesis" },
  { key: "asset_overview", label: "Asset Overview" },
  { key: "location_market", label: "Location and Market" },
  { key: "income_tenancy", label: "Income and Tenancy" },
  { key: "business_plan", label: "Business Plan" },
  { key: "financial_analysis", label: "Financial Analysis" },
  { key: "capex_plan", label: "Capex Plan" },
  { key: "planning_heritage_esg", label: "Planning, Heritage, ESG" },
  { key: "japan_rationale", label: "Japan Investor Rationale" },
  { key: "tax_structuring", label: "Tax and Structuring Considerations" },
  { key: "fx_sensitivity", label: "FX Sensitivity" },
  { key: "risk_mitigation", label: "Risk and Mitigation" },
  { key: "exit_strategy", label: "Exit Strategy" },
  { key: "recommendation", label: "Recommendation" },
  { key: "further_dd", label: "Further DD Required" },
];

export const SECTION_LABEL: Record<MemoSectionKey, string> = Object.fromEntries(
  MEMO_SECTIONS.map((s) => [s.key, s.label]),
) as Record<MemoSectionKey, string>;

export type OutputFormat = "ic" | "teaser" | "snapshot" | "japanese";

export interface OutputFormatDef {
  key: OutputFormat;
  label: string;
  description: string;
  sections: MemoSectionKey[];
  japanese?: boolean;
}

// "japanese" is a single-section Japanese-language summary handled specially.
export const OUTPUT_FORMATS: OutputFormatDef[] = [
  {
    key: "ic",
    label: "Internal IC Memo",
    description: "Full investment committee memorandum — all 17 sections.",
    sections: MEMO_SECTIONS.map((s) => s.key),
  },
  {
    key: "teaser",
    label: "Investor Teaser",
    description: "Concise, positive-framed summary for prospective investors.",
    sections: [
      "executive_summary", "key_metrics", "asset_overview", "location_market",
      "investment_thesis", "business_plan", "exit_strategy",
    ],
  },
  {
    key: "snapshot",
    label: "One-Page Asset Snapshot",
    description: "A single-page snapshot of the asset and headline metrics.",
    sections: ["executive_summary", "key_metrics", "asset_overview"],
  },
  {
    key: "japanese",
    label: "Japanese Language Summary",
    description: "日本語の投資サマリー — Japanese-language investor summary.",
    sections: [],
    japanese: true,
  },
];

export const FORMAT_BY_KEY: Record<OutputFormat, OutputFormatDef> = Object.fromEntries(
  OUTPUT_FORMATS.map((f) => [f.key, f]),
) as Record<OutputFormat, OutputFormatDef>;
