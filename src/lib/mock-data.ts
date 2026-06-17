// ============================================================================
// Mock data for Reiwa OS (pre-Supabase). Shapes mirror src/types/database.ts.
// 58 Queens Gate has a full deal file; the rest populate the pipeline board.
// ============================================================================
import type {
  Deal, DealMetrics, DueDiligenceItem, Risk, Contact, DocumentRecord,
  InvestmentScore, DecisionLogEntry, DealFile, Recommendation,
} from "@/types/database";

/** A deal plus the derived figures the pipeline cards display. */
export interface DealSummary extends Deal {
  overall_score: number | null;
  recommendation: Recommendation | null;
  key_risk: string | null;
}

/** Narrative sections for the Overview tab (not part of the relational schema). */
export interface DealNarrative {
  thesis: string;
  strategicRationale: string;
  businessPlan: string[];
  marketPosition: string;
  japanRationale: string;
  openQuestions: string[];
}

const now = "2026-06-17T09:00:00Z";

// ---- Pipeline deals --------------------------------------------------------
export const DEALS: DealSummary[] = [
  {
    deal_id: "a1111111-1111-1111-1111-111111111111",
    asset_name: "58 Queens Gate",
    address: "58 Queens Gate, South Kensington",
    city: "London", country: "United Kingdom", market: "London",
    submarket: "South Kensington (PCL)", asset_type: "residential",
    strategy: "value_add", deal_stage: "due_diligence", source: "Off-market introduction",
    broker_name: "Knight Frank", vendor_name: "Private family office",
    price_guidance: 42500000, currency: "GBP", size_sqft: 24500, size_sqm: 2276.1,
    passing_rent: 950000, erv: 1450000, niy: 2.1, reversionary_yield: 3.2,
    capex_budget: 6500000, target_irr: 14.5, equity_multiple: 1.8,
    status: "active", probability: 60, created_at: now, updated_at: now,
    overall_score: 6.6, recommendation: "pursue", key_risk: "Listed consent delay",
  },
  {
    deal_id: "a2222222-2222-2222-2222-222222222222",
    asset_name: "16 Conduit Street",
    address: "16 Conduit Street, Mayfair",
    city: "London", country: "United Kingdom", market: "London",
    submarket: "Mayfair / West End", asset_type: "mixed_use",
    strategy: "core_plus", deal_stage: "underwriting", source: "Marketed process",
    broker_name: "Savills", vendor_name: "UK institutional fund",
    price_guidance: 58000000, currency: "GBP", size_sqft: 32000, size_sqm: 2972.9,
    passing_rent: 2300000, erv: 2900000, niy: 3.7, reversionary_yield: 4.5,
    capex_budget: 3000000, target_irr: 12.0, equity_multiple: 1.6,
    status: "active", probability: 45, created_at: now, updated_at: now,
    overall_score: 7.4, recommendation: "pursue", key_risk: "Lease expiry / void",
  },
  {
    deal_id: "a3333333-3333-3333-3333-333333333333",
    asset_name: "Magna Plaza",
    address: "Nieuwezijds Voorburgwal 182",
    city: "Amsterdam", country: "Netherlands", market: "Amsterdam",
    submarket: "Centrum / Dam", asset_type: "mixed_use",
    strategy: "value_add", deal_stage: "screening", source: "Broker teaser",
    broker_name: "CBRE", vendor_name: "European retail fund",
    price_guidance: 85000000, currency: "EUR", size_sqft: 75347, size_sqm: 7000,
    passing_rent: 3800000, erv: 5200000, niy: 4.2, reversionary_yield: 5.5,
    capex_budget: 12000000, target_irr: 15.5, equity_multiple: 1.9,
    status: "active", probability: 35, created_at: now, updated_at: now,
    overall_score: 5.9, recommendation: "conditional", key_risk: "Monument constraints",
  },
  {
    deal_id: "a4444444-4444-4444-4444-444444444444",
    asset_name: "Herengracht 124",
    address: "Herengracht 124", city: "Amsterdam", country: "Netherlands",
    market: "Amsterdam", submarket: "Canal Ring", asset_type: "office",
    strategy: "core", deal_stage: "sourcing", source: "Direct approach",
    broker_name: "JLL", vendor_name: "Dutch pension fund",
    price_guidance: 34000000, currency: "EUR", size_sqft: 41000, size_sqm: 3809,
    passing_rent: 1850000, erv: 1950000, niy: 4.8, reversionary_yield: 5.0,
    capex_budget: 1200000, target_irr: 9.5, equity_multiple: 1.5,
    status: "active", probability: 20, created_at: now, updated_at: now,
    overall_score: 7.1, recommendation: "pursue", key_risk: "Pricing tension",
  },
  {
    deal_id: "a5555555-5555-5555-5555-555555555555",
    asset_name: "120 Fenchurch Street",
    address: "120 Fenchurch Street, City of London",
    city: "London", country: "United Kingdom", market: "London",
    submarket: "City Core", asset_type: "office", strategy: "value_add",
    deal_stage: "investment_committee", source: "Marketed process",
    broker_name: "CBRE", vendor_name: "Overseas REIT",
    price_guidance: 96000000, currency: "GBP", size_sqft: 118000, size_sqm: 10963,
    passing_rent: 4100000, erv: 5600000, niy: 4.0, reversionary_yield: 5.3,
    capex_budget: 14500000, target_irr: 13.8, equity_multiple: 1.7,
    status: "active", probability: 65, created_at: now, updated_at: now,
    overall_score: 7.0, recommendation: "pursue", key_risk: "Capex execution",
  },
  {
    deal_id: "a6666666-6666-6666-6666-666666666666",
    asset_name: "Spaces Vijzelstraat",
    address: "Vijzelstraat 68", city: "Amsterdam", country: "Netherlands",
    market: "Amsterdam", submarket: "Centrum", asset_type: "office",
    strategy: "core_plus", deal_stage: "under_offer", source: "Off-market",
    broker_name: "Cushman & Wakefield", vendor_name: "Family office",
    price_guidance: 47500000, currency: "EUR", size_sqft: 52000, size_sqm: 4831,
    passing_rent: 2600000, erv: 2800000, niy: 5.1, reversionary_yield: 5.4,
    capex_budget: 2200000, target_irr: 11.2, equity_multiple: 1.55,
    status: "active", probability: 55, created_at: now, updated_at: now,
    overall_score: 6.8, recommendation: "pursue", key_risk: "Single-tenant exposure",
  },
  {
    deal_id: "a7777777-7777-7777-7777-777777777777",
    asset_name: "Old Bond Street Retail",
    address: "24 Old Bond Street", city: "London", country: "United Kingdom",
    market: "London", submarket: "Mayfair", asset_type: "retail",
    strategy: "core", deal_stage: "legals", source: "Off-market introduction",
    broker_name: "Knight Frank", vendor_name: "Sovereign wealth fund",
    price_guidance: 72000000, currency: "GBP", size_sqft: 9800, size_sqm: 910,
    passing_rent: 2950000, erv: 3100000, niy: 3.9, reversionary_yield: 4.1,
    capex_budget: 500000, target_irr: 8.8, equity_multiple: 1.45,
    status: "active", probability: 80, created_at: now, updated_at: now,
    overall_score: 8.1, recommendation: "strong_pursue", key_risk: "Yield compression priced in",
  },
  {
    deal_id: "a8888888-8888-8888-8888-888888888888",
    asset_name: "Zuidas Tower B",
    address: "Gustav Mahlerlaan 12", city: "Amsterdam", country: "Netherlands",
    market: "Amsterdam", submarket: "Zuidas", asset_type: "office",
    strategy: "opportunistic", deal_stage: "completed", source: "Marketed process",
    broker_name: "JLL", vendor_name: "Developer",
    price_guidance: 128000000, currency: "EUR", size_sqft: 165000, size_sqm: 15330,
    passing_rent: 6800000, erv: 7400000, niy: 4.9, reversionary_yield: 5.2,
    capex_budget: 6000000, target_irr: 16.0, equity_multiple: 2.0,
    status: "completed", probability: 100, created_at: now, updated_at: now,
    overall_score: 7.6, recommendation: "pursue", key_risk: "Lease-up risk (resolved)",
  },
  {
    deal_id: "a9999999-9999-9999-9999-999999999999",
    asset_name: "Clerkenwell Workspace",
    address: "40 St John Street", city: "London", country: "United Kingdom",
    market: "London", submarket: "Clerkenwell", asset_type: "office",
    strategy: "value_add", deal_stage: "aborted", source: "Marketed process",
    broker_name: "Savills", vendor_name: "Private equity",
    price_guidance: 38000000, currency: "GBP", size_sqft: 46000, size_sqm: 4273,
    passing_rent: 1500000, erv: 2100000, niy: 3.4, reversionary_yield: 4.8,
    capex_budget: 5500000, target_irr: 13.0, equity_multiple: 1.6,
    status: "dead", probability: 0, created_at: now, updated_at: now,
    overall_score: 4.8, recommendation: "pass", key_risk: "Business plan undeliverable",
  },
  {
    deal_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    asset_name: "De Pijp Residential",
    address: "Ferdinand Bolstraat 220", city: "Amsterdam", country: "Netherlands",
    market: "Amsterdam", submarket: "De Pijp", asset_type: "residential",
    strategy: "core_plus", deal_stage: "underwriting", source: "Off-market",
    broker_name: "CBRE", vendor_name: "Housing association",
    price_guidance: 29500000, currency: "EUR", size_sqft: 38000, size_sqm: 3530,
    passing_rent: 1320000, erv: 1620000, niy: 3.8, reversionary_yield: 4.6,
    capex_budget: 1800000, target_irr: 10.5, equity_multiple: 1.5,
    status: "on_hold", probability: 30, created_at: now, updated_at: now,
    overall_score: 6.2, recommendation: "hold", key_risk: "Rent regulation (WWS)",
  },
];

export function getDeals(): DealSummary[] {
  return DEALS;
}

export function getDealSummary(id: string): DealSummary | undefined {
  return DEALS.find((d) => d.deal_id === id);
}

// ============================================================================
// Full deal file — 58 Queens Gate
// ============================================================================
const QG = "a1111111-1111-1111-1111-111111111111";

const qgMetrics: DealMetrics = {
  metric_id: "m1", deal_id: QG,
  purchase_price: 42500000, acquisition_costs: 850000,
  stamp_duty_or_transfer_tax: 2125000, total_cost: 51975000,
  debt_amount: 28586250, ltv: 55.0, interest_rate: 5.75,
  rent: 950000, erv: 1450000, noi: 1305000, capex: 6500000,
  exit_yield: 2.8, exit_value: 62000000, irr: 14.5, equity_multiple: 1.8,
  cash_on_cash: 6.5, yield_on_cost: 2.51, created_at: now, updated_at: now,
};

const qgDD: DueDiligenceItem[] = [
  { item_id: "dd1", deal_id: QG, category: "Legal", item: "Title review", description: "Confirm freehold title, restrictive covenants and rights of way.", priority: "high", status: "in_progress", owner: "Forsters LLP", due_date: "2026-07-10", risk_level: "medium", notes: "Awaiting office copies.", created_at: now, updated_at: now },
  { item_id: "dd2", deal_id: QG, category: "Planning", item: "Listed building consent", description: "Assess scope for internal reconfiguration under Grade II listing.", priority: "critical", status: "open", owner: "Gerald Eve", due_date: "2026-07-20", risk_level: "high", notes: "Conservation area — heritage statement required.", created_at: now, updated_at: now },
  { item_id: "dd3", deal_id: QG, category: "Technical", item: "Building survey", description: "Full structural and M&E condition survey ahead of refurbishment.", priority: "high", status: "in_progress", owner: "Malcolm Hollis", due_date: "2026-07-15", risk_level: "medium", notes: null, created_at: now, updated_at: now },
  { item_id: "dd4", deal_id: QG, category: "Japan Tax", item: "TK/GK structuring review", description: "Confirm tax treatment of UK property income for Japanese LPs via TK-GK.", priority: "high", status: "open", owner: "PwC Japan", due_date: "2026-07-25", risk_level: "medium", notes: "Coordinate with UK structure workstream.", created_at: now, updated_at: now },
  { item_id: "dd5", deal_id: QG, category: "FX", item: "GBP/JPY hedging policy", description: "Define equity hedging approach for JPY-denominated investors.", priority: "medium", status: "open", owner: "Reiwa Treasury", due_date: "2026-07-30", risk_level: "medium", notes: null, created_at: now, updated_at: now },
  { item_id: "dd6", deal_id: QG, category: "ESG", item: "EPC uplift pathway", description: "Plan route from EPC D to minimum EPC B post-refurbishment.", priority: "medium", status: "open", owner: "Arup", due_date: "2026-08-05", risk_level: "low", notes: null, created_at: now, updated_at: now },
  { item_id: "dd7", deal_id: QG, category: "Structure", item: "Acquisition SPV setup", description: "Establish UK Propco / Jersey Holdco structure.", priority: "high", status: "open", owner: "Mourant", due_date: "2026-08-01", risk_level: "medium", notes: null, created_at: now, updated_at: now },
  { item_id: "dd8", deal_id: QG, category: "Valuation", item: "Red Book valuation", description: "Independent RICS valuation to support debt facility.", priority: "medium", status: "complete", owner: "Knight Frank Valuation", due_date: "2026-06-28", risk_level: "low", notes: "Supports purchase price.", created_at: now, updated_at: now },
];

const qgRisks: Risk[] = [
  { risk_id: "r1", deal_id: QG, risk_title: "Listed building consent delay", risk_category: "planning", probability: 4, impact: 4, risk_score: 16, mitigation: "Pre-application engagement with RBKC conservation officer.", owner: "Gerald Eve", status: "open", created_at: now, updated_at: now },
  { risk_id: "r2", deal_id: QG, risk_title: "PCL capital value softening", risk_category: "market", probability: 3, impact: 4, risk_score: 12, mitigation: "Conservative exit pricing; phased sales strategy.", owner: "Reiwa Analyst", status: "open", created_at: now, updated_at: now },
  { risk_id: "r3", deal_id: QG, risk_title: "Refurbishment cost overrun", risk_category: "execution", probability: 3, impact: 3, risk_score: 9, mitigation: "Fixed-price contract with contingency; QS oversight.", owner: "Malcolm Hollis", status: "mitigated", created_at: now, updated_at: now },
  { risk_id: "r4", deal_id: QG, risk_title: "GBP/JPY adverse move", risk_category: "fx", probability: 3, impact: 3, risk_score: 9, mitigation: "Layered equity hedge per treasury policy.", owner: "Reiwa Treasury", status: "open", created_at: now, updated_at: now },
  { risk_id: "r5", deal_id: QG, risk_title: "Interest rate on refinance", risk_category: "financial", probability: 2, impact: 3, risk_score: 6, mitigation: "Conservative 55% LTV; rate cap at drawdown.", owner: "Reiwa Treasury", status: "mitigated", created_at: now, updated_at: now },
];

const qgContacts: Contact[] = [
  { contact_id: "c1", deal_id: QG, name: "Edward Hartley", company: "Knight Frank", role: "Selling agent", email: "e.hartley@knightfrank.com", phone: "+44 20 7629 8171", notes: "Introduced the off-market opportunity.", created_at: now, updated_at: now },
  { contact_id: "c2", deal_id: QG, name: "Sarah Lin", company: "Forsters LLP", role: "Acquisition lawyer", email: "s.lin@forsters.co.uk", phone: "+44 20 7863 8333", notes: null, created_at: now, updated_at: now },
  { contact_id: "c3", deal_id: QG, name: "Aoi Tanaka", company: "PwC Japan", role: "Japan tax adviser", email: "aoi.tanaka@pwc.com", phone: "+81 3 5251 2400", notes: "Leads TK-GK structuring.", created_at: now, updated_at: now },
];

const qgDocs: DocumentRecord[] = [
  { document_id: "doc1", deal_id: QG, file_name: "Queens-Gate-IM.pdf", file_type: "application/pdf", category: "Marketing", storage_url: "deal-documents/a1111111/queens-gate-im.pdf", uploaded_by: "Reiwa Analyst", uploaded_at: now, summary: "Information memorandum from Knight Frank." },
  { document_id: "doc2", deal_id: QG, file_name: "Queens-Gate-Underwriting.xlsx", file_type: "spreadsheet", category: "Financial", storage_url: "deal-documents/a1111111/underwriting.xlsx", uploaded_by: "Reiwa Analyst", uploaded_at: now, summary: "Base-case underwriting model." },
  { document_id: "doc3", deal_id: QG, file_name: "Building-Survey-Draft.pdf", file_type: "application/pdf", category: "Technical", storage_url: "deal-documents/a1111111/survey.pdf", uploaded_by: "Malcolm Hollis", uploaded_at: now, summary: "Draft structural & M&E condition survey." },
  { document_id: "doc4", deal_id: QG, file_name: "Heritage-Statement.pdf", file_type: "application/pdf", category: "Planning", storage_url: "deal-documents/a1111111/heritage.pdf", uploaded_by: "Gerald Eve", uploaded_at: now, summary: "Heritage statement for listed consent." },
  { document_id: "doc5", deal_id: QG, file_name: "Red-Book-Valuation.pdf", file_type: "application/pdf", category: "Valuation", storage_url: "deal-documents/a1111111/valuation.pdf", uploaded_by: "KF Valuation", uploaded_at: now, summary: "RICS Red Book valuation report." },
];

const qgScore: InvestmentScore = {
  score_id: "s1", deal_id: QG, location_score: 9.5, liquidity_score: 8.0,
  income_score: 4.5, reversion_score: 8.0, capex_score: 5.0, planning_score: 4.0,
  tenant_score: 6.0, depreciation_score: 7.0, fx_score: 6.5, exit_score: 7.5,
  overall_score: 6.6, recommendation: "pursue", created_at: now, updated_at: now,
};

const qgDecisions: DecisionLogEntry[] = [
  { decision_id: "dl1", deal_id: QG, decision_date: "2026-06-02", decision_type: "screening", decision: "Proceed to underwriting", rationale: "Trophy PCL asset with reversion potential and limited supply.", next_steps: "Build base-case model; commission building survey.", author: "JD Mooney", created_at: now },
  { decision_id: "dl2", deal_id: QG, decision_date: "2026-06-12", decision_type: "bid", decision: "Submit indicative offer at £42.5m", rationale: "Reflects refurb capex and conservative exit pricing.", next_steps: "Enter due diligence on exclusivity.", author: "JD Mooney", created_at: now },
  { decision_id: "dl3", deal_id: QG, decision_date: "2026-06-16", decision_type: "other", decision: "Open due diligence workstreams", rationale: "Exclusivity granted to 31 July; instruct advisers.", next_steps: "Track DD checklist to IC.", author: "Reiwa Analyst", created_at: now },
];

export const NARRATIVES: Record<string, DealNarrative> = {
  [QG]: {
    thesis:
      "58 Queens Gate is a Grade II–listed stucco-fronted building in the heart of prime South Kensington, currently configured as tired multi-let apartments let well below market. The thesis is to acquire off-market at a discount to vacant possession value, execute a comprehensive refurbishment to best-in-class lateral apartments, and crystallise the reversion from a 2.1% net initial yield toward a 3.2%+ reversionary level — with the principal value driver being capital appreciation on a £/sq ft basis in one of the world's most supply-constrained residential markets.",
    strategicRationale:
      "The asset fits Reiwa's prime-central-London value-add mandate: a defensive, hard-currency store of value with a clearly defined business plan, limited competition for sub-£50m private opportunities, and an exit into both domestic and international ultra-high-net-worth demand. Acquiring off-market avoids a competitive process and preserves the entry discount.",
    businessPlan: [
      "Acquire off-market at £42.5m (c. £1,735/sq ft) on a 12-week exclusivity.",
      "Secure listed building consent for internal reconfiguration into larger lateral units.",
      "Execute £6.5m refurbishment programme over 14 months under a fixed-price contract.",
      "Re-let or sell refurbished units, lifting income toward £1.45m ERV.",
      "Refinance on stabilisation; exit via private sale within a 4–5 year hold.",
    ],
    marketPosition:
      "South Kensington / SW7 remains a top-tier prime central London location with constrained supply, strong international demand and resilient pricing through cycles. Comparable refurbished stock transacts at £2,400–2,800/sq ft; the entry basis plus capex sits materially below replacement and best-in-class resale, providing a margin of safety.",
    japanRationale:
      "For Japanese investors, the deal offers GBP-denominated exposure to a globally recognised trophy location, diversification away from a low-yield domestic market, and a tangible, institutional-quality asset. Returns are underwritten net of a layered GBP/JPY equity hedge, and the holding is structured via a TK-GK arrangement reviewed by PwC Japan for efficient tax treatment of UK income and gains for Japanese LPs.",
    openQuestions: [
      "Scope and timeline of listed building consent — can the target unit mix be delivered?",
      "Final building survey findings on structure and services condition.",
      "Confirmation of TK-GK tax treatment and any Japanese reporting obligations.",
      "Preferred GBP/JPY hedge ratio and cost at the investor level.",
      "Debt terms and rate-cap pricing at the agreed 55% LTV.",
    ],
  },
};

export function getDealFile(id: string): DealFile | undefined {
  const summary = getDealSummary(id);
  if (!summary) return undefined;
  // Strip the derived display fields back to a plain Deal.
  const { overall_score, recommendation, key_risk, ...deal } = summary;
  if (id === QG) {
    return {
      deal, metrics: qgMetrics, dueDiligence: qgDD, risks: qgRisks,
      contacts: qgContacts, documents: qgDocs, score: qgScore, decisions: qgDecisions,
    };
  }
  // Other deals: header + score only (detail not yet authored).
  return {
    deal, metrics: null, dueDiligence: [], risks: [], contacts: [],
    documents: [], score: recommendation
      ? ({
          score_id: `s-${id}`, deal_id: id, location_score: null, liquidity_score: null,
          income_score: null, reversion_score: null, capex_score: null, planning_score: null,
          tenant_score: null, depreciation_score: null, fx_score: null, exit_score: null,
          overall_score, recommendation, created_at: now, updated_at: now,
        } as InvestmentScore)
      : null,
    decisions: [],
  };
}

export function getNarrative(id: string): DealNarrative | undefined {
  return NARRATIVES[id];
}
