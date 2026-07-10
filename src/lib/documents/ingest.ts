// ============================================================================
// Document ingestion engine (placeholder for an extraction/LLM backend).
// ----------------------------------------------------------------------------
// generateExtraction() returns structured "deal memory" for a document, keyed
// off its category and grounded in the deal's own figures. Pure & synchronous;
// the UI wraps it with a simulated processing delay. Swap the body for a real
// document-AI call later and keep the signature.
// ============================================================================
import type {
  Deal, DocCategory, DocumentExtraction, DueDiligenceItem, Risk,
  DdSection, DdJurisdiction,
} from "@/types/database";
import { DOC_CATEGORY_BY_KEY } from "@/lib/documents/catalog";
import { formatMoney, formatPct } from "@/lib/format";

const money = (d: Deal, v: number | null | undefined) => formatMoney(v, d.currency);

/** Compose a structured extraction for a document from its category + the deal. */
export function generateExtraction(category: DocCategory, deal: Deal): DocumentExtraction {
  const base: DocumentExtraction = {
    summary: `Auto-extracted summary of the ${category.toLowerCase()} for ${deal.asset_name}. Review and confirm before relying on these findings.`,
    key_facts: [],
    financial_figures: [],
    lease_terms: [],
    risks: [],
    missing_information: [],
    follow_up_questions: [],
  };

  switch (category) {
    case "Rent Roll":
      return {
        ...base,
        summary: `Rent roll for ${deal.asset_name}. Passing rent and unit-level income captured for verification against the tenancy schedule.`,
        key_facts: [`Asset: ${deal.asset_name}`, `Income basis recorded as at upload date`],
        financial_figures: [
          `Passing rent: ${money(deal, deal.passing_rent)} p.a.`,
          `ERV: ${money(deal, deal.erv)} p.a.`,
          `Net initial yield: ${formatPct(deal.niy, 1)}`,
        ],
        lease_terms: ["Multiple tenancies — verify expiries, breaks and review dates per unit."],
        risks: ["Income reversionary; in-place rent below ERV."],
        missing_information: ["Unit-by-unit lease expiry profile", "Arrears schedule", "Service charge reconciliation"],
        follow_up_questions: ["Please confirm any rent-free periods, incentives or side letters."],
      };
    case "Lease":
      return {
        ...base,
        summary: `Lease document for ${deal.asset_name}. Core lease terms extracted for the tenancy schedule and covenant review.`,
        key_facts: ["Single lease — parties and demise to confirm"],
        financial_figures: [`Reference passing rent: ${money(deal, deal.passing_rent)} p.a.`],
        lease_terms: ["Term and expiry — confirm", "Rent review basis — confirm (open market / indexation)", "Repairing obligation — confirm (FRI / ROZ)", "Break options — confirm"],
        risks: ["Lease event / break exposure to be quantified."],
        missing_information: ["Certified copy of the executed lease", "Any licences for alterations or assignments"],
        follow_up_questions: ["Are there guarantees or rent deposits supporting this tenancy?"],
      };
    case "Valuation":
      return {
        ...base,
        summary: `Independent valuation for ${deal.asset_name}, reconciled against the underwriting.`,
        key_facts: ["Independent valuer appointed", "Valuation basis: Market Value"],
        financial_figures: [
          `Guide / reference price: ${money(deal, deal.price_guidance)}`,
          `Net initial yield: ${formatPct(deal.niy, 1)}`,
          `Reversionary yield: ${formatPct(deal.reversionary_yield, 1)}`,
        ],
        lease_terms: [],
        risks: ["Valuation sensitive to exit yield assumptions."],
        missing_information: ["Special assumptions and any caveats", "Comparable evidence schedule"],
        follow_up_questions: ["Does the valuation reflect the proposed business plan and capex?"],
      };
    case "Technical DD":
      return {
        ...base,
        summary: `Technical / building survey for ${deal.asset_name}. Condition and capex implications captured.`,
        key_facts: ["Structure and M&E condition assessed"],
        financial_figures: [`Indicative capex budget: ${money(deal, deal.capex_budget)}`],
        lease_terms: [],
        risks: ["Latent defect risk pending intrusive surveys.", "Deleterious materials / asbestos to confirm."],
        missing_information: ["Asbestos register", "EWS1 / cladding position", "M&E remaining life schedule"],
        follow_up_questions: ["Are there any outstanding statutory notices or compliance defects?"],
      };
    case "Planning":
      return {
        ...base,
        summary: `Planning / heritage document for ${deal.asset_name}. Constraints on the business plan captured.`,
        key_facts: [`Market: ${deal.market ?? deal.city}`],
        financial_figures: [],
        lease_terms: [],
        risks: ["Heritage / listing constraints may limit the proposed works."],
        missing_information: ["Planning history and any enforcement", "Pre-application advice"],
        follow_up_questions: ["What consents are required to deliver the target scheme, and what is the timeline?"],
      };
    case "EPC":
      return {
        ...base,
        summary: `Energy performance certificate for ${deal.asset_name}.`,
        key_facts: ["EPC rating recorded — confirm against MEES / local minimum"],
        financial_figures: [],
        lease_terms: [],
        risks: ["Minimum energy efficiency compliance risk if below threshold."],
        missing_information: ["Recommendation report", "Pathway costing to target rating"],
        follow_up_questions: ["What capex is required to reach the minimum energy rating?"],
      };
    case "Capex Quote":
      return {
        ...base,
        summary: `Capex quotation for ${deal.asset_name}.`,
        key_facts: ["Contractor / consultant quote"],
        financial_figures: [`Business-plan capex budget: ${money(deal, deal.capex_budget)}`],
        lease_terms: [],
        risks: ["Cost inflation / scope creep risk; confirm fixed-price basis."],
        missing_information: ["Detailed scope and exclusions", "Programme and contingency"],
        follow_up_questions: ["Is this a fixed-price quote and what is excluded?"],
      };
    case "Tax Memo":
      return {
        ...base,
        summary: `Tax / structuring memo for ${deal.asset_name}.`,
        key_facts: ["Acquisition structure under review (Propco/Holdco, TK-GK)"],
        financial_figures: [`Transfer tax to model on ${money(deal, deal.price_guidance)}`],
        lease_terms: [],
        risks: ["Cross-border tax leakage risk if structure not optimised."],
        missing_information: ["Confirmation of withholding tax treatment", "Japan tax sign-off"],
        follow_up_questions: ["Is an asset deal or share deal more efficient for transfer tax?"],
      };
    case "Broker Brochure":
    case "Investor Presentation":
      return {
        ...base,
        summary: `Marketing material for ${deal.asset_name}. Headline facts captured; figures to be independently verified.`,
        key_facts: [
          `${deal.asset_name}, ${deal.city}`,
          `Asset type: ${deal.asset_type}`,
          `Vendor: ${deal.vendor_name ?? "—"}`,
        ],
        financial_figures: [
          `Guide price: ${money(deal, deal.price_guidance)}`,
          `Passing rent: ${money(deal, deal.passing_rent)} p.a.`,
          `Target IRR: ${formatPct(deal.target_irr, 1)}`,
        ],
        lease_terms: [],
        risks: ["Vendor-prepared figures — verify independently."],
        missing_information: ["Verified tenancy schedule", "Vendor financials / income history"],
        follow_up_questions: ["Please provide the underlying data behind the headline figures."],
      };
    default:
      return {
        ...base,
        key_facts: [`${category} for ${deal.asset_name}`],
        missing_information: ["Document not yet fully reviewed."],
        follow_up_questions: ["Confirm this document is the latest version."],
      };
  }
}

/** Build a DD item from a document finding (missing info or follow-up). */
export function ddItemFromFinding(
  finding: string,
  category: DocCategory,
  deal: Deal,
  fileName: string,
): DueDiligenceItem {
  const def = DOC_CATEGORY_BY_KEY[category];
  const section: DdSection = def.ddSection;
  const jurisdiction: DdJurisdiction = deal.market === "Amsterdam" ? "Netherlands" : "UK";
  const now = new Date().toISOString();
  return {
    item_id: `doc-task-${Math.random().toString(36).slice(2, 9)}`,
    deal_id: deal.deal_id,
    section,
    item: finding.length > 80 ? finding.slice(0, 77) + "…" : finding,
    question: finding,
    jurisdiction,
    priority: "medium",
    status: "requested",
    owner: null,
    due_date: null,
    risk_level: "medium",
    notes: `Raised from document: ${fileName}`,
    linked_documents: [fileName],
    created_at: now,
    updated_at: now,
  };
}

/** Build a Risk from a document finding. */
export function riskFromFinding(finding: string, deal: Deal, fileName: string): Risk {
  const now = new Date().toISOString();
  return {
    risk_id: `doc-risk-${Math.random().toString(36).slice(2, 9)}`,
    deal_id: deal.deal_id,
    risk_title: finding.length > 80 ? finding.slice(0, 77) + "…" : finding,
    risk_category: "other",
    probability: 3,
    impact: 3,
    risk_score: 9,
    mitigation: `Identified from ${fileName}; mitigation to be defined.`,
    owner: null,
    status: "open",
    created_at: now,
    updated_at: now,
  };
}
