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

export type DdCategory =
  | "Legal" | "Tax" | "Technical" | "Planning" | "ESG" | "Commercial"
  | "Leasing" | "Valuation" | "Insurance" | "FX" | "Japan Tax" | "Structure";

export type PriorityLevel = "low" | "medium" | "high" | "critical";

export type DdStatus = "open" | "in_progress" | "complete" | "blocked" | "na";

export type RiskLevel = "low" | "medium" | "high";

export type RiskCategory =
  | "market" | "tenant" | "structural" | "legal" | "financial"
  | "regulatory" | "planning" | "esg" | "tax" | "fx" | "execution" | "other";

export type RiskStatus = "open" | "mitigated" | "accepted" | "closed";

export type DocCategory =
  | "Legal" | "Financial" | "Technical" | "Valuation" | "Marketing"
  | "Tax" | "Planning" | "ESG" | "Insurance" | "Correspondence" | "Other";

export type Recommendation =
  | "strong_pursue" | "pursue" | "conditional" | "hold" | "pass";

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
  category: DdCategory;
  item: string;
  description: string | null;
  priority: PriorityLevel;
  status: DdStatus;
  owner: string | null;
  due_date: string | null;
  risk_level: RiskLevel | null;
  notes: string | null;
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
}

export interface InvestmentScore {
  score_id: string;
  deal_id: string;
  location_score: number | null;
  liquidity_score: number | null;
  income_score: number | null;
  reversion_score: number | null;
  capex_score: number | null;
  planning_score: number | null;
  tenant_score: number | null;
  depreciation_score: number | null;
  fx_score: number | null;
  exit_score: number | null;
  overall_score: number | null;
  recommendation: Recommendation | null;
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

export interface Database {
  public: {
    Tables: {
      deals: { Row: Row<Deal>; Insert: Insert<Deal>; Update: Update<Deal> };
      deal_metrics: { Row: Row<DealMetrics>; Insert: Insert<DealMetrics>; Update: Update<DealMetrics> };
      due_diligence_items: { Row: Row<DueDiligenceItem>; Insert: Insert<DueDiligenceItem>; Update: Update<DueDiligenceItem> };
      risks: { Row: Row<Risk>; Insert: Insert<Risk>; Update: Update<Risk> };
      contacts: { Row: Row<Contact>; Insert: Insert<Contact>; Update: Update<Contact> };
      documents: { Row: Row<DocumentRecord>; Insert: Insert<DocumentRecord>; Update: Update<DocumentRecord> };
      investment_scores: { Row: Row<InvestmentScore>; Insert: Insert<InvestmentScore>; Update: Update<InvestmentScore> };
      decision_log: { Row: Row<DecisionLogEntry>; Insert: Insert<DecisionLogEntry>; Update: Update<DecisionLogEntry> };
    };
  };
}
