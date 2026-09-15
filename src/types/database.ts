// ============================================================================
// Reiwa OS — shared domain enums
// ----------------------------------------------------------------------------
// What is left here is the vocabulary the product shares: currencies, markets,
// asset types, strategies, the due-diligence framework and the investment-score
// recommendation bands.
//
// What is NOT here any more is a second database. This file used to declare a
// `Deal`, `DealMetrics`, `DealFile`, `Contact`, `DocumentRecord`,
// `InvestmentScore` and `DecisionLogEntry`, plus a `Database` interface mapping
// tables named `deals`, `risks`, `contacts`, `documents`, `investment_scores`
// and `decision_log`. None of those tables exists in supabase/migrations, and
// none ever did — the shapes were written against a schema that was only ever
// served from src/lib/mock-data.ts. Keeping a typed model of an imaginary
// database next to the real one is what let a whole screen look persistent.
//
// The canonical pre-acquisition object is `opportunities`; the canonical
// post-acquisition object is `assets`. Both are typed from the real schema in
// src/lib/data/ and src/lib/asset-intelligence/types.ts.
// ============================================================================

// ---- Enums -----------------------------------------------------------------
export type Currency = "GBP" | "EUR" | "USD";

export type Market =
  | "London" | "Amsterdam" | "Paris" | "Berlin" | "Frankfurt"
  | "Madrid" | "Milan" | "Dublin" | "Other";

export type AssetType =
  | "office" | "retail" | "industrial" | "logistics" | "residential"
  | "multifamily" | "hotel" | "student_housing" | "healthcare"
  | "data_centre" | "mixed_use" | "land" | "other";

export type Strategy =
  | "core" | "core_plus" | "value_add" | "opportunistic" | "development";



// Reiwa DD framework sections (London & Amsterdam), in memo order.
export type DdSection =
  | "Executive Summary" | "Submarket Overview" | "Location and Micro Situation"
  | "Asset Description" | "Tenure and Ownership" | "Income Profile and Tenancy"
  | "Tenant Covenant Review" | "Planning and Heritage" | "ESG and Compliance"
  | "Market Commentary" | "Valuation Metrics" | "Insurance and Reinstatement Cost"
  | "Capex Plan" | "Business Plan Scenarios" | "Exit Strategy"
  | "Vendor and Deal Dynamics" | "SWOT" | "Japan Rationale"
  | "Cross Border Tax and Holding Structure" | "Currency Risk and Hedging"
  | "Further DD Required";

export type DdJurisdiction = "UK" | "Netherlands" | "Japan" | "Cross-border";

export type PriorityLevel = "low" | "medium" | "high" | "critical";

export type DdStatus =
  | "not_started" | "requested" | "in_progress" | "received"
  | "reviewed" | "issue_identified" | "resolved" | "not_applicable";

export type RiskLevel = "low" | "medium" | "high";


export type RiskStatus = "open" | "mitigated" | "accepted" | "closed";

export type DocCategory =
  | "Broker Brochure" | "Rent Roll" | "Lease" | "Title" | "Valuation"
  | "Technical DD" | "Planning" | "EPC" | "Capex Quote" | "Tax Memo"
  | "Legal Memo" | "Photos" | "Floorplans" | "Financial Model"
  | "Investor Presentation";

// Lifecycle of a document through the AI ingestion workflow.
export type DocIngestStatus = "uploaded" | "processing" | "extracted" | "reviewed";

export type Recommendation =
  | "strong_proceed" | "proceed" | "proceed_with_caution" | "weak" | "reject";

// ---- Due diligence ---------------------------------------------------------
// Instantiated onto an opportunity from a template (src/lib/dd/templates.ts).
export interface DueDiligenceItem {
  item_id: string;
  opportunity_id: string;
  section: DdSection;
  item: string; // item title
  question: string | null; // the diligence question being answered
  jurisdiction: DdJurisdiction;
  priority: PriorityLevel;
  status: DdStatus;
  owner: string | null;
  due_date: string | null;
  risk_level: RiskLevel | null;
  notes: string | null;
  linked_documents: string[]; // document ids / file names
  created_at: string;
  updated_at: string;
}
