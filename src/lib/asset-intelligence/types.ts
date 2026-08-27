// ============================================================================
// Asset Intelligence — domain types (mirror supabase/asset-intelligence.sql)
// Reuses shared enums from the deal schema where they carry over.
// ============================================================================
import type {
  Currency, Market, AssetType, Strategy, RiskStatus,
} from "@/types/database";

export type OrgType = "corporate" | "family_office" | "fund" | "jv" | "other";

export type LifecycleStage =
  | "underwriting" | "transaction" | "operating" | "development"
  | "stabilising" | "exit" | "realised";

export type PlanType = "underwriting" | "approved" | "current_forecast";
export type PeriodStatus = "draft" | "closed";

export type LeaseStatus = "occupied" | "vacant" | "under_offer" | "holdover" | "in_fit_out";
export type CapexKind = "operating" | "development";
export type CapexStatus =
  | "planned" | "approved" | "committed" | "in_progress" | "complete" | "on_hold";
export type DevStatus =
  | "feasibility" | "design" | "consents" | "procurement" | "construction" | "handover" | "complete";
export type MilestoneStatus = "not_started" | "in_progress" | "complete" | "delayed" | "at_risk";
export type ValuationType = "acquisition" | "external" | "internal" | "desktop" | "stabilised";
export type RefiStatus =
  | "in_place" | "monitoring" | "refinancing" | "maturity_approaching" | "breach_risk";
export type AssetRiskCategory =
  | "leasing" | "development" | "financing" | "valuation" | "legal" | "tax"
  | "regulatory" | "technical" | "environmental" | "counterparty" | "fx";
export type SeverityBand = "low" | "medium" | "high" | "critical";
export type DecisionStatus = "open" | "required" | "decided" | "deferred" | "rejected";
export type ActionPriority = "low" | "medium" | "high" | "urgent";
export type ActionStatus = "open" | "in_progress" | "blocked" | "complete";
export type EventType =
  | "rent_review" | "lease_break" | "lease_expiry" | "refinancing" | "loan_maturity"
  | "construction_milestone" | "planning_deadline" | "valuation" | "tax_deadline" | "hedge_expiry";

// ---- Tenancy / org ---------------------------------------------------------
export interface Organization {
  org_id: string;
  name: string;
  type: OrgType;
}

export interface Portfolio {
  portfolio_id: string;
  org_id: string;
  name: string;
  country: string | null;
  currency: Currency;
}

// ---- Persistent asset ------------------------------------------------------
export interface Asset {
  asset_id: string;
  org_id: string;
  portfolio_id: string | null;
  source_deal_id: string | null; // the acquisition underwriting case
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  market: Market | null;
  asset_type: AssetType;
  strategy: Strategy | null;
  lifecycle_stage: LifecycleStage;
  currency: Currency;
  acquisition_date: string | null;
  acquisition_price: number | null;
  equity_invested: number | null;
  hold_thesis: string | null;
  is_demo: boolean;
}

// The metric set shared by plans and periods — enables three-way variance.
export interface AssetMetrics {
  gross_rental_income: number | null;
  noi: number | null;
  operating_expenses: number | null;
  occupancy_pct: number | null;
  capex: number | null;
  valuation: number | null;
  yield_pct: number | null;
  debt: number | null;
  ltv_pct: number | null;
  cash_on_cash_pct: number | null;
  equity_multiple: number | null;
  irr_pct: number | null;
}

export interface BusinessPlan extends AssetMetrics {
  plan_id: string;
  asset_id: string;
  plan_type: PlanType;
  version: number;
  as_of_date: string;
  label: string | null;
}

export interface PerformancePeriod extends AssetMetrics {
  period_id: string;
  asset_id: string;
  period_label: string;
  period_end: string;
  status: PeriodStatus;
}

// ---- Leasing ---------------------------------------------------------------
export interface Lease {
  lease_id: string;
  asset_id: string;
  tenant: string;
  unit: string | null;
  use: string | null;
  lease_start: string | null;
  lease_expiry: string | null;
  break_date: string | null;
  rent_review_date: string | null;
  passing_rent: number | null;
  area_sqft: number | null;
  erv: number | null;
  incentives: string | null;
  deposit_guarantee: string | null;
  status: LeaseStatus;
  renewal_probability: number | null;
  notes: string | null;
}

// ---- CapEx / development ---------------------------------------------------
export interface CapexItem {
  capex_id: string;
  asset_id: string;
  kind: CapexKind;
  category: string;
  original_budget: number | null;
  approved_budget: number | null;
  committed: number | null;
  spent: number | null;
  forecast: number | null;
  cost_to_complete: number | null;
  contingency: number | null;
  status: CapexStatus;
  responsible: string | null;
  target_completion: string | null;
  comments: string | null;
}

export interface DevelopmentProject {
  project_id: string;
  asset_id: string;
  name: string;
  status: DevStatus;
  approved_budget: number | null;
  committed: number | null;
  spent: number | null;
  forecast: number | null;
  contingency: number | null;
  start_date: string | null;
  expected_completion: string | null;
  original_completion: string | null;
  programme_variance_days: number | null;
  notes: string | null;
}

export interface Milestone {
  milestone_id: string;
  project_id: string;
  asset_id: string;
  name: string;
  workstream: string | null;
  baseline_date: string | null;
  forecast_date: string | null;
  status: MilestoneStatus;
  dependencies: string | null;
  critical: boolean;
}

// ---- Valuation / financing -------------------------------------------------
export interface Valuation {
  valuation_id: string;
  asset_id: string;
  valuation_date: string;
  valuer: string | null;
  valuation: number | null;
  valuation_type: ValuationType;
  noi: number | null;
  yield_pct: number | null;
  erv: number | null;
  methodology: string | null;
  key_assumptions: string | null;
}

export interface Loan {
  loan_id: string;
  asset_id: string;
  lender: string | null;
  original_loan: number | null;
  current_balance: number | null;
  all_in_rate: number | null;
  margin: number | null;
  reference_rate: string | null;
  hedging: string | null;
  hedge_expiry: string | null;
  maturity: string | null;
  amortisation: string | null;
  covenant_ltv: number | null;
  covenant_icr: number | null;
  current_icr: number | null;
  debt_yield: number | null;
  refi_status: RefiStatus;
}

// ---- Risks / decisions / actions / advisers / events -----------------------
export interface AssetRisk {
  risk_id: string;
  asset_id: string;
  title: string;
  category: AssetRiskCategory;
  description: string | null;
  probability: number | null;
  financial_impact: number | null;
  severity: SeverityBand | null;
  mitigation: string | null;
  owner: string | null;
  deadline: string | null;
  status: RiskStatus;
}

export interface AssetDecision {
  decision_id: string;
  asset_id: string;
  title: string;
  issue: string | null;
  background: string | null;
  options: string | null;
  financial_impact: number | null;
  recommendation: string | null;
  decision_maker: string | null;
  deadline: string | null;
  status: DecisionStatus;
  final_decision: string | null;
  decision_date: string | null;
  rationale: string | null;
}

export interface Adviser {
  adviser_id: string;
  asset_id: string;
  name: string;
  company: string | null;
  role: string | null;
  workstream: string | null;
  contact: string | null;
  responsibility: string | null;
}

export interface AssetAction {
  action_id: string;
  asset_id: string;
  title: string;
  owner: string | null;
  adviser_id: string | null;
  due_date: string | null;
  priority: ActionPriority;
  status: ActionStatus;
  linked_risk_id: string | null;
  linked_decision_id: string | null;
}

export interface AssetEvent {
  event_id: string;
  asset_id: string;
  type: EventType;
  title: string;
  event_date: string;
  detail: string | null;
}

// ---- Composite views -------------------------------------------------------
/** Everything attached to one asset (the Asset Intelligence file). */
export interface AssetFile {
  asset: Asset;
  plans: BusinessPlan[];
  periods: PerformancePeriod[];
  leases: Lease[];
  capex: CapexItem[];
  developments: DevelopmentProject[];
  milestones: Milestone[];
  valuations: Valuation[];
  loans: Loan[];
  risks: AssetRisk[];
  decisions: AssetDecision[];
  advisers: Adviser[];
  actions: AssetAction[];
  events: AssetEvent[];
}
