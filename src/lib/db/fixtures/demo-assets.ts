// ============================================================================
// Demonstration assets — the seed fixture behind `seedIfEmpty`.
// ----------------------------------------------------------------------------
// This is NOT a mock data layer. It used to be one (src/lib/asset-intelligence/
// mock.ts), read directly by screens, which is exactly why the product could
// show an asset the database had never heard of. Nothing reads it now except
// src/lib/db/seed.ts, which writes these records through the real lifecycle
// chain — property -> opportunity -> investment case -> transaction -> asset —
// so the demo assets exist in Postgres under the same constraints and the same
// RLS as a real one. That is the point of keeping them: a fixture that takes a
// shortcut around the schema proves nothing.
//
// Every record is flagged is_demo = true. The figures are realistic
// illustrations for two assets, not real transactions:
//   * 16 Conduit Street, Mayfair (operating mixed-use)
//   * Herengracht 472, Amsterdam (value-add / redevelopment)
//
// Only the collections the schema actually has are defined here. The fixture
// previously also carried leases, capex, developments, milestones, loans,
// advisers, actions and events; no such tables exist, so the seeder silently
// dropped all of it on the floor. Fabricating data for a model that does not
// exist is how a roadmap gets mistaken for a feature.
// ============================================================================
import type {
  Asset, AssetMetrics, BusinessPlan, PerformancePeriod, Valuation,
  AssetRisk, AssetDecision, AssetFile,
} from "@/lib/asset-intelligence/types";

const ORG_ID = "org-meiji";

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
  source_opportunity_id: null, // resolved by the seeder from the opportunity it creates
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

const conduitValuations: Valuation[] = [
  { valuation_id: "cv-1", asset_id: CONDUIT, valuation_date: "2024-11-15", valuer: "CBRE", valuation: 58000000, valuation_type: "acquisition", noi: 2150000, yield_pct: 3.7, erv: 2900000, methodology: "Investment method", key_assumptions: "92% occupancy; ERV £2.9m." },
  { valuation_id: "cv-2", asset_id: CONDUIT, valuation_date: "2025-06-30", valuer: "Knight Frank", valuation: 58500000, valuation_type: "external", noi: 2120000, yield_pct: 3.6, erv: 2900000, methodology: "Investment method", key_assumptions: "Stable retail; office reversion intact." },
  { valuation_id: "cv-3", asset_id: CONDUIT, valuation_date: "2025-12-31", valuer: "Knight Frank", valuation: 58800000, valuation_type: "external", noi: 2100000, yield_pct: 3.6, erv: 2880000, methodology: "Investment method", key_assumptions: null },
  { valuation_id: "cv-4", asset_id: CONDUIT, valuation_date: "2026-06-30", valuer: "CBRE", valuation: 59500000, valuation_type: "external", noi: 2020000, yield_pct: 3.4, erv: 2850000, methodology: "Investment method", key_assumptions: "Yield compression offsets softer NOI; office void assumed re-let H1 2027." },
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

const HGR = "asset-herengracht";

const hgrAsset: Asset = {
  asset_id: HGR, org_id: ORG_ID, portfolio_id: "pf-nl",
  source_opportunity_id: null,
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

const hgrValuations: Valuation[] = [
  { valuation_id: "hv-1", asset_id: HGR, valuation_date: "2025-03-20", valuer: "Cushman & Wakefield", valuation: 22000000, valuation_type: "acquisition", noi: null, yield_pct: null, erv: 2900000, methodology: "Residual / comparable", key_assumptions: "As-is with vacant possession." },
  { valuation_id: "hv-2", asset_id: HGR, valuation_date: "2025-12-31", valuer: "Internal", valuation: 22500000, valuation_type: "internal", noi: null, yield_pct: null, erv: 2900000, methodology: "As-is during works", key_assumptions: "Reflects spend to date, no uplift crystallised." },
  { valuation_id: "hv-3", asset_id: HGR, valuation_date: "2026-06-30", valuer: "Cushman & Wakefield", valuation: 24000000, valuation_type: "external", noi: null, yield_pct: null, erv: 2850000, methodology: "Residual (as-is)", key_assumptions: "Partial progress uplift; stabilised value on completion £47m (demo)." },
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

const CONDUIT_FILE: AssetFile = {
  asset: conduitAsset, plans: conduitPlans, periods: conduitPeriods,
  valuations: conduitValuations, risks: conduitRisks, decisions: conduitDecisions,
};

const HGR_FILE: AssetFile = {
  asset: hgrAsset, plans: hgrPlans, periods: hgrPeriods,
  valuations: hgrValuations, risks: hgrRisks, decisions: hgrDecisions,
};

/** The demo assets, in seed order. The only export: seeding is the only use. */
export function demoAssetFiles(): AssetFile[] {
  return [CONDUIT_FILE, HGR_FILE];
}
