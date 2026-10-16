// ============================================================================
// From a reviewed teaser to the first underwriting version. PURE and
// client-safe: no connection, no clock, no I/O.
// ----------------------------------------------------------------------------
// What the teaser STATES becomes underwriting v1, so the analyst opens the
// Underwriting tab to a version that already carries the broker's figures and
// the tenancy schedule, and a list of what is still theirs to decide.
//
// THE RULES
//   * Stated figures only. Price, NIY, passing rent, ERV and occupancy are
//     carried as given. Nothing is derived here: costs, capex, debt, exit
//     yield, hold period and target IRR are judgements, and stay empty for a
//     person (lib/underwriting/derive.ts makes the same distinction).
//   * The tenancy schedule is kept whole as `assumptions.teaserTenancy`. It
//     becomes `assumptions.rentRoll` (the shape the assessment engine reads)
//     only when EVERY line has a rent and an area: a half rent roll would be
//     modelled as if the missing units did not exist.
//   * Every key carries `assumptions.source = "teaser_intake"`, so a version
//     made this way can never be mistaken for one a person typed.
// ============================================================================
import { SQFT_PER_SQM } from "@/lib/ingestion/deal-seed";
import type { TeaserExtraction } from "@/lib/teaser-intake/schema";

/** One line of the assessment engine's rent roll (lib/underwrite/inputs.ts RentRollRowSchema). */
export interface RentRollLine {
  unit: string;
  tenant: string | null;
  use: "office" | "retail" | "residential" | "industrial" | "hotel" | "other";
  areaSqft: number;
  rentPa: number;
  expiry: string | null;
  breakDate: string | null;
  reviewDate: null;
  reviewBasis: "upward_only";
  ervPa: number | null;
  ervPsf: null;
  guaranteeUntil: null;
  reletCapexPsf: null;
  renewalProb: null;
}

/** The fields of underwriting v1 a teaser may fill, named as investment_cases names them. */
export interface TeaserCaseFields {
  acquisition_price: number | null;
  entry_yield_pct: number | null;
  gross_rental_income: number | null;
  erv: number | null;
  occupancy_pct: number | null;
}

export interface TeaserUnderwriting {
  fields: TeaserCaseFields;
  assumptions: Record<string, unknown>;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/** A date only when the day is written out: "2031-06-30" or "30/06/2031". "June 2031" is not a date. */
export function isoDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (ISO.test(t)) return validDate(t);
  const m = DMY.exec(t);
  if (!m) return null;
  return validDate(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
}
function validDate(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** The teaser's ERV: stated outright, else the sum of a schedule that gives one for every line. */
function statedErv(x: TeaserExtraction): number | null {
  if (x.asset_snapshot.erv_pa !== null) return x.asset_snapshot.erv_pa;
  if (x.tenants.length && x.tenants.every((t) => t.erv_pa !== null)) return x.tenants.reduce((s, t) => s + t.erv_pa!, 0);
  return null;
}

/** A rent roll, only when every line can be modelled; otherwise null. */
export function rentRollFrom(x: TeaserExtraction): RentRollLine[] | null {
  if (x.tenants.length === 0) return null;
  const fallbackUse = engineUse(x.opportunity.asset_type);
  const rows: RentRollLine[] = [];
  for (const [i, t] of x.tenants.entries()) {
    const area = t.area_sq_ft ?? (t.area_sq_m !== null ? Math.round(t.area_sq_m * SQFT_PER_SQM) : null);
    const vacant = /^vacant$/i.test(t.name.trim());
    const rent = t.rent_pa ?? (vacant ? 0 : null);
    if (area === null || rent === null) return null;
    rows.push({
      unit: (t.unit ?? `Line ${i + 1}`).slice(0, 80),
      tenant: vacant ? null : t.name.slice(0, 120),
      use: t.use ?? fallbackUse,
      areaSqft: area, rentPa: rent,
      expiry: isoDate(t.lease_expiry), breakDate: isoDate(t.break_option),
      reviewDate: null, reviewBasis: "upward_only",
      ervPa: t.erv_pa, ervPsf: null, guaranteeUntil: null, reletCapexPsf: null, renewalProb: null,
    });
  }
  return rows;
}

function engineUse(assetType: string | null): RentRollLine["use"] {
  switch (assetType) {
    case "office": case "retail": case "residential": case "industrial": case "hotel": return assetType;
    case "multifamily": case "student housing": return "residential";
    case "logistics": return "industrial";
    default: return "other";
  }
}

export function teaserUnderwriting(x: TeaserExtraction, meta: { fileName: string | null }): TeaserUnderwriting {
  const fields: TeaserCaseFields = {
    acquisition_price: x.deal_terms.guide_price,
    entry_yield_pct: x.deal_terms.niy_percent,
    gross_rental_income: x.asset_snapshot.passing_rent_pa,
    erv: statedErv(x),
    occupancy_pct: x.asset_snapshot.occupancy_percent,
  };
  const assumptions: Record<string, unknown> = { source: "teaser_intake" };
  if (meta.fileName) assumptions.teaserFile = meta.fileName;
  if (x.tenants.length) assumptions.teaserTenancy = x.tenants;
  const rr = rentRollFrom(x);
  if (rr) assumptions.rentRoll = rr;
  if (x.deal_terms.price_basis) assumptions.priceBasis = x.deal_terms.price_basis;
  if (x.deal_terms.sale_structure) assumptions.saleStructure = x.deal_terms.sale_structure;
  return { fields, assumptions };
}

/** True when the teaser gives underwriting anything to start from. */
export function hasUnderwriting(u: TeaserUnderwriting): boolean {
  return Object.values(u.fields).some((v) => v !== null) || Object.keys(u.assumptions).length > 1;
}

// ---- What is left to underwrite --------------------------------------------
/** The inputs an investment committee case needs, and the version field each one lives in. */
export const UNDERWRITING_INPUTS = [
  { key: "acquisitionPrice", label: "Acquisition price", judgement: false },
  { key: "acquisitionCosts", label: "Purchase costs (SDLT / transfer tax, fees)", judgement: true },
  { key: "grossRentalIncome", label: "Passing rent", judgement: false },
  { key: "erv", label: "ERV", judgement: false },
  { key: "noi", label: "NOI (after non-recoverables)", judgement: true },
  { key: "capex", label: "Capex budget", judgement: true },
  { key: "debt", label: "Debt (or LTV)", judgement: true },
  { key: "debtCostPct", label: "Cost of debt", judgement: true },
  { key: "exitYieldPct", label: "Exit yield", judgement: true },
  { key: "holdPeriodYears", label: "Hold period", judgement: true },
  { key: "targetIrr", label: "Target IRR", judgement: true },
  { key: "landValue", label: "Land / building split (depreciation basis)", judgement: true },
] as const;

export interface UnderwritingGap { key: string; label: string; judgement: boolean }

/** The inputs a version still leaves empty. Debt counts as given when either debt or LTV is. */
export function remainingInputs(v: Record<string, unknown> | null): UnderwritingGap[] {
  const has = (k: string) => v !== null && typeof v[k] === "number";
  return UNDERWRITING_INPUTS
    .filter((f) => !(f.key === "debt" ? has("debt") || has("ltvPct") : has(f.key)))
    .map((f) => ({ key: f.key, label: f.label, judgement: f.judgement }));
}
