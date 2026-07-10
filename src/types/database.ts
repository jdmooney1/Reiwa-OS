// ============================================================================
// Reiwa OS — Database & domain types
// ----------------------------------------------------------------------------
// Hand-written to mirror supabase/schema.sql. When the Supabase CLI is wired up,
// `supabase gen types typescript` can regenerate the `Database` interface; the
// enum unions and Row aliases below are the stable surface the app imports.
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

export type DealStage =
  | "sourcing" | "screening" | "underwriting" | "due_diligence"
  | "investment_committee" | "under_offer" | "exclusivity" | "legals"
  | "completed" | "aborted";

export type DealStatus =
  | "active" | "on_hold" | "completed" | "withdrawn" | "dead";

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

export type RiskCategory =
  | "market" | "tenant" | "structural" | "legal" | "financial"
  | "regulatory" | "planning" | "esg" | "tax" | "fx" | "execution" | "other";

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

export type DecisionType =
  | "screening" | "investment_committee" | "bid" | "exclusivity"
  | "legal" | "completion" | "abort" | "other";

// ---- Table rows ------------------------------------------------------------
export interface Deal {
  deal_id: string;
  asset_name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  market: Market | null;
  submarket: string | null;
  asset_type: AssetType;
  strategy: Strategy | null;
  deal_stage: DealStage;
  source: string | null;
  broker_name: string | null;
  vendor_name: string | null;
  price_guidance: number | null;
  currency: Currency;
  size_sqft: number | null;
  size_sqm: number | null;
  passing_rent: number | null;
  erv: number | null;
  niy: number | null;
  reversionary_yield: number | null;
  capex_budget: number | null;
  target_irr: number | null;
  equity_multiple: number | null;
  status: DealStatus;
  probability: number | null;
  created_at: string;
  updated_at: string;
}

export interface DealMetrics {
  metric_id: string;
  deal_id: string;
  purchase_price: number | null;
  acquisition_costs: number | null;
  stamp_duty_or_transfer_tax: number | null;
  total_cost: number | null;
  debt_amount: number | null;
  ltv: number | null;
  interest_rate: number | null;
  rent: number | null;
  erv: number | null;
  noi: number | null;
  capex: number | null;
  exit_yield: number | null;
  exit_value: number | null;
  irr: number | null;
  equity_multiple: number | null;
  cash_on_cash: number | null;
  yield_on_cost: number | null;
  created_at: string;
  updated_at: string;
}

export interface DueDiligenceItem {
  item_id: string;
  deal_id: string;
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

export interface Risk {
  risk_id: string;
  deal_id: string;
  risk_title: string;
  risk_category: RiskCategory;
  probability: number | null; // 1..5
  impact: number | null; // 1..5
  risk_score: number | null; // probability * impact
  mitigation: string | null;
  owner: string | null;
  status: RiskStatus;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  contact_id: string;
  deal_id: string | null;
  name: string;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRecord {
  document_id: string;
  deal_id: string;
  file_name: string;
  file_type: string | null;
  category: DocCategory;
  storage_url: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  summary: string | null;
  ingest_status: DocIngestStatus;
  extraction: DocumentExtraction | null;
}

// Structured "deal memory" extracted from a document during AI ingestion.
export interface DocumentExtraction {
  summary: string;
  key_facts: string[];
  financial_figures: string[];
  lease_terms: string[];
  risks: string[];
  missing_information: string[];
  follow_up_questions: string[];
}

// A single weighted scoring line. `category` matches a ScoreCategoryKey in
// src/lib/scoring/model.ts (weights live with the model, not the row).
export interface ScoreCategory {
  category: string; // ScoreCategoryKey
  score: number | null; // 1–10
  commentary: string | null;
  risk_flag: boolean;
}

export interface InvestmentScore {
  score_id: string;
  deal_id: string;
  overall_score: number | null; // 0–100
  recommendation: Recommendation | null;
  summary: string | null; // IC summary (auto-generated placeholder for now)
  categories: ScoreCategory[];
  scored_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecisionLogEntry {
  decision_id: string;
  deal_id: string;
  decision_date: string;
  decision_type: DecisionType;
  decision: string;
  rationale: string | null;
  next_steps: string | null;
  author: string | null;
  created_at: string;
}

// ---- Composite view used by the Deal Detail page ---------------------------
export interface DealFile {
  deal: Deal;
  metrics: DealMetrics | null;
  dueDiligence: DueDiligenceItem[];
  risks: Risk[];
  contacts: Contact[];
  documents: DocumentRecord[];
  score: InvestmentScore | null;
  decisions: DecisionLogEntry[];
}

// ---- Supabase client shape (generated-style) -------------------------------
type Row<T> = T;
type Insert<T> = Partial<T>;
type Update<T> = Partial<T>;

// investment_scores is the header row; category lines live in
// investment_score_categories (1:many). InvestmentScore above is the composite.
export interface InvestmentScoreRow {
  score_id: string;
  deal_id: string;
  overall_score: number | null;
  recommendation: Recommendation | null;
  summary: string | null;
  scored_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvestmentScoreCategoryRow {
  id: string;
  score_id: string;
  deal_id: string;
  category: string;
  score: number | null;
  commentary: string | null;
  risk_flag: boolean;
}

// documents is the file row; the structured extraction is a 1:1 child table.
export interface DocumentRow {
  document_id: string;
  deal_id: string;
  file_name: string;
  file_type: string | null;
  category: DocCategory;
  storage_url: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  summary: string | null;
  ingest_status: DocIngestStatus;
}

export interface DocumentExtractionRow {
  document_id: string;
  deal_id: string;
  summary: string | null;
  key_facts: string[];
  financial_figures: string[];
  lease_terms: string[];
  risks: string[];
  missing_information: string[];
  follow_up_questions: string[];
}

export interface Database {
  public: {
    Tables: {
      deals: { Row: Row<Deal>; Insert: Insert<Deal>; Update: Update<Deal> };
      deal_metrics: { Row: Row<DealMetrics>; Insert: Insert<DealMetrics>; Update: Update<DealMetrics> };
      due_diligence_items: { Row: Row<DueDiligenceItem>; Insert: Insert<DueDiligenceItem>; Update: Update<DueDiligenceItem> };
      risks: { Row: Row<Risk>; Insert: Insert<Risk>; Update: Update<Risk> };
      contacts: { Row: Row<Contact>; Insert: Insert<Contact>; Update: Update<Contact> };
      documents: { Row: Row<DocumentRow>; Insert: Insert<DocumentRow>; Update: Update<DocumentRow> };
      document_extractions: { Row: Row<DocumentExtractionRow>; Insert: Insert<DocumentExtractionRow>; Update: Update<DocumentExtractionRow> };
      investment_scores: { Row: Row<InvestmentScoreRow>; Insert: Insert<InvestmentScoreRow>; Update: Update<InvestmentScoreRow> };
      investment_score_categories: { Row: Row<InvestmentScoreCategoryRow>; Insert: Insert<InvestmentScoreCategoryRow>; Update: Update<InvestmentScoreCategoryRow> };
      decision_log: { Row: Row<DecisionLogEntry>; Insert: Insert<DecisionLogEntry>; Update: Update<DecisionLogEntry> };
    };
  };
}
