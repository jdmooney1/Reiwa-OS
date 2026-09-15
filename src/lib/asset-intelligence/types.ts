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

export type ValuationType = "acquisition" | "external" | "internal" | "desktop" | "stabilised";
export type AssetRiskCategory =
  | "leasing" | "development" | "financing" | "valuation" | "legal" | "tax"
  | "regulatory" | "technical" | "environmental" | "counterparty" | "fx";
export type SeverityBand = "low" | "medium" | "high" | "critical";
export type DecisionStatus = "open" | "required" | "decided" | "deferred" | "rejected";

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
  source_opportunity_id: string | null; // the opportunity this asset was converted from
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

// ---- Composite views -------------------------------------------------------
/** Everything attached to one asset (the Asset Intelligence file). */
export interface AssetFile {
  asset: Asset;
  plans: BusinessPlan[];
  periods: PerformancePeriod[];
  valuations: Valuation[];
  risks: AssetRisk[];
  decisions: AssetDecision[];
}
