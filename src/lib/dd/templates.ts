// ============================================================================
// Reiwa Capital — Due Diligence frameworks (London & Amsterdam)
// ----------------------------------------------------------------------------
// A DD template is the firm's standing investment risk-control checklist. It is
// instantiated onto a deal (see applyTemplate) where each line becomes a live,
// owned, status-tracked workstream. Questions and jurisdiction differ by market;
// the section spine is shared so every deal file reads consistently.
// ============================================================================
import type {
  DueDiligenceItem, DdSection, DdJurisdiction, PriorityLevel, RiskLevel, Market,
} from "@/types/database";

export interface DdTemplateItem {
  section: DdSection;
  item: string;
  question: string;
  jurisdiction: DdJurisdiction;
  priority: PriorityLevel;
  risk_level: RiskLevel;
}

export interface DdTemplate {
  id: "london" | "amsterdam";
  name: string;
  market: Market;
  description: string;
  items: DdTemplateItem[];
}

type Mk = (
  section: DdSection,
  item: string,
  question: string,
  priority: PriorityLevel,
  risk_level: RiskLevel,
  jurisdiction?: DdJurisdiction,
) => DdTemplateItem;

/**
 * Builds a market template. The section spine and cross-border / Japan lines are
 * shared; tenure, planning, tax, ESG, valuation and insurance lines branch to the
 * local legal regime (England & Wales vs Netherlands).
 */
function buildTemplate(market: "London" | "Amsterdam"): DdTemplateItem[] {
  const local: DdJurisdiction = market === "London" ? "UK" : "Netherlands";
  const isLondon = market === "London";
  const mk: Mk = (section, item, question, priority, risk_level, jurisdiction = local) =>
    ({ section, item, question, jurisdiction, priority, risk_level });

  return [
    // 1. Executive Summary
    mk("Executive Summary", "Investment one-liner", "Can the opportunity be stated in a single defensible sentence (asset, basis, business plan, return)?", "high", "low"),
    mk("Executive Summary", "Key conditions to proceed", "What are the gating conditions that must clear before IC will commit?", "high", "medium"),

    // 2. Submarket Overview
    mk("Submarket Overview", "Submarket definition", `How is the relevant ${market} submarket defined and what are its supply/demand fundamentals?`, "medium", "low"),
    mk("Submarket Overview", "Pipeline supply", "What competing supply is under construction or consented that could affect rents or values?", "medium", "medium"),

    // 3. Location and Micro Situation
    mk("Location and Micro Situation", "Micro-location quality", "Pitch, frontage, transport connectivity and immediate surroundings — does the micro-location support the thesis?", "high", "low"),
    mk("Location and Micro Situation", "Accessibility & footfall", isLondon ? "Walk times to Underground/rail and footfall counts where relevant?" : "Tram/metro access, bike infrastructure and footfall where relevant?", "low", "low"),

    // 4. Asset Description
    mk("Asset Description", "Physical & technical survey", "Has a full building survey (structure, fabric, M&E) been obtained and reviewed?", "high", "medium"),
    mk("Asset Description", "Measured floor areas", isLondon ? "Are NIA/GIA areas verified to RICS IPMS / Code of Measuring Practice?" : "Are areas (VVO/BVO) verified to NEN 2580?", "high", "medium"),
    mk("Asset Description", "Deleterious materials", "Asbestos register, cladding/EWS1 and any deleterious materials assessed?", "high", "high"),

    // 5. Tenure and Ownership
    isLondon
      ? mk("Tenure and Ownership", "Title & tenure", "Freehold/leasehold confirmed from Land Registry official copies; head-lease terms and ground rent reviewed?", "critical", "high")
      : mk("Tenure and Ownership", "Title & erfpacht", "Kadaster title confirmed; is the land eigendom or erfpacht (ground lease), and what are the canon, indexation and expiry terms?", "critical", "high"),
    mk("Tenure and Ownership", "Encumbrances & rights", "Restrictive covenants, easements, rights of way, wayleaves and overage reviewed?", "high", "medium"),
    mk("Tenure and Ownership", "Vendor's good title", "Can the vendor demonstrate clean, marketable title free of disputes or insolvency issues?", "high", "medium"),

    // 6. Income Profile and Tenancy
    mk("Income Profile and Tenancy", "Tenancy schedule", "Is the tenancy schedule verified against the leases (passing rent, term, expiries, breaks)?", "critical", "high"),
    isLondon
      ? mk("Income Profile and Tenancy", "Lease terms (FRI)", "Are leases full repairing & insuring, with rent review and reinstatement provisions understood?", "high", "medium")
      : mk("Income Profile and Tenancy", "Lease terms (ROZ)", "Do leases follow ROZ standard; how is indexation (CPI) and service-charge recovery structured?", "high", "medium"),
    mk("Income Profile and Tenancy", "Arrears & incentives", "Outstanding arrears, rent-free periods, incentives and side letters disclosed?", "medium", "medium"),
    mk("Income Profile and Tenancy", "WALT & reversion", "Weighted average lease term and the reversionary gap to ERV quantified?", "high", "medium"),

    // 7. Tenant Covenant Review
    isLondon
      ? mk("Tenant Covenant Review", "Covenant strength", "Have tenant accounts / Companies House filings and credit scores been reviewed for the material tenants?", "high", "high")
      : mk("Tenant Covenant Review", "Covenant strength", "Have tenant KvK filings and credit reports been reviewed for the material tenants?", "high", "high"),
    mk("Tenant Covenant Review", "Tenant concentration", "What is the income concentration risk to the top tenants and their sectors?", "medium", "medium"),
    mk("Tenant Covenant Review", "Insolvency exposure", isLondon ? "Any CVA, administration or restructuring risk among tenants?" : "Any tenant insolvency (faillissement / surseance) risk?", "medium", "high"),

    // 8. Planning and Heritage
    isLondon
      ? mk("Planning and Heritage", "Planning status & use class", "Current planning consents, use class (E etc.) and any breaches or enforcement?", "high", "medium")
      : mk("Planning and Heritage", "Zoning (bestemmingsplan)", "Does the current and proposed use comply with the bestemmingsplan / omgevingsplan?", "high", "medium"),
    isLondon
      ? mk("Planning and Heritage", "Listed building / conservation", "Is the building listed or in a conservation area, and what consents constrain the business plan?", "critical", "high")
      : mk("Planning and Heritage", "Monument status", "Is the building a rijksmonument / gemeentelijk monument, and what consents constrain repositioning?", "critical", "high"),
    isLondon
      ? mk("Planning and Heritage", "CIL / s106", "Are Community Infrastructure Levy or s106 obligations triggered by the plan?", "medium", "medium")
      : mk("Planning and Heritage", "Permits (omgevingsvergunning)", "What environmental/building permits are required and is timing achievable?", "medium", "medium"),

    // 9. ESG and Compliance
    isLondon
      ? mk("ESG and Compliance", "EPC / MEES", "Current EPC rating and the pathway to MEES compliance (min. EPC B by 2030)?", "high", "high")
      : mk("ESG and Compliance", "Energy label / Paris-proof", "Current energy label, office label-C obligation and Paris-Proof (2050) trajectory?", "high", "high"),
    mk("ESG and Compliance", "Physical climate risk", "Flood, overheating and other physical climate risks assessed?", "medium", "medium"),
    mk("ESG and Compliance", "Building certifications", "BREEAM/WELL or equivalent status and capex needed to reach target rating?", "low", "low"),

    // 10. Market Commentary
    mk("Market Commentary", "Rental tone & evidence", "Is the underwritten ERV supported by recent comparable lettings?", "high", "medium"),
    mk("Market Commentary", "Yield evidence", "Are entry and exit yields supported by recent investment transactions?", "high", "medium"),

    // 11. Valuation Metrics
    isLondon
      ? mk("Valuation Metrics", "Red Book valuation", "Independent RICS Red Book valuation obtained and reconciled to the underwriting?", "high", "medium")
      : mk("Valuation Metrics", "Independent valuation", "Independent (TEGoVA/RICS) valuation obtained and reconciled to the underwriting?", "high", "medium"),
    mk("Valuation Metrics", "Pricing benchmarks", "Price per sq ft/sq m, NIY and reversionary yield benchmarked against the market?", "medium", "low"),

    // 12. Insurance and Reinstatement Cost
    isLondon
      ? mk("Insurance and Reinstatement Cost", "Reinstatement assessment", "Buildings reinstatement cost assessment (BCIS) and adequacy of cover confirmed?", "medium", "medium")
      : mk("Insurance and Reinstatement Cost", "Reinstatement assessment", "Herbouwwaarde (reinstatement value) assessment and adequacy of cover confirmed?", "medium", "medium"),
    mk("Insurance and Reinstatement Cost", "Insurability & claims", "Is the asset insurable on normal terms; any adverse claims history (flood/subsidence)?", "low", "medium"),

    // 13. Capex Plan
    mk("Capex Plan", "Capex programme & costing", "Is the capex programme fully scoped, costed and benchmarked with contingency?", "high", "high"),
    mk("Capex Plan", "Procurement & contract", isLondon ? "Is a fixed-price (JCT) contract route and programme deliverable?" : "Is a fixed-price (UAV/DNR) contract route and programme deliverable?", "medium", "medium"),

    // 14. Business Plan Scenarios
    mk("Business Plan Scenarios", "Base / upside / downside", "Are base, upside and downside cases modelled with explicit assumptions?", "high", "medium"),
    mk("Business Plan Scenarios", "Sensitivity analysis", "How sensitive are returns to exit yield, rent growth, capex and void/letting voids?", "high", "high"),

    // 15. Exit Strategy
    mk("Exit Strategy", "Exit route & buyer pool", "What is the realistic exit (sale to whom, or refinance) and depth of the buyer pool?", "high", "medium"),
    mk("Exit Strategy", "Hold period & timing", "Is the assumed hold period and exit timing consistent with the business plan and market cycle?", "medium", "medium"),

    // 16. Vendor and Deal Dynamics
    mk("Vendor and Deal Dynamics", "Vendor motivation", "Why is the vendor selling, and how does that affect price, process and certainty?", "medium", "low"),
    mk("Vendor and Deal Dynamics", "Process & competition", "Off-market or competitive; what is the timetable, exclusivity and deposit position?", "medium", "medium"),

    // 17. SWOT
    mk("SWOT", "Strengths & weaknesses", "Have the asset's core strengths and weaknesses been articulated?", "low", "low"),
    mk("SWOT", "Opportunities & threats", "Have the principal opportunities and threats been articulated and tested?", "low", "medium"),

    // 18. Japan Rationale
    mk("Japan Rationale", "Investor fit & narrative", "Why is this asset compelling for Reiwa's Japanese investor base (currency, trophy, diversification)?", "high", "low", "Japan"),
    mk("Japan Rationale", "Reporting & expectations", "Are return, liquidity and reporting expectations aligned with Japanese LP requirements?", "medium", "medium", "Japan"),

    // 19. Cross Border Tax and Holding Structure
    mk("Cross Border Tax and Holding Structure", "Holding structure", "Is the acquisition structure (Propco/Holdco, TK-GK) defined and tax-reviewed?", "critical", "high", "Cross-border"),
    isLondon
      ? mk("Cross Border Tax and Holding Structure", "SDLT & transfer tax", "Is SDLT (and any surcharges) modelled, and the asset-vs-share deal analysed?", "high", "high", "Cross-border")
      : mk("Cross Border Tax and Holding Structure", "RETT & transfer tax", "Is Dutch transfer tax (overdrachtsbelasting, 10.4%) modelled, and asset-vs-share deal analysed?", "high", "high", "Cross-border"),
    mk("Cross Border Tax and Holding Structure", "Japan tax treatment", "Is the treatment of income and gains for Japanese LPs (TK-GK) confirmed by Japan tax advisers?", "high", "high", "Japan"),
    mk("Cross Border Tax and Holding Structure", "Withholding & treaties", "Are withholding taxes and relevant double-tax treaties analysed for distributions?", "medium", "medium", "Cross-border"),

    // 20. Currency Risk and Hedging
    mk("Currency Risk and Hedging", "FX exposure", isLondon ? "What is the GBP/JPY exposure on equity and distributions?" : "What is the EUR/JPY exposure on equity and distributions?", "high", "high", "Cross-border"),
    mk("Currency Risk and Hedging", "Hedging policy", "Is the hedge ratio, instrument and cost defined per the treasury policy?", "medium", "medium", "Cross-border"),

    // 21. Further DD Required
    mk("Further DD Required", "Outstanding items log", "Are all residual / outstanding diligence items logged with owners and dates?", "medium", "medium"),
    mk("Further DD Required", "Conditions precedent", "Are conditions precedent to exchange/completion identified and tracked?", "high", "medium"),
  ];
}

export const LONDON_DD_TEMPLATE: DdTemplate = {
  id: "london",
  name: "London DD Framework",
  market: "London",
  description:
    "Reiwa's UK (England & Wales) diligence framework — title & tenure, MEES/EPC, listed-building and SDLT considerations across all 21 sections.",
  items: buildTemplate("London"),
};

export const AMSTERDAM_DD_TEMPLATE: DdTemplate = {
  id: "amsterdam",
  name: "Amsterdam DD Framework",
  market: "Amsterdam",
  description:
    "Reiwa's Netherlands diligence framework — erfpacht, bestemmingsplan, rijksmonument, energy-label and Dutch RETT considerations across all 21 sections.",
  items: buildTemplate("Amsterdam"),
};

export const DD_TEMPLATES: Record<DdTemplate["id"], DdTemplate> = {
  london: LONDON_DD_TEMPLATE,
  amsterdam: AMSTERDAM_DD_TEMPLATE,
};

/** Pick the default template for a deal's market. */
export function defaultTemplateId(market: Market | null): DdTemplate["id"] {
  return market === "Amsterdam" ? "amsterdam" : "london";
}

/**
 * Instantiate a template onto a deal: each template line becomes a live DD item,
 * Not Started, unowned, with no linked documents yet.
 */
export function applyTemplate(
  templateId: DdTemplate["id"],
  dealId: string,
  now: string = new Date().toISOString(),
): DueDiligenceItem[] {
  return DD_TEMPLATES[templateId].items.map((t, i) => ({
    item_id: `${templateId}-${dealId}-${i}`,
    deal_id: dealId,
    section: t.section,
    item: t.item,
    question: t.question,
    jurisdiction: t.jurisdiction,
    priority: t.priority,
    status: "not_started",
    owner: null,
    due_date: null,
    risk_level: t.risk_level,
    notes: null,
    linked_documents: [],
    created_at: now,
    updated_at: now,
  }));
}
