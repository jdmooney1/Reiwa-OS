// ============================================================================
// Mock data for Reiwa OS (pre-Supabase). Shapes mirror src/types/database.ts.
// 58 Queens Gate has a full deal file; the rest populate the pipeline board.
// ============================================================================
import type {
  Deal, DealMetrics, DueDiligenceItem, Risk, Contact, DocumentRecord,
  InvestmentScore, DecisionLogEntry, DealFile, Recommendation,
} from "@/types/database";
import { applyTemplate } from "@/lib/dd/templates";
import { buildSampleScore, SAMPLE_SCORES } from "@/lib/scoring/samples";

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
    overall_score: 70.5, recommendation: "proceed", key_risk: "Listed consent delay",
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
    overall_score: 75.5, recommendation: "proceed", key_risk: "Lease expiry / void",
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
    overall_score: 61, recommendation: "proceed_with_caution", key_risk: "Monument constraints",
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
    overall_score: 71, recommendation: "proceed", key_risk: "Pricing tension",
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
    overall_score: 70, recommendation: "proceed", key_risk: "Capex execution",
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
    overall_score: 67, recommendation: "proceed_with_caution", key_risk: "Single-tenant exposure",
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
    overall_score: 86, recommendation: "strong_proceed", key_risk: "Yield compression priced in",
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
    overall_score: 76, recommendation: "proceed", key_risk: "Lease-up risk (resolved)",
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
    overall_score: 36, recommendation: "reject", key_risk: "Business plan undeliverable",
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
    overall_score: 62, recommendation: "proceed_with_caution", key_risk: "Rent regulation (WWS)",
  },
];

// Keep pipeline figures for scored deals exactly in step with the score model.
for (const d of DEALS) {
  if (SAMPLE_SCORES[d.deal_id]) {
    const s = buildSampleScore(d.deal_id, now);
    if (s) {
      d.overall_score = s.overall_score;
      d.recommendation = s.recommendation;
    }
  }
}

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

// 58 Queens Gate DD: the London framework applied, then progressed on the
// live workstreams to reflect a deal mid–due diligence.
const qgDDPatch: Record<string, Partial<DueDiligenceItem>> = {
  "Investment one-liner": { status: "resolved", owner: "JD Mooney", risk_level: "low" },
  "Title & tenure": { status: "in_progress", owner: "Forsters LLP", due_date: "2026-07-10", notes: "Awaiting official copies; confirming freehold and covenants.", linked_documents: ["Queens-Gate-IM.pdf"] },
  "Physical & technical survey": { status: "received", owner: "Malcolm Hollis", due_date: "2026-07-15", notes: "Draft received; reviewing M&E findings.", linked_documents: ["Building-Survey-Draft.pdf"] },
  "Measured floor areas": { status: "reviewed", owner: "Reiwa Analyst", notes: "Areas verified to IPMS; consistent with IM." },
  "Tenancy schedule": { status: "reviewed", owner: "Reiwa Analyst", notes: "Verified against leases; reversion confirmed." },
  "Covenant strength": { status: "received", owner: "Reiwa Analyst", due_date: "2026-07-12" },
  "Listed building / conservation": { status: "issue_identified", owner: "Gerald Eve", due_date: "2026-07-20", notes: "Grade II listing constrains internal reconfiguration; pre-app with RBKC required before committing to the unit mix.", linked_documents: ["Heritage-Statement.pdf"] },
  "EPC / MEES": { status: "issue_identified", owner: "Arup", due_date: "2026-08-05", notes: "Currently EPC D. Capex pathway to EPC B needed for MEES compliance." },
  "Red Book valuation": { status: "resolved", owner: "KF Valuation", due_date: "2026-06-28", notes: "Supports purchase price.", linked_documents: ["Red-Book-Valuation.pdf"] },
  "Capex programme & costing": { status: "in_progress", owner: "Malcolm Hollis", due_date: "2026-07-22", notes: "£6.5m programme being benchmarked; contingency under review." },
  "Base / upside / downside": { status: "reviewed", owner: "Reiwa Analyst", linked_documents: ["Queens-Gate-Underwriting.xlsx"] },
  "Sensitivity analysis": { status: "in_progress", owner: "Reiwa Analyst" },
  "Holding structure": { status: "in_progress", owner: "Mourant", due_date: "2026-08-01", notes: "UK Propco / Jersey Holdco being established." },
  "Japan tax treatment": { status: "requested", owner: "PwC Japan", due_date: "2026-07-25", notes: "TK-GK treatment of UK income/gains for Japanese LPs." },
  "SDLT & transfer tax": { status: "reviewed", owner: "Forsters LLP", notes: "SDLT modelled at 5%; asset deal confirmed." },
  "FX exposure": { status: "requested", owner: "Reiwa Treasury", due_date: "2026-07-30", notes: "Sizing GBP/JPY equity exposure." },
  "Conditions precedent": { status: "in_progress", owner: "Reiwa Analyst", due_date: "2026-07-31" },
};

const qgDD: DueDiligenceItem[] = applyTemplate("london", QG, now).map((item) =>
  qgDDPatch[item.item] ? { ...item, ...qgDDPatch[item.item] } : item,
);

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
  {
    document_id: "doc1", deal_id: QG, file_name: "Queens-Gate-IM.pdf", file_type: "application/pdf",
    category: "Broker Brochure", storage_url: "deal-documents/a1111111/queens-gate-im.pdf",
    uploaded_by: "Reiwa Analyst", uploaded_at: now, summary: "Information memorandum from Knight Frank.",
    ingest_status: "reviewed",
    extraction: {
      summary: "Knight Frank IM for 58 Queens Gate — an off-market prime South Kensington residential building offered at £42.5m. Headline figures are vendor-prepared and require independent verification.",
      key_facts: ["58 Queens Gate, South Kensington (SW7)", "Grade II listed, c. 24,500 sq ft", "Off-market introduction by Knight Frank"],
      financial_figures: ["Guide price: £42,500,000 (≈ £1,735/sq ft)", "Passing rent: £950,000 p.a.", "ERV: £1,450,000 p.a.", "Net initial yield: 2.1%"],
      lease_terms: [],
      risks: ["Vendor-prepared figures — verify independently.", "Listed status referenced but not detailed."],
      missing_information: ["Verified tenancy schedule", "Vendor income & expenditure history", "Detailed listing entry"],
      follow_up_questions: ["Please provide the underlying data behind the headline rent and ERV.", "Confirm the basis of the quoted floor areas."],
    },
  },
  {
    document_id: "doc2", deal_id: QG, file_name: "Queens-Gate-Rent-Roll.xlsx", file_type: "spreadsheet",
    category: "Rent Roll", storage_url: "deal-documents/a1111111/rent-roll.xlsx",
    uploaded_by: "Reiwa Analyst", uploaded_at: now, summary: "Vendor rent roll — multi-let apartments.",
    ingest_status: "extracted",
    extraction: {
      summary: "Rent roll for the multi-let apartments. In-place income is materially below ERV, confirming the reversionary thesis.",
      key_facts: ["Multi-let residential — several apartments", "Income basis as at upload date"],
      financial_figures: ["Total passing rent: £950,000 p.a.", "ERV: £1,450,000 p.a.", "Reversion: £500,000 p.a."],
      lease_terms: ["Mix of ASTs and longer leases — expiries to verify per unit."],
      risks: ["Income reversionary; several units let well below market.", "Potential vacant possession requirements for refurbishment."],
      missing_information: ["Unit-by-unit lease expiry profile", "Arrears schedule", "Service charge reconciliation"],
      follow_up_questions: ["Confirm any rent-free periods, incentives or side letters.", "Which units can be obtained with vacant possession, and when?"],
    },
  },
  {
    document_id: "doc3", deal_id: QG, file_name: "Apartment-5-Lease.pdf", file_type: "application/pdf",
    category: "Lease", storage_url: "deal-documents/a1111111/apartment-5-lease.pdf",
    uploaded_by: "Forsters LLP", uploaded_at: now, summary: "Lease for Apartment 5.",
    ingest_status: "extracted",
    extraction: {
      summary: "Lease for Apartment 5 extracted for the tenancy schedule and covenant review. Key terms to be confirmed against the executed copy.",
      key_facts: ["Demise: Apartment 5", "Parties to confirm"],
      financial_figures: ["Passing rent (unit): £78,000 p.a."],
      lease_terms: ["Term: 12 years from 2019 (expiry 2031)", "Rent review: open market, 5-yearly", "Repairing obligation: FRI", "Break option: none identified"],
      risks: ["Single longer lease may constrain vacant-possession refurbishment timing."],
      missing_information: ["Certified copy of the executed lease", "Any licence for alterations"],
      follow_up_questions: ["Is there a guarantee or rent deposit supporting this tenancy?"],
    },
  },
  {
    document_id: "doc4", deal_id: QG, file_name: "Title-Register-NGL123456.pdf", file_type: "application/pdf",
    category: "Title", storage_url: "deal-documents/a1111111/title.pdf",
    uploaded_by: "Forsters LLP", uploaded_at: now, summary: "Land Registry official copy.",
    ingest_status: "uploaded", extraction: null,
  },
  {
    document_id: "doc5", deal_id: QG, file_name: "Red-Book-Valuation.pdf", file_type: "application/pdf",
    category: "Valuation", storage_url: "deal-documents/a1111111/valuation.pdf",
    uploaded_by: "KF Valuation", uploaded_at: now, summary: "RICS Red Book valuation.",
    ingest_status: "reviewed",
    extraction: {
      summary: "Independent RICS Red Book valuation supporting the purchase price and the debt facility.",
      key_facts: ["Independent RICS valuer", "Basis: Market Value"],
      financial_figures: ["Market Value: £43,000,000", "Net initial yield: 2.1%", "Reversionary yield: 3.2%"],
      lease_terms: [],
      risks: ["Value sensitive to the assumed exit yield and PCL pricing."],
      missing_information: ["Comparable evidence schedule", "Special assumptions / caveats"],
      follow_up_questions: ["Does the valuation reflect the proposed refurbishment business plan and capex?"],
    },
  },
  {
    document_id: "doc6", deal_id: QG, file_name: "Building-Survey-Draft.pdf", file_type: "application/pdf",
    category: "Technical DD", storage_url: "deal-documents/a1111111/survey.pdf",
    uploaded_by: "Malcolm Hollis", uploaded_at: now, summary: "Draft structural & M&E survey.",
    ingest_status: "extracted",
    extraction: {
      summary: "Draft building survey covering structure and M&E. Refurbishment scope and latent-defect risks captured pending intrusive surveys.",
      key_facts: ["Structure broadly sound; services life-expired in parts"],
      financial_figures: ["Indicative refurbishment capex: £6,500,000"],
      lease_terms: [],
      risks: ["Latent defect risk pending intrusive opening-up.", "Asbestos presence to be confirmed."],
      missing_information: ["Asbestos register", "EWS1 / cladding position", "M&E remaining-life schedule"],
      follow_up_questions: ["Are there outstanding statutory notices or compliance defects?"],
    },
  },
  {
    document_id: "doc7", deal_id: QG, file_name: "Heritage-Statement.pdf", file_type: "application/pdf",
    category: "Planning", storage_url: "deal-documents/a1111111/heritage.pdf",
    uploaded_by: "Gerald Eve", uploaded_at: now, summary: "Heritage statement for listed consent.",
    ingest_status: "extracted",
    extraction: {
      summary: "Heritage statement addressing the Grade II listing. Internal reconfiguration is constrained and requires listed building consent.",
      key_facts: ["Grade II listed", "Within an RBKC conservation area"],
      financial_figures: [],
      lease_terms: [],
      risks: ["Listed building consent constrains the target internal reconfiguration.", "Consent timeline could delay the programme."],
      missing_information: ["Pre-application advice from RBKC", "Schedule of consentable works"],
      follow_up_questions: ["What unit mix is deliverable under listed consent, and on what timeline?"],
    },
  },
  {
    document_id: "doc8", deal_id: QG, file_name: "EPC-Certificate.pdf", file_type: "application/pdf",
    category: "EPC", storage_url: "deal-documents/a1111111/epc.pdf",
    uploaded_by: "Arup", uploaded_at: now, summary: "Energy performance certificate.",
    ingest_status: "extracted",
    extraction: {
      summary: "Current EPC rating is D, below the MEES pathway target of EPC B. A capex-led upgrade pathway is required.",
      key_facts: ["Current EPC rating: D"],
      financial_figures: [],
      lease_terms: [],
      risks: ["Below MEES minimum energy efficiency trajectory (EPC B by 2030)."],
      missing_information: ["EPC recommendation report", "Costed pathway to EPC B"],
      follow_up_questions: ["What capex is required to reach EPC B, and can it be combined with the refurbishment?"],
    },
  },
  {
    document_id: "doc9", deal_id: QG, file_name: "Queens-Gate-Underwriting.xlsx", file_type: "spreadsheet",
    category: "Financial Model", storage_url: "deal-documents/a1111111/underwriting.xlsx",
    uploaded_by: "Reiwa Analyst", uploaded_at: now, summary: "Base-case underwriting model.",
    ingest_status: "reviewed",
    extraction: {
      summary: "Reiwa base-case underwriting model for the acquisition and refurbishment.",
      key_facts: ["Base case; 4–5 year hold"],
      financial_figures: ["Total cost: £51,975,000", "LTV: 55%", "Levered IRR: 14.5%", "Equity multiple: 1.80x", "Exit value: £62,000,000"],
      lease_terms: [],
      risks: ["Returns sensitive to exit yield and capex."],
      missing_information: [],
      follow_up_questions: [],
    },
  },
  {
    document_id: "doc10", deal_id: QG, file_name: "Refurb-Cost-Plan.pdf", file_type: "application/pdf",
    category: "Capex Quote", storage_url: "deal-documents/a1111111/cost-plan.pdf",
    uploaded_by: "Malcolm Hollis", uploaded_at: now, summary: "Contractor cost plan (awaiting ingestion).",
    ingest_status: "uploaded", extraction: null,
  },
  {
    document_id: "doc11", deal_id: QG, file_name: "Floorplans.pdf", file_type: "application/pdf",
    category: "Floorplans", storage_url: "deal-documents/a1111111/floorplans.pdf",
    uploaded_by: "Reiwa Analyst", uploaded_at: now, summary: null,
    ingest_status: "uploaded", extraction: null,
  },
  {
    document_id: "doc12", deal_id: QG, file_name: "Site-Photos.zip", file_type: "application/zip",
    category: "Photos", storage_url: "deal-documents/a1111111/photos.zip",
    uploaded_by: "Reiwa Analyst", uploaded_at: now, summary: null,
    ingest_status: "uploaded", extraction: null,
  },
];

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
  const sampleScore = buildSampleScore(id, now);

  if (id === QG) {
    return {
      deal, metrics: qgMetrics, dueDiligence: qgDD, risks: qgRisks,
      contacts: qgContacts, documents: qgDocs, score: sampleScore, decisions: qgDecisions,
    };
  }
  // Other deals: header + (sample score if authored, else a header-only score).
  const headerScore: InvestmentScore | null =
    sampleScore ??
    (overall_score != null && recommendation != null
      ? {
          score_id: `score-${id}`, deal_id: id, overall_score, recommendation,
          summary: null, categories: [], scored_by: null, created_at: now, updated_at: now,
        }
      : null);
  return {
    deal, metrics: null, dueDiligence: [], risks: [], contacts: [],
    documents: [], score: headerScore, decisions: [],
  };
}

export function getNarrative(id: string): DealNarrative | undefined {
  return NARRATIVES[id];
}
