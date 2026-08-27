// ============================================================================
// Asset Intelligence — demonstration dataset.
// ----------------------------------------------------------------------------
// CLEARLY-FLAGGED DEMO DATA (is_demo=true). Figures are realistic illustrations
// for two test assets, not real transactions:
//   * 16 Conduit Street, Mayfair (operating mixed-use) — links to the existing
//     acquisition underwriting deal (source_deal_id).
//   * Herengracht 472, Amsterdam (value-add / redevelopment).
// Portfolio figures are NOT stored here — they are derived in metrics.ts.
// ============================================================================
import type {
  Organization, Portfolio, Asset, AssetMetrics, BusinessPlan, PerformancePeriod,
  Lease, CapexItem, DevelopmentProject, Milestone, Valuation, Loan, AssetRisk,
  AssetDecision, Adviser, AssetAction, AssetEvent, AssetFile,
} from "@/lib/asset-intelligence/types";

const ORG_ID = "org-meiji";

export const ORGANIZATION: Organization = {
  org_id: ORG_ID, name: "Meiji Shipping", type: "corporate",
};

export const PORTFOLIOS: Portfolio[] = [
  { portfolio_id: "pf-uk", org_id: ORG_ID, name: "UK Portfolio", country: "United Kingdom", currency: "GBP" },
  { portfolio_id: "pf-nl", org_id: ORG_ID, name: "Netherlands Portfolio", country: "Netherlands", currency: "EUR" },
];

// Fill an AssetMetrics with nulls for omitted fields.
function m(p: Partial<AssetMetrics>): AssetMetrics {
  return {
    gross_rental_income: null, noi: null, operating_expenses: null, occupancy_pct: null,
    capex: null, valuation: null, yield_pct: null, debt: null, ltv_pct: null,
    cash_on_cash_pct: null, equity_multiple: null, irr_pct: null, ...p,
  };
}

// ============================================================================
// Asset 1 — 16 Conduit Street (operating mixed-use)
// ============================================================================
const CONDUIT = "asset-conduit";

const conduitAsset: Asset = {
  asset_id: CONDUIT, org_id: ORG_ID, portfolio_id: "pf-uk",
  source_deal_id: "a2222222-2222-2222-2222-222222222222",
  name: "16 Conduit Street", address: "16 Conduit Street, Mayfair", city: "London",
  country: "United Kingdom", market: "London", asset_type: "mixed_use", strategy: "core_plus",
  lifecycle_stage: "operating", currency: "GBP", acquisition_date: "2024-11-15",
  acquisition_price: 58000000, equity_invested: 29000000,
  hold_thesis: "Prime Mayfair mixed-use income with retail anchor and reversionary office upside; manage near-term office vacancy through the lease-event cycle.",
  is_demo: true,
};

const conduitPlans: BusinessPlan[] = [
  {
    plan_id: "cp-uw", asset_id: CONDUIT, plan_type: "underwriting", version: 1,
    as_of_date: "2024-11-15", label: "Acquisition underwriting",
    ...m({ gross_rental_income: 2500000, noi: 2150000, operating_expenses: 350000, occupancy_pct: 92,
      capex: 3000000, valuation: 58000000, yield_pct: 3.7, debt: 29000000, ltv_pct: 50,
      cash_on_cash_pct: 5.0, equity_multiple: 1.6, irr_pct: 12.0 }),
  },
  {
    plan_id: "cp-fc", asset_id: CONDUIT, plan_type: "current_forecast", version: 3,
    as_of_date: "2026-06-30", label: "Q2 2026 forecast",
    ...m({ gross_rental_income: 2450000, noi: 2020000, operating_expenses: 430000, occupancy_pct: 86,
      capex: 3400000, valuation: 59500000, yield_pct: 3.4, debt: 29000000, ltv_pct: 48.7,
      cash_on_cash_pct: 4.4, equity_multiple: 1.55, irr_pct: 10.8 }),
  },
];

const conduitPeriods: PerformancePeriod[] = [
  { period_id: "cpp-q4", asset_id: CONDUIT, period_label: "Q4 2025", period_end: "2025-12-31", status: "closed",
    ...m({ gross_rental_income: 2480000, noi: 2100000, operating_expenses: 380000, occupancy_pct: 90, valuation: 58800000, yield_pct: 3.6, debt: 29000000, ltv_pct: 49.3, cash_on_cash_pct: 4.8 }) },
  { period_id: "cpp-q1", asset_id: CONDUIT, period_label: "Q1 2026", period_end: "2026-03-31", status: "closed",
    ...m({ gross_rental_income: 2460000, noi: 2050000, operating_expenses: 410000, occupancy_pct: 88, valuation: 59000000, yield_pct: 3.5, debt: 29000000, ltv_pct: 49.2, cash_on_cash_pct: 4.6 }) },
  { period_id: "cpp-q2", asset_id: CONDUIT, period_label: "Q2 2026", period_end: "2026-06-30", status: "closed",
    ...m({ gross_rental_income: 2450000, noi: 2020000, operating_expenses: 430000, occupancy_pct: 86, valuation: 59500000, yield_pct: 3.4, debt: 29000000, ltv_pct: 48.7, cash_on_cash_pct: 4.4 }) },
];

const conduitLeases: Lease[] = [
  { lease_id: "cl-1", asset_id: CONDUIT, tenant: "Maison Céline (Retail)", unit: "Ground & Lower Ground", use: "Retail", lease_start: "2019-06-24", lease_expiry: "2034-06-23", break_date: null, rent_review_date: "2029-06-24", passing_rent: 1400000, area_sqft: 3500, erv: 1500000, incentives: null, deposit_guarantee: "6 months rent deposit", status: "occupied", renewal_probability: 85, notes: "Anchor covenant; upward-only reviews." },
  { lease_id: "cl-2", asset_id: CONDUIT, tenant: "Aldgate Advisory LLP", unit: "1st–2nd Floor", use: "Office", lease_start: "2021-01-15", lease_expiry: "2028-01-14", break_date: "2026-12-01", rent_review_date: "2026-09-01", passing_rent: 550000, area_sqft: 6200, erv: 600000, incentives: "3 months rent-free at grant", deposit_guarantee: null, status: "occupied", renewal_probability: 55, notes: "Break option Dec 2026 — re-gear discussions to commence." },
  { lease_id: "cl-3", asset_id: CONDUIT, tenant: "— Vacant —", unit: "3rd Floor", use: "Office", lease_start: null, lease_expiry: null, break_date: null, rent_review_date: null, passing_rent: 0, area_sqft: 3100, erv: 350000, incentives: null, deposit_guarantee: null, status: "vacant", renewal_probability: null, notes: "Void since Q1 2026; Cat A works underway; leasing pipeline active." },
  { lease_id: "cl-4", asset_id: CONDUIT, tenant: "Meridian Capital", unit: "4th Floor", use: "Office", lease_start: "2022-04-01", lease_expiry: "2030-03-31", break_date: null, rent_review_date: "2027-04-01", passing_rent: 300000, area_sqft: 3000, erv: 330000, incentives: null, deposit_guarantee: "Parent guarantee", status: "occupied", renewal_probability: 75, notes: null },
];

const conduitCapex: CapexItem[] = [
  { capex_id: "cc-1", asset_id: CONDUIT, kind: "operating", category: "Reception & common parts refurbishment", original_budget: 1200000, approved_budget: 1350000, committed: 1350000, spent: 900000, forecast: 1400000, cost_to_complete: 500000, contingency: 100000, status: "in_progress", responsible: "Gardiner & Theobald", target_completion: "2026-11-30", comments: "Minor overrun on stone restoration." },
  { capex_id: "cc-2", asset_id: CONDUIT, kind: "operating", category: "3rd Floor Cat A works", original_budget: 400000, approved_budget: 500000, committed: 200000, spent: 50000, forecast: 500000, cost_to_complete: 450000, contingency: 40000, status: "approved", responsible: "Gardiner & Theobald", target_completion: "2026-10-31", comments: "To support pre-let." },
  { capex_id: "cc-3", asset_id: CONDUIT, kind: "operating", category: "Plant & M&E upgrade", original_budget: 600000, approved_budget: 600000, committed: 450000, spent: 300000, forecast: 650000, cost_to_complete: 350000, contingency: 30000, status: "in_progress", responsible: "Gardiner & Theobald", target_completion: "2027-03-31", comments: null },
];

const conduitValuations: Valuation[] = [
  { valuation_id: "cv-1", asset_id: CONDUIT, valuation_date: "2024-11-15", valuer: "CBRE", valuation: 58000000, valuation_type: "acquisition", noi: 2150000, yield_pct: 3.7, erv: 2900000, methodology: "Investment method", key_assumptions: "92% occupancy; ERV £2.9m." },
  { valuation_id: "cv-2", asset_id: CONDUIT, valuation_date: "2025-06-30", valuer: "Knight Frank", valuation: 58500000, valuation_type: "external", noi: 2120000, yield_pct: 3.6, erv: 2900000, methodology: "Investment method", key_assumptions: "Stable retail; office reversion intact." },
  { valuation_id: "cv-3", asset_id: CONDUIT, valuation_date: "2025-12-31", valuer: "Knight Frank", valuation: 58800000, valuation_type: "external", noi: 2100000, yield_pct: 3.6, erv: 2880000, methodology: "Investment method", key_assumptions: null },
  { valuation_id: "cv-4", asset_id: CONDUIT, valuation_date: "2026-06-30", valuer: "CBRE", valuation: 59500000, valuation_type: "external", noi: 2020000, yield_pct: 3.4, erv: 2850000, methodology: "Investment method", key_assumptions: "Yield compression offsets softer NOI; office void assumed re-let H1 2027." },
];

const conduitLoans: Loan[] = [
  { loan_id: "cln-1", asset_id: CONDUIT, lender: "Aareal Bank", original_loan: 29000000, current_balance: 29000000, all_in_rate: 5.6, margin: 2.1, reference_rate: "SONIA", hedging: "Cap at 4.00% (strike)", hedge_expiry: "2027-06-30", maturity: "2029-11-15", amortisation: "Interest only", covenant_ltv: 65, covenant_icr: 1.6, current_icr: 1.9, debt_yield: 7.0, refi_status: "in_place" },
];

const conduitRisks: AssetRisk[] = [
  { risk_id: "cr-1", asset_id: CONDUIT, title: "Office leasing shortfall (3rd floor void)", category: "leasing", description: "3rd floor void plus softening office demand reduces NOI vs underwriting.", probability: 4, financial_impact: 600000, severity: "high", mitigation: "Cat A works + revised incentive package; active leasing pipeline.", owner: "Asset Manager", deadline: "2026-12-31", status: "open" },
  { risk_id: "cr-2", asset_id: CONDUIT, title: "Aldgate Advisory break option (Dec 2026)", category: "leasing", description: "Tenant may exercise break, creating a further void.", probability: 3, financial_impact: 550000, severity: "high", mitigation: "Early re-gear discussions; retention incentive.", owner: "Asset Manager", deadline: "2026-11-30", status: "open" },
  { risk_id: "cr-3", asset_id: CONDUIT, title: "Interest rate cap expiry (2027)", category: "financing", description: "Hedge expiry ahead of loan maturity increases rate exposure.", probability: 3, financial_impact: 300000, severity: "medium", mitigation: "Hedge renewal review in H1 2027.", owner: "Treasury", deadline: "2027-03-31", status: "open" },
  { risk_id: "cr-4", asset_id: CONDUIT, title: "Business rates reassessment", category: "tax", description: "2026 revaluation may raise non-recoverable rates on voids.", probability: 2, financial_impact: 80000, severity: "low", mitigation: "Rating adviser appointed.", owner: "Asset Manager", deadline: null, status: "open" },
];

const conduitDecisions: AssetDecision[] = [
  { decision_id: "cd-1", asset_id: CONDUIT, title: "Approve revised leasing incentive package", issue: "3rd floor void persisting; prospective tenant requires enhanced incentives.", background: "Two viewings converted to proposals; both seek 24-month rent-free equivalent.", options: "(a) Hold current terms; (b) 24-month rent-free to secure 10-year pre-let; (c) Fit-out contribution.", financial_impact: -250000, recommendation: "Approve option (b): 24-month rent-free to secure a 10-year pre-let of the 3rd floor.", decision_maker: "Investment Committee", deadline: "2026-09-15", status: "required", final_decision: null, decision_date: null, rationale: null },
  { decision_id: "cd-2", asset_id: CONDUIT, title: "Aldgate Advisory — re-gear vs re-let", issue: "Break option Dec 2026 approaching.", background: "Tenant in occupation since 2021; market rent has moved.", options: "(a) Offer re-gear with incentive; (b) Plan for vacancy and re-let.", financial_impact: -150000, recommendation: "Open re-gear discussions targeting a 5-year extension.", decision_maker: "Asset Manager", deadline: "2026-10-31", status: "open", final_decision: null, decision_date: null, rationale: null },
];

const conduitAdvisers: Adviser[] = [
  { adviser_id: "ca-1", asset_id: CONDUIT, name: "CBRE", company: "CBRE", role: "Leasing & valuation", workstream: "Leasing / Valuation", contact: "mayfair@cbre.com", responsibility: "Office leasing and half-yearly valuation." },
  { adviser_id: "ca-2", asset_id: CONDUIT, name: "Forsters LLP", company: "Forsters LLP", role: "Legal", workstream: "Legal", contact: "property@forsters.co.uk", responsibility: "Lease documentation and re-gears." },
  { adviser_id: "ca-3", asset_id: CONDUIT, name: "Gardiner & Theobald", company: "Gardiner & Theobald", role: "Project / cost management", workstream: "CapEx", contact: "pm@gardiner.com", responsibility: "Common parts refurbishment and Cat A works." },
];

const conduitActions: AssetAction[] = [
  { action_id: "cac-1", asset_id: CONDUIT, title: "Circulate revised incentive package to IC", owner: "Asset Manager", adviser_id: "ca-1", due_date: "2026-09-10", priority: "high", status: "in_progress", linked_risk_id: "cr-1", linked_decision_id: "cd-1" },
  { action_id: "cac-2", asset_id: CONDUIT, title: "Instruct 3rd floor Cat A works", owner: "Project Manager", adviser_id: "ca-3", due_date: "2026-09-30", priority: "medium", status: "open", linked_risk_id: null, linked_decision_id: null },
  { action_id: "cac-3", asset_id: CONDUIT, title: "Commence Aldgate re-gear discussions", owner: "Asset Manager", adviser_id: "ca-1", due_date: "2026-10-15", priority: "high", status: "open", linked_risk_id: "cr-2", linked_decision_id: "cd-2" },
];

const conduitEvents: AssetEvent[] = [
  { event_id: "ce-1", asset_id: CONDUIT, type: "rent_review", title: "Aldgate Advisory rent review", event_date: "2026-09-01", detail: "Upward-only review to ERV." },
  { event_id: "ce-2", asset_id: CONDUIT, type: "lease_break", title: "Aldgate Advisory break option", event_date: "2026-11-30", detail: "Tenant break; notice window active." },
  { event_id: "ce-3", asset_id: CONDUIT, type: "valuation", title: "H2 2026 external valuation", event_date: "2026-12-31", detail: "Half-yearly external valuation (CBRE)." },
  { event_id: "ce-4", asset_id: CONDUIT, type: "hedge_expiry", title: "Interest-rate cap expiry", event_date: "2027-06-30", detail: "Cap expiry ahead of loan maturity." },
  { event_id: "ce-5", asset_id: CONDUIT, type: "loan_maturity", title: "Aareal loan maturity", event_date: "2029-11-15", detail: "Senior loan maturity / refinancing." },
];

// ============================================================================
// Asset 2 — Herengracht 472 (value-add / redevelopment)
// ============================================================================
const HGR = "asset-herengracht";

const hgrAsset: Asset = {
  asset_id: HGR, org_id: ORG_ID, portfolio_id: "pf-nl",
  source_deal_id: null,
  name: "Herengracht 472", address: "Herengracht 472", city: "Amsterdam",
  country: "Netherlands", market: "Amsterdam", asset_type: "mixed_use", strategy: "value_add",
  lifecycle_stage: "development", currency: "EUR", acquisition_date: "2025-03-20",
  acquisition_price: 22000000, equity_invested: 18000000,
  hold_thesis: "Redevelop a canal-side rijksmonument into prime offices with ground-floor retail; crystallise value through a heritage-sensitive refurbishment to a stabilised institutional asset.",
  is_demo: true,
};

const hgrPlans: BusinessPlan[] = [
  {
    plan_id: "hp-uw", asset_id: HGR, plan_type: "underwriting", version: 1,
    as_of_date: "2025-03-20", label: "Acquisition underwriting (stabilised)",
    ...m({ gross_rental_income: 2900000, noi: 2600000, operating_expenses: 300000, occupancy_pct: 95,
      capex: 12000000, valuation: 48000000, yield_pct: 7.6, debt: 20000000, ltv_pct: 42,
      cash_on_cash_pct: 6.5, equity_multiple: 1.7, irr_pct: 16.0 }),
  },
  {
    plan_id: "hp-fc", asset_id: HGR, plan_type: "current_forecast", version: 2,
    as_of_date: "2026-06-30", label: "Q2 2026 forecast (stabilised)",
    ...m({ gross_rental_income: 2850000, noi: 2550000, operating_expenses: 320000, occupancy_pct: 95,
      capex: 13200000, valuation: 47000000, yield_pct: 7.24, debt: 20000000, ltv_pct: 43,
      cash_on_cash_pct: 6.0, equity_multiple: 1.62, irr_pct: 14.2 }),
  },
];

const hgrPeriods: PerformancePeriod[] = [
  { period_id: "hpp-q4", asset_id: HGR, period_label: "Q4 2025", period_end: "2025-12-31", status: "closed",
    ...m({ gross_rental_income: 0, noi: 0, operating_expenses: 120000, occupancy_pct: 0, capex: 2800000, valuation: 22500000, debt: 5000000 }) },
  { period_id: "hpp-q2", asset_id: HGR, period_label: "Q2 2026", period_end: "2026-06-30", status: "closed",
    ...m({ gross_rental_income: 0, noi: 0, operating_expenses: 140000, occupancy_pct: 0, capex: 6800000, valuation: 24000000, debt: 9500000 }) },
];

const hgrDevelopments: DevelopmentProject[] = [
  { project_id: "hd-1", asset_id: HGR, name: "Herengracht 472 Redevelopment", status: "construction",
    approved_budget: 12000000, committed: 10500000, spent: 6800000, forecast: 13200000, contingency: 800000,
    start_date: "2025-05-01", expected_completion: "2027-06-30", original_completion: "2027-03-31",
    programme_variance_days: 91, notes: "Heritage facade works driving programme and cost variance." },
];

const hgrMilestones: Milestone[] = [
  { milestone_id: "hm-1", project_id: "hd-1", asset_id: HGR, name: "Demolition & strip-out", workstream: "Enabling", baseline_date: "2025-09-30", forecast_date: "2025-10-31", status: "complete", dependencies: null, critical: false },
  { milestone_id: "hm-2", project_id: "hd-1", asset_id: HGR, name: "Structural works", workstream: "Structure", baseline_date: "2026-06-30", forecast_date: "2026-09-15", status: "in_progress", dependencies: "Strip-out complete", critical: true },
  { milestone_id: "hm-3", project_id: "hd-1", asset_id: HGR, name: "Heritage facade restoration", workstream: "Heritage", baseline_date: "2026-09-30", forecast_date: "2026-11-30", status: "at_risk", dependencies: "Monument approval", critical: true },
  { milestone_id: "hm-4", project_id: "hd-1", asset_id: HGR, name: "M&E first fix", workstream: "M&E", baseline_date: "2026-10-31", forecast_date: "2026-12-15", status: "not_started", dependencies: "Structure complete", critical: false },
  { milestone_id: "hm-5", project_id: "hd-1", asset_id: HGR, name: "Practical completion", workstream: "Delivery", baseline_date: "2027-03-31", forecast_date: "2027-06-30", status: "not_started", dependencies: "All works", critical: true },
];

const hgrCapex: CapexItem[] = [
  { capex_id: "hc-1", asset_id: HGR, kind: "development", category: "Structural & envelope", original_budget: 5000000, approved_budget: 5000000, committed: 5000000, spent: 3200000, forecast: 5600000, cost_to_complete: 2400000, contingency: 250000, status: "in_progress", responsible: "Arcadis", target_completion: "2026-09-15", comments: "Ground conditions worse than surveyed." },
  { capex_id: "hc-2", asset_id: HGR, kind: "development", category: "Heritage facade restoration", original_budget: 2500000, approved_budget: 2800000, committed: 2500000, spent: 1500000, forecast: 3100000, cost_to_complete: 1600000, contingency: 200000, status: "in_progress", responsible: "Braaksma & Roos", target_completion: "2026-11-30", comments: "Monument constraints increasing scope." },
  { capex_id: "hc-3", asset_id: HGR, kind: "development", category: "M&E & fit-out", original_budget: 3000000, approved_budget: 3000000, committed: 1000000, spent: 500000, forecast: 3200000, cost_to_complete: 2700000, contingency: 150000, status: "approved", responsible: "Arcadis", target_completion: "2027-03-31", comments: null },
  { capex_id: "hc-4", asset_id: HGR, kind: "development", category: "Professional fees & contingency", original_budget: 1500000, approved_budget: 1200000, committed: 900000, spent: 600000, forecast: 1300000, cost_to_complete: 700000, contingency: 200000, status: "in_progress", responsible: "Arcadis", target_completion: "2027-06-30", comments: null },
];

const hgrValuations: Valuation[] = [
  { valuation_id: "hv-1", asset_id: HGR, valuation_date: "2025-03-20", valuer: "Cushman & Wakefield", valuation: 22000000, valuation_type: "acquisition", noi: null, yield_pct: null, erv: 2900000, methodology: "Residual / comparable", key_assumptions: "As-is with vacant possession." },
  { valuation_id: "hv-2", asset_id: HGR, valuation_date: "2025-12-31", valuer: "Internal", valuation: 22500000, valuation_type: "internal", noi: null, yield_pct: null, erv: 2900000, methodology: "As-is during works", key_assumptions: "Reflects spend to date, no uplift crystallised." },
  { valuation_id: "hv-3", asset_id: HGR, valuation_date: "2026-06-30", valuer: "Cushman & Wakefield", valuation: 24000000, valuation_type: "external", noi: null, yield_pct: null, erv: 2850000, methodology: "Residual (as-is)", key_assumptions: "Partial progress uplift; stabilised value on completion £47m (demo)." },
];

const hgrLoans: Loan[] = [
  { loan_id: "hln-1", asset_id: HGR, lender: "ABN AMRO", original_loan: 20000000, current_balance: 9500000, all_in_rate: 4.9, margin: 2.6, reference_rate: "3M EURIBOR", hedging: "None (development facility)", hedge_expiry: null, maturity: "2028-03-31", amortisation: "Bullet", covenant_ltv: 60, covenant_icr: null, current_icr: null, debt_yield: null, refi_status: "monitoring" },
];

const hgrRisks: AssetRisk[] = [
  { risk_id: "hr-1", asset_id: HGR, title: "Construction cost overrun", category: "development", description: "Forecast cost €13.2m vs €12.0m approved budget (+10%).", probability: 4, financial_impact: 1200000, severity: "high", mitigation: "Value engineering; contingency; revised budget to IC.", owner: "Project Director", deadline: "2026-09-30", status: "open" },
  { risk_id: "hr-2", asset_id: HGR, title: "Heritage / monument approval delay", category: "regulatory", description: "Rijksmonument facade approval could delay the critical path.", probability: 3, financial_impact: 800000, severity: "high", mitigation: "Specialist heritage architect; staged consents with municipality.", owner: "Heritage Architect", deadline: "2026-11-30", status: "open" },
  { risk_id: "hr-3", asset_id: HGR, title: "Programme slippage to practical completion", category: "development", description: "PC forecast 3 months later than baseline.", probability: 4, financial_impact: 900000, severity: "high", mitigation: "Acceleration options under review; float protection.", owner: "Project Director", deadline: "2027-06-30", status: "open" },
  { risk_id: "hr-4", asset_id: HGR, title: "Leasing risk on completion", category: "leasing", description: "Stabilised income depends on pre-letting prime office.", probability: 3, financial_impact: 1500000, severity: "medium", mitigation: "Appoint letting agent; early pre-let strategy.", owner: "Asset Manager", deadline: "2027-01-31", status: "open" },
  { risk_id: "hr-5", asset_id: HGR, title: "EUR/JPY FX exposure", category: "fx", description: "Equity denominated for a JPY investor.", probability: 3, financial_impact: 400000, severity: "medium", mitigation: "Layered equity hedge per treasury policy.", owner: "Treasury", deadline: null, status: "open" },
];

const hgrDecisions: AssetDecision[] = [
  { decision_id: "hd-dec-1", asset_id: HGR, title: "Approve revised construction budget (€13.2m)", issue: "Forecast cost exceeds approved budget by €1.2m.", background: "Ground conditions and heritage facade scope have increased cost since approval.", options: "(a) Approve €1.2m increase; (b) Value-engineer to hold budget; (c) Reduce specification.", financial_impact: -1200000, recommendation: "Approve option (a): €1.2m increase funded from contingency and equity, preserving specification and stabilised value.", decision_maker: "Investment Committee", deadline: "2026-09-30", status: "required", final_decision: null, decision_date: null, rationale: null },
  { decision_id: "hd-dec-2", asset_id: HGR, title: "Facade restoration methodology", issue: "Municipality requires like-for-like restoration of protected elements.", background: "Two compliant methodologies with differing cost and programme.", options: "(a) Traditional hand restoration; (b) Hybrid with off-site fabrication.", financial_impact: -300000, recommendation: "Adopt hybrid methodology to protect programme, subject to heritage sign-off.", decision_maker: "Project Director", deadline: "2026-10-15", status: "required", final_decision: null, decision_date: null, rationale: null },
  { decision_id: "hd-dec-3", asset_id: HGR, title: "Pre-let strategy / anchor tenant", issue: "De-risk stabilised income ahead of completion.", background: "Early interest from professional-services occupiers.", options: "(a) Pre-let now at a discount; (b) Hold for stabilised letting.", financial_impact: null, recommendation: "Appoint letting agent and test pre-let appetite in Q4 2026.", decision_maker: "Asset Manager", deadline: "2026-12-31", status: "open", final_decision: null, decision_date: null, rationale: null },
];

const hgrAdvisers: Adviser[] = [
  { adviser_id: "ha-1", asset_id: HGR, name: "Loyens & Loeff", company: "Loyens & Loeff", role: "Legal / tax", workstream: "Legal", contact: "amsterdam@loyensloeff.com", responsibility: "Dutch legal, erfpacht and tax structuring." },
  { adviser_id: "ha-2", asset_id: HGR, name: "Arcadis", company: "Arcadis", role: "Project & cost management", workstream: "Development", contact: "pm@arcadis.com", responsibility: "Project management, cost control and programme." },
  { adviser_id: "ha-3", asset_id: HGR, name: "Braaksma & Roos", company: "Braaksma & Roos Architecten", role: "Heritage architect", workstream: "Heritage", contact: "info@braaksma-roos.nl", responsibility: "Monument facade restoration and approvals." },
  { adviser_id: "ha-4", asset_id: HGR, name: "Cushman & Wakefield", company: "Cushman & Wakefield", role: "Valuation & leasing", workstream: "Leasing / Valuation", contact: "amsterdam@cushwake.com", responsibility: "Valuation and pre-let strategy." },
];

const hgrActions: AssetAction[] = [
  { action_id: "hac-1", asset_id: HGR, title: "Submit revised budget to Investment Committee", owner: "Project Director", adviser_id: "ha-2", due_date: "2026-09-20", priority: "high", status: "in_progress", linked_risk_id: "hr-1", linked_decision_id: "hd-dec-1" },
  { action_id: "hac-2", asset_id: HGR, title: "Obtain heritage facade approval", owner: "Heritage Architect", adviser_id: "ha-3", due_date: "2026-11-15", priority: "urgent", status: "in_progress", linked_risk_id: "hr-2", linked_decision_id: "hd-dec-2" },
  { action_id: "hac-3", asset_id: HGR, title: "Appoint letting agent for pre-let campaign", owner: "Asset Manager", adviser_id: "ha-4", due_date: "2026-10-31", priority: "medium", status: "open", linked_risk_id: "hr-4", linked_decision_id: "hd-dec-3" },
];

const hgrEvents: AssetEvent[] = [
  { event_id: "he-1", asset_id: HGR, type: "construction_milestone", title: "Structural works completion", event_date: "2026-09-15", detail: "Critical-path milestone." },
  { event_id: "he-2", asset_id: HGR, type: "construction_milestone", title: "Facade restoration commencement", event_date: "2026-10-15", detail: "Subject to methodology decision." },
  { event_id: "he-3", asset_id: HGR, type: "planning_deadline", title: "Heritage facade approval deadline", event_date: "2026-11-30", detail: "Municipality monument sign-off." },
  { event_id: "he-4", asset_id: HGR, type: "valuation", title: "H2 2026 valuation", event_date: "2026-12-31", detail: "As-is progress valuation." },
  { event_id: "he-5", asset_id: HGR, type: "loan_maturity", title: "ABN AMRO facility maturity", event_date: "2028-03-31", detail: "Development facility maturity / refinance to investment loan." },
];

// ============================================================================
// Assembly & accessors
// ============================================================================
const CONDUIT_FILE: AssetFile = {
  asset: conduitAsset, plans: conduitPlans, periods: conduitPeriods, leases: conduitLeases,
  capex: conduitCapex, developments: [], milestones: [], valuations: conduitValuations,
  loans: conduitLoans, risks: conduitRisks, decisions: conduitDecisions, advisers: conduitAdvisers,
  actions: conduitActions, events: conduitEvents,
};

const HGR_FILE: AssetFile = {
  asset: hgrAsset, plans: hgrPlans, periods: hgrPeriods, leases: [],
  capex: hgrCapex, developments: hgrDevelopments, milestones: hgrMilestones, valuations: hgrValuations,
  loans: hgrLoans, risks: hgrRisks, decisions: hgrDecisions, advisers: hgrAdvisers,
  actions: hgrActions, events: hgrEvents,
};

const FILES: Record<string, AssetFile> = {
  [CONDUIT]: CONDUIT_FILE,
  [HGR]: HGR_FILE,
};

export function getOrganization(): Organization {
  return ORGANIZATION;
}
export function getPortfolios(): Portfolio[] {
  return PORTFOLIOS;
}
export function getAssetFiles(): AssetFile[] {
  return Object.values(FILES);
}
export function getAssetFile(id: string): AssetFile | undefined {
  return FILES[id];
}
export function listAssets(): Asset[] {
  return getAssetFiles().map((f) => f.asset);
}
