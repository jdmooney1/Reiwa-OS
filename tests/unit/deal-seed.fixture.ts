// Synthetic deals in the shapes the real broker records take. Fictional names, addresses and figures:
// the real data is not committed.
export const fullDeal = () => ({
  opportunity: {
    name: "Alpha Hall, Testville", address: "8 Test Embankment, London", market: "London",
    asset_type: "Mixed Use", off_market: false, deal_stage: "guided",
    sourcing: "Broker IM, Example Partners LLP (Pat Example)",
  },
  asset_snapshot: {
    size_sq_ft: 20000, building_description: "Hall", heritage_status: "Grade II Listed", year_built: 1945,
    tenure: "Long leasehold", ground_rent: "Peppercorn", unexpired_term_years: 131,
    tenant: "Example Ltd", lease_expiry: "2050", covenant_rating: "D&B 3A3",
    covenant_tangible_net_worth_gbp: ">12,500,000", passing_rent_gbp_pa: 1000000,
    rent_review_mechanism: "5-yearly, CPI-linked, 2.0% cap / 0.5% collar", epc_rating: null, transport_connectivity: null,
  },
  deal_terms: { guide_price_gbp: 13400000, niy_percent: 7.0, price_psf_gbp: 670, currency: "GBP" },
  data_completeness: "full - broker IM email read in full",
});

/** Virtual freehold, an amount of ground rent, WAULT, EPC, amenities, a stated rent per sq ft; source type unknown. */
export const waultDeal = () => ({
  opportunity: {
    name: "Beta Street (eastern end)", address: "Beta Street, London, adjacent to Example Gardens", market: "London",
    asset_type: "Mixed Use", off_market: null, deal_stage: "guided",
    sourcing: "Broker IM (format sample, thread not yet identified)",
  },
  asset_snapshot: {
    size_sq_ft: 10000, tenure: "Virtual freehold", ground_rent_gbp_pa: 100, unexpired_term_years: 892,
    tenant_count: 6, wault_to_expiry_years: 4.2, wault_to_breaks_years: 3.4, epc_rating: "B",
    transport_connectivity: "Underground, short walk", amenities: ["roof terrace", "showers"],
  },
  deal_terms: {
    passing_rent_gbp_pa: 800000, passing_rent_psf_gbp: 80, market_rent_psf_gbp: "130.00+",
    guide_price_gbp: 17500000, niy_percent: 4.59, price_psf_gbp: 1750, currency: "GBP",
  },
  data_completeness: "full - supplied IM text",
});

/** Pre-pricing: null price and yield, a picture that is an external link, retail-only rent. */
export const earlyDeal = () => ({
  opportunity: {
    name: "7 Gamma Street", address: "7 Gamma Street, London W1", market: "London", asset_type: "Mixed Use",
    off_market: true, deal_stage: "early_dialogue", sourcing: "Broker email, Example & Co (Sam Sample)",
  },
  asset_snapshot: { size_sq_ft: 4200, tenure: "Freehold", lift: true, epc_rating: null, transport_connectivity: null },
  deal_terms: { retail_passing_rent_gbp_pa: 270000, guide_price_gbp: null, niy_percent: null, currency: "GBP" },
  documents: { photo_reference_type: "external_url", photo_url: "https://example.com/project/gamma" },
  data_completeness: "full for what's known - pre-pricing",
});

/** Thin: no tenure, attachments identified but not retrieved. */
export const thinDeal = () => ({
  opportunity: {
    name: "9a Delta Street", address: "9a Delta Street, Mayfair, London", market: "London", asset_type: "Mixed Use",
    off_market: true, deal_stage: "guided", sourcing: "Broker email, Example Agents (Jo Sample)",
  },
  asset_snapshot: { building_description: "Retail plus residential", tenure: null, epc_rating: null, transport_connectivity: null },
  deal_terms: { guide_price_gbp: 11000000, niy_percent: null, currency: "GBP" },
  documents: { photo_reference_type: "attachment_not_retrieved", attachments_identified: ["Photos.pdf", "Data.xlsx"] },
  data_completeness: "thin - limited data",
});

/** A record that disagrees with itself and with the tracker, and says so. */
export const conflictDeal = () => ({
  opportunity: {
    name: "25 Epsilon Street & 10 Zeta Lane", address: "25 Epsilon Street & 10 Zeta Lane, London", market: "London",
    asset_type: "Office", off_market: true, deal_stage: "guided",
    sourcing: "Broker email, Example Partners (Alex Lake / Pat Example) - NOTE: tracker lists broker as Someone Else, correct to Example Partners",
  },
  asset_snapshot: { size_sq_ft: 28000, tenure: "Freehold", passing_rent_gbp_pa: 1736000, epc_rating: null, transport_connectivity: null },
  deal_terms: { passing_rent_psf_gbp: 62, guide_price_gbp: 27500000, niy_percent: 6.5, price_psf_gbp: 917, currency: "GBP" },
  data_completeness: "good. PRICE DIFFERS FROM PIPELINE TRACKER (27.5m here vs 26m in spreadsheet) - confirm before publishing",
});

export const file = (...deals: unknown[]) => ({ note: "fixture", deals });
