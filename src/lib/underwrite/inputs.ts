// ============================================================================
// From a deal's records to engine inputs, with the source of every one. PURE.
// ----------------------------------------------------------------------------
// Two tiers, decided by what exists, never by a switch:
//
//   lease   the investment case carries a rent roll (assumptions.rentRoll).
//           Every unit is modelled: expiries, breaks, reviews, guarantees.
//   screen  no rent roll, but a price and an income. The income is split into
//           three tranches expiring around the WAULT, so a single date does not
//           make a cliff. Good enough to rank deals; not good enough to bid on,
//           and the Assessment tab says so.
//
// Precedence for every input: the investment case (the analyst's number), then
// the property record (the building's facts), then the opportunity (what the
// source said), then a dated market default. Each resolved input carries that
// source, so the tab can show "default" next to a default and the assessment can
// rate it. Nothing is inferred silently: a guess is labelled as one.
//
// Nothing here reads a clock: "today" is an argument.
// ============================================================================
import { z } from "zod";
import { USES, type Lease, type Params, type Use, type GroundRent } from "@/lib/underwrite/engine";
import {
  DEFAULTS_AS_OF, LETTING, LIFECYCLE, MARKETS, OTHER_DEFAULTS, REIWA_FEES,
  YEN_POLICY_BASIS, YEN_POLICY_RATE, marketKey, engineUseOf,
} from "@/lib/underwrite/defaults";

// ---------------------------------------------------------------------------
// What the data layer hands over
// ---------------------------------------------------------------------------

export interface DealFacts {
  name: string;
  market: string | null;
  assetType: string;
  currency: string;
  sizeSqft: number | null;
  opportunity: {
    targetPrice: number | null; niy: number | null; passingRent: number | null;
    erv: number | null; capexBudget: number | null;
  };
  property: {
    tenure: string | null; unexpiredTermYears: number | null;
    groundRentPa: number | null; groundRentNote: string | null;
    waultToExpiryYears: number | null; waultToBreaksYears: number | null;
    rentReviewMechanism: string | null; epcRating: string | null;
  };
  /** The current investment case, or the latest one when none is current. Null when there is none. */
  case: {
    caseId: string; version: number;
    acquisitionPrice: number | null; acquisitionCosts: number | null; acquisitionDate: string | null;
    capex: number | null; grossRentalIncome: number | null; noi: number | null; erv: number | null;
    occupancyPct: number | null; debt: number | null; ltvPct: number | null; debtCostPct: number | null;
    entryYieldPct: number | null; exitYieldPct: number | null; holdPeriodYears: number | null;
    assumptions: Record<string, unknown>;
  } | null;
  /** Yen per one unit of the deal currency, from fx_rates; null when not available. */
  fx: { yenPerUnit: number; asOf: string; source: string } | null;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * The inputs the tab lists and the assessment rates. A closed set: the
 * assessment's evidence register may only refer to these keys.
 */
export const INPUT_KEYS = [
  "price", "purchase_costs", "income", "market_rent", "rent_growth", "letting", "lease_terms",
  "exit_yield", "hold", "capex", "running_costs", "ground_rent", "leasehold_term",
  "debt", "tax", "currency", "fees",
] as const;
export type InputKey = (typeof INPUT_KEYS)[number];

export const INPUT_LABEL: Record<InputKey, string> = {
  price: "Purchase price", purchase_costs: "Purchase costs", income: "Income",
  market_rent: "Market rent (ERV)", rent_growth: "Rent growth", letting: "Voids, incentives, renewals",
  lease_terms: "Lease expiries and reviews", exit_yield: "Exit yield", hold: "Hold and dates",
  capex: "Capex", running_costs: "Running costs", ground_rent: "Ground rent",
  leasehold_term: "Leasehold term", debt: "Debt", tax: "Tax", currency: "Currency and hedge", fees: "Reiwa fees",
};

export type InputSource = "case" | "rent_roll" | "property" | "opportunity" | "fx_rates" | "derived" | "default";

export interface InputLine {
  key: InputKey;
  value: string;
  source: InputSource;
  basis: string;
}

export type Tier = "lease" | "screen";

export type Resolved =
  | { ok: true; tier: Tier; leases: Lease[]; params: Params; lines: InputLine[]; gaps: string[] }
  | { ok: false; missing: string[] };

// ---------------------------------------------------------------------------
// Rent roll (stored in investment_cases.assumptions.rentRoll)
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as yyyy-mm-dd");

export const RentRollRowSchema = z.object({
  unit: z.string().min(1).max(80),
  tenant: z.string().max(120).nullable().default(null),
  use: z.enum(USES as [Use, ...Use[]]),
  areaSqft: z.number().min(0).max(5_000_000),
  rentPa: z.number().min(0).max(1e9),
  expiry: isoDate.nullable().default(null),
  breakDate: isoDate.nullable().default(null),
  reviewDate: isoDate.nullable().default(null),
  reviewBasis: z.enum(["upward_only", "open_market", "none"]).default("upward_only"),
  ervPa: z.number().min(0).max(1e9).nullable().default(null),
  ervPsf: z.number().min(0).max(100_000).nullable().default(null),
  guaranteeUntil: isoDate.nullable().default(null),
  reletCapexPsf: z.number().min(0).max(10_000).nullable().default(null),
  renewalProb: z.number().min(0).max(1).nullable().default(null),
}).refine((r) => !(r.guaranteeUntil && r.rentPa <= 0), {
  message: "a guaranteed unit needs the guaranteed rent in rent_pa", path: ["rentPa"],
});
export type RentRollRow = z.infer<typeof RentRollRowSchema>;
export const RentRollSchema = z.array(RentRollRowSchema).max(500);

export const RENT_ROLL_COLUMNS = [
  "unit", "tenant", "use", "area_sqft", "rent_pa", "expiry", "break", "review_date", "review_basis",
  "erv_pa", "erv_psf", "guarantee_until", "relet_capex_psf", "renewal_pct",
] as const;

/** A rent roll as CSV text, for the version form. The inverse of parseRentRollCsv. */
export function rentRollToCsv(rows: RentRollRow[]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    const flat = s.replace(/[\r\n\t]+/g, " ");
    return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
  };
  const lines = rows.map((r) => [
    r.unit, r.tenant, r.use, r.areaSqft, r.rentPa, r.expiry, r.breakDate, r.reviewDate, r.reviewBasis,
    r.ervPa, r.ervPsf, r.guaranteeUntil, r.reletCapexPsf, r.renewalProb === null ? null : Math.round(r.renewalProb * 100),
  ].map(cell).join(","));
  return [RENT_ROLL_COLUMNS.join(","), ...lines].join("\n");
}

function splitCsvLine(line: string, sep: "," | "\t"): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse a pasted rent roll. The header row names the columns (any order; the
 * names in RENT_ROLL_COLUMNS). Refuses the whole table, with every problem
 * listed by row, rather than loading the half that parsed.
 */
export function parseRentRollCsv(text: string): { ok: true; rows: RentRollRow[] } | { ok: false; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) return { ok: true, rows: [] };
  // One separator for the whole table, taken from the header: a tab-separated
  // paste from a spreadsheet keeps "1,200,000" as one figure.
  const sep: "," | "\t" = lines[0].includes("\t") ? "\t" : ",";
  const header = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const unknown = header.filter((h) => !(RENT_ROLL_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) return { ok: false, errors: [`Unknown column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Expected: ${RENT_ROLL_COLUMNS.join(", ")}.`] };
  for (const need of ["unit", "use", "area_sqft", "rent_pa"]) {
    if (!header.includes(need)) return { ok: false, errors: [`The header needs a "${need}" column.`] };
  }
  const errors: string[] = [];
  const rows: RentRollRow[] = [];
  const num = (s: string | undefined) => {
    if (s === undefined || s === "") return null;
    const n = Number(s.replace(/[£€,\s]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  };
  lines.slice(1).forEach((line, i) => {
    const cells = splitCsvLine(line, sep);
    if (cells.length > header.length) {
      errors.push(`Row ${i + 2}: ${cells.length} cells for ${header.length} columns. Quote any figure written with commas ("1,200,000") or paste tab-separated.`);
      return;
    }
    const get = (k: string) => cells[header.indexOf(k)] ?? "";
    const renewal = num(get("renewal_pct"));
    const candidate = {
      unit: get("unit"), tenant: get("tenant") || null, use: get("use").toLowerCase(),
      areaSqft: num(get("area_sqft")) ?? 0, rentPa: num(get("rent_pa")) ?? 0,
      expiry: get("expiry") || null, breakDate: get("break") || null,
      reviewDate: get("review_date") || null, reviewBasis: (get("review_basis") || "upward_only").toLowerCase(),
      ervPa: num(get("erv_pa")), ervPsf: num(get("erv_psf")), guaranteeUntil: get("guarantee_until") || null,
      reletCapexPsf: num(get("relet_capex_psf")), renewalProb: renewal === null ? null : renewal / 100,
    };
    const parsed = RentRollRowSchema.safeParse(candidate);
    if (parsed.success) rows.push(parsed.data);
    else errors.push(`Row ${i + 2}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

// ---------------------------------------------------------------------------
// Overrides (stored in investment_cases.assumptions.model)
// ---------------------------------------------------------------------------

/** Per-deal overrides an analyst may set on a case. Percentages as typed (6.25 = 6.25%). */
export const ModelOverridesSchema = z.object({
  startDate: isoDate,
  holdYears: z.number().int().min(1).max(60),
  exitYieldPct: z.number().min(1).max(20),
  purchaseCostsPct: z.number().min(0).max(20),
  saleCostsPct: z.number().min(0).max(10),
  rentGrowthPct: z.number().min(-5).max(10),
  voidMonths: z.number().min(0).max(36),
  rentFreeMonths: z.number().min(0).max(36),
  renewalPct: z.number().min(0).max(100),
  waultYears: z.number().min(0).max(100),
  ltvPct: z.number().min(0).max(85),
  debtRatePct: z.number().min(0).max(20),
  refiRatePct: z.number().min(0).max(20),
  taxRatePct: z.number().min(0).max(50),
  acqFeePct: z.number().min(0).max(5),
  amFeePct: z.number().min(0).max(3),
  promotePct: z.number().min(0).max(50),
  hurdlePct: z.number().min(0).max(30),
  hedgeRatioPct: z.number().min(0).max(100),
  fxExitSpot: z.number().min(1).max(1000),
  groundRentPct: z.number().min(0).max(50),
  nonRecoverablePct: z.number().min(0).max(30),
  fixedCostsPa: z.number().min(0).max(1e8),
}).partial();
export type ModelOverrides = z.infer<typeof ModelOverridesSchema>;

export function readOverrides(assumptions: Record<string, unknown> | undefined): { overrides: ModelOverrides; problems: string[] } {
  const raw = assumptions?.model;
  if (raw === undefined || raw === null) return { overrides: {}, problems: [] };
  const parsed = ModelOverridesSchema.safeParse(raw);
  if (parsed.success) return { overrides: parsed.data, problems: [] };
  return { overrides: {}, problems: parsed.error.issues.map((x) => `assumptions.model.${x.path.join(".")}: ${x.message}`) };
}

/** "exitYieldPct=6.5" lines, for the version form. Unknown keys are refused, not ignored. */
export function parseOverridesText(text: string): { ok: true; overrides: ModelOverrides } | { ok: false; errors: string[] } {
  const obj: Record<string, unknown> = {};
  const errors: string[] = [];
  const keys = Object.keys(ModelOverridesSchema.shape);
  text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).forEach((l, i) => {
    const m = /^([A-Za-z]+)\s*[=:]\s*(.+)$/.exec(l);
    if (!m) { errors.push(`Line ${i + 1}: expected key = value.`); return; }
    if (!keys.includes(m[1])) { errors.push(`Line ${i + 1}: unknown setting "${m[1]}".`); return; }
    obj[m[1]] = m[1] === "startDate" ? m[2].trim() : Number(m[2].replace(/[%,\s]/g, ""));
  });
  if (errors.length) return { ok: false, errors };
  const parsed = ModelOverridesSchema.safeParse(obj);
  return parsed.success ? { ok: true, overrides: parsed.data }
    : { ok: false, errors: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) };
}

export function overridesToText(o: ModelOverrides): string {
  return Object.entries(o).map(([k, v]) => `${k} = ${v}`).join("\n");
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
const money = (x: number, ccy: string) => `${ccy === "GBP" ? "£" : ccy === "EUR" ? "€" : ""}${Math.round(x).toLocaleString("en-GB")}`;
const pos = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = Math.round(years * 12);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
}

/** The first of the month three months after `today`: a plausible completion when the case gives none. */
export function defaultStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const total = y * 12 + (m - 1) + 3;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

function parseGroundRent(f: DealFacts, overridePct: number | undefined): { gr: GroundRent; line: InputLine } {
  const note = f.property.groundRentNote ?? "";
  const gearedMatch = /(\d+(?:\.\d+)?)\s*%/.exec(note);
  if (overridePct !== undefined) {
    return {
      gr: { kind: "geared", pct: overridePct / 100, minimumPa: f.property.groundRentPa ?? 0 },
      line: { key: "ground_rent", value: `${overridePct}% of rents`, source: "case", basis: "Set on the investment case" },
    };
  }
  if (gearedMatch) {
    const p = Number(gearedMatch[1]) / 100;
    return {
      gr: { kind: "geared", pct: p, minimumPa: f.property.groundRentPa ?? 0 },
      line: { key: "ground_rent", value: `${pct(p, 1)} of rents${pos(f.property.groundRentPa) ? `, minimum ${money(f.property.groundRentPa, f.currency)}` : ""}`, source: "property", basis: `Property record: "${note}"` },
    };
  }
  if (/peppercorn/i.test(note)) {
    return { gr: { kind: "none" }, line: { key: "ground_rent", value: "Peppercorn", source: "property", basis: "Property record" } };
  }
  if (pos(f.property.groundRentPa)) {
    return {
      gr: { kind: "fixed", amountPa: f.property.groundRentPa, growth: 0 },
      line: { key: "ground_rent", value: `${money(f.property.groundRentPa, f.currency)} a year, flat`, source: "property", basis: "Property record; no review assumed" },
    };
  }
  const leasehold = f.property.tenure === "long_leasehold" || f.property.tenure === "short_leasehold";
  return {
    gr: { kind: "none" },
    line: { key: "ground_rent", value: leasehold ? "None recorded" : "None", source: leasehold ? "default" : "property",
      basis: leasehold ? "Leasehold with no ground rent recorded: confirm" : "Freehold or not stated" },
  };
}

/**
 * Resolve a deal into engine inputs. Returns the missing facts instead when the
 * engine cannot run: a price and some measure of income are the minimum.
 */
export function resolveInputs(f: DealFacts, today: string): Resolved {
  const c = f.case;
  const { overrides: o, problems } = readOverrides(c?.assumptions);
  const mk = marketKey(f.market, f.currency);
  const M = MARKETS[mk];
  const lines: InputLine[] = [];
  const gaps: string[] = [...problems];
  const ccy = f.currency;

  // Price.
  const price = c?.acquisitionPrice ?? f.opportunity.targetPrice ?? null;
  const priceSrc: InputSource = c?.acquisitionPrice ? "case" : "opportunity";

  // Rent roll, if any.
  const rr = c?.assumptions?.rentRoll !== undefined ? RentRollSchema.safeParse(c.assumptions.rentRoll) : null;
  if (rr && !rr.success) gaps.push("The rent roll on the investment case could not be read; the screen model was used instead.");
  const rentRoll = rr?.success && rr.data.length > 0 ? rr.data : null;

  // Income for the screen tier.
  const income = c?.grossRentalIncome ?? f.opportunity.passingRent
    ?? (c?.noi != null ? c.noi / (1 - OTHER_DEFAULTS.nonRecoverablePct) : null)
    ?? (pos(price) && pos(f.opportunity.niy) ? price * (f.opportunity.niy / 100) * (1 + M.purchaseCostsPct) : null);
  const incomeSrc: InputSource = c?.grossRentalIncome != null ? "case" : f.opportunity.passingRent != null ? "opportunity" : "derived";
  const incomeBasis = c?.grossRentalIncome != null ? "Investment case"
    : f.opportunity.passingRent != null ? "Passing rent on the opportunity"
    : c?.noi != null ? "Grossed up from the NOI on the investment case: no rent figure recorded"
    : "Back-solved from the quoted NIY and price: no rent figure recorded";

  const missing: string[] = [];
  if (!pos(price)) missing.push("a price (investment case or guide price)");
  if (!rentRoll && !pos(income)) missing.push("an income: gross rent, NOI, passing rent or a quoted NIY");
  if (missing.length) return { ok: false, missing };

  const tier: Tier = rentRoll ? "lease" : "screen";
  const use = rentRoll ? dominantUse(rentRoll) : engineUseOf(f.assetType);
  const L = LETTING[use];
  const startDate = o.startDate ?? c?.acquisitionDate ?? defaultStart(today);

  lines.push({ key: "price", value: money(price!, ccy), source: priceSrc,
    basis: priceSrc === "case" ? `Investment case v${c!.version}` : "Guide price on the opportunity" });

  const purchaseCostsPct = o.purchaseCostsPct !== undefined ? o.purchaseCostsPct / 100
    : c?.acquisitionCosts != null && pos(price) ? c.acquisitionCosts / price! : M.purchaseCostsPct;
  lines.push({ key: "purchase_costs", value: pct(purchaseCostsPct, 1),
    source: o.purchaseCostsPct !== undefined || c?.acquisitionCosts != null ? "case" : "default",
    basis: o.purchaseCostsPct !== undefined || c?.acquisitionCosts != null ? "Investment case" : `${M.label} default: ${M.purchaseCostsBasis}` });

  // Leases.
  let leases: Lease[];
  const ervTotal = c?.erv ?? f.opportunity.erv ?? null;
  if (rentRoll) {
    leases = rentRoll.map((r) => ({
      unit: r.unit, tenant: r.tenant, use: r.use, areaSqft: r.areaSqft, rentPa: r.rentPa,
      expiry: r.expiry ?? (r.rentPa > 0 ? null : startDate), breakDate: r.breakDate, reviewDate: r.reviewDate,
      reviewBasis: r.reviewBasis, ervPa: r.ervPa, ervPsf: r.ervPsf, guaranteeUntil: r.guaranteeUntil,
      reletCapexPsf: r.reletCapexPsf, renewalProb: r.renewalProb,
    }));
    const passing = rentRoll.reduce((s, r) => s + r.rentPa, 0);
    lines.push({ key: "income", value: `${money(passing, ccy)} a year across ${rentRoll.length} units`, source: "rent_roll", basis: `Rent roll on investment case v${c!.version}` });
    const withErv = rentRoll.filter((r) => r.ervPa != null || r.ervPsf != null).length;
    lines.push({ key: "market_rent", value: `${withErv} of ${rentRoll.length} units carry an ERV`, source: "rent_roll",
      basis: withErv < rentRoll.length ? "Units without an ERV are re-let at their passing rent" : "Rent roll" });
    lines.push({ key: "lease_terms", value: "Unit by unit from the rent roll", source: "rent_roll", basis: "Expiries, breaks, reviews and guarantees as entered" });
  } else {
    const occ = c?.occupancyPct != null ? c.occupancyPct / 100 : null;
    const wault = o.waultYears ?? f.property.waultToExpiryYears ?? OTHER_DEFAULTS.waultYears;
    const waultSrc: InputSource = o.waultYears !== undefined ? "case" : f.property.waultToExpiryYears != null ? "property" : "default";
    const area = f.sizeSqft ?? 0;
    const ervLet = ervTotal != null ? (occ != null && occ > 0 ? ervTotal * occ : ervTotal) : income!;
    const ervVacant = ervTotal != null && occ != null && occ < 1 ? ervTotal * (1 - occ) : 0;
    // Three tranches expiring at half, one and one-and-a-half times the WAULT: same
    // weighted term, no single cliff.
    leases = [0.5, 1, 1.5].map((k, i) => ({
      unit: `Income tranche ${i + 1}`, tenant: null, use, areaSqft: area / 3,
      rentPa: income! / 3, expiry: addYears(startDate, Math.max(0.25, wault * k)),
      breakDate: f.property.waultToBreaksYears != null ? addYears(startDate, Math.max(0.25, f.property.waultToBreaksYears * k)) : null,
      reviewDate: null, reviewBasis: "none" as const, ervPa: ervLet / 3,
    }));
    if (ervVacant > 0) leases.push({ unit: "Vacant space", tenant: null, use, areaSqft: area * (1 - (occ ?? 1)), rentPa: 0, expiry: startDate, ervPa: ervVacant });
    lines.push({ key: "income", value: `${money(income!, ccy)} a year`, source: incomeSrc,
      basis: incomeBasis });
    lines.push({ key: "market_rent", value: ervTotal != null ? `${money(ervTotal, ccy)} a year` : "Not recorded: re-let at passing rent",
      source: ervTotal != null ? (c?.erv != null ? "case" : "opportunity") : "default",
      basis: ervTotal != null ? "Headline ERV, not unit by unit" : "No ERV, so no reversion is modelled" });
    lines.push({ key: "lease_terms", value: `WAULT ${wault.toFixed(1)} years, as three tranches${f.property.waultToBreaksYears != null ? `; ${f.property.waultToBreaksYears.toFixed(1)} years to breaks` : ""}`,
      source: waultSrc, basis: waultSrc === "default" ? "No WAULT recorded: assumed" : waultSrc === "property" ? "Property record" : "Investment case" });
    gaps.push("No rent roll: modelled at screening level. Enter one on the investment case before bidding.");
  }

  const growthAdd = o.rentGrowthPct !== undefined ? o.rentGrowthPct / 100 : null;
  const ervGrowth = growthAdd !== null ? Object.fromEntries(USES.map((u) => [u, growthAdd])) as Record<Use, number> : M.ervGrowth;
  lines.push({ key: "rent_growth", value: growthAdd !== null ? `${pct(growthAdd, 1)} a year` : `${pct(M.ervGrowth[use], 1)} a year (${use})`,
    source: growthAdd !== null ? "case" : "default", basis: growthAdd !== null ? "Investment case" : `${M.label} default, ${DEFAULTS_AS_OF}; not a forecast` });

  const voidMonths = o.voidMonths ?? L.voidMonths, rentFreeMonths = o.rentFreeMonths ?? L.rentFreeMonths;
  const renewalProb = o.renewalPct !== undefined ? o.renewalPct / 100 : L.renewalProb;
  const lettingSet = o.voidMonths !== undefined || o.rentFreeMonths !== undefined || o.renewalPct !== undefined;
  lines.push({ key: "letting", value: `${voidMonths} months void, ${rentFreeMonths} months rent free, ${Math.round(renewalProb * 100)}% renew`,
    source: lettingSet ? "case" : "default", basis: lettingSet ? "Investment case" : `Default for ${use}` });

  // A yield of zero would value the building at infinity: treated as not recorded.
  const exitYield = o.exitYieldPct !== undefined ? o.exitYieldPct / 100
    : pos(c?.exitYieldPct) ? c!.exitYieldPct! / 100
    : pos(c?.entryYieldPct) ? c!.entryYieldPct! / 100
    : pos(f.opportunity.niy) ? f.opportunity.niy / 100 : null;
  const exitSrc: InputSource = o.exitYieldPct !== undefined || pos(c?.exitYieldPct) || pos(c?.entryYieldPct) ? "case" : pos(f.opportunity.niy) ? "opportunity" : "default";
  const ey = exitYield ?? 0.06;
  lines.push({ key: "exit_yield", value: pct(ey), source: exitSrc,
    basis: o.exitYieldPct !== undefined || pos(c?.exitYieldPct) ? "Investment case" : exitYield !== null ? "Assumed equal to the entry yield: no compression or expansion" : "No yield recorded: 6% assumed" });

  const hold = o.holdYears ?? (c?.holdPeriodYears ? Math.round(c.holdPeriodYears) : OTHER_DEFAULTS.holdYears);
  lines.push({ key: "hold", value: `${hold} years from ${startDate}`, source: o.holdYears !== undefined || c?.holdPeriodYears ? "case" : "default",
    basis: c?.acquisitionDate || o.startDate ? "Investment case" : "Completion assumed three months out" });

  const initialCapex = c?.capex ?? f.opportunity.capexBudget ?? 0;
  lines.push({ key: "capex", value: `${money(initialCapex, ccy)} in year 1; re-letting fit-outs; lifecycle from year ${LIFECYCLE.sinkFromYear}`,
    source: c?.capex != null ? "case" : f.opportunity.capexBudget != null ? "opportunity" : "default",
    basis: c?.capex == null && f.opportunity.capexBudget == null ? "No capex budget recorded" : "Investment case or opportunity" });

  const nonRec = o.nonRecoverablePct !== undefined ? o.nonRecoverablePct / 100 : OTHER_DEFAULTS.nonRecoverablePct;
  const fixed = o.fixedCostsPa ?? Math.max(OTHER_DEFAULTS.fixedCostsFloor, price! * OTHER_DEFAULTS.fixedCostsShare);
  lines.push({ key: "running_costs", value: `${pct(nonRec, 1)} of rent + ${money(fixed, ccy)} a year`,
    source: o.nonRecoverablePct !== undefined || o.fixedCostsPa !== undefined ? "case" : "default", basis: "Irrecoverables and vehicle costs" });

  const { gr, line: grLine } = parseGroundRent(f, o.groundRentPct);
  lines.push(grLine);

  const leasehold = f.property.tenure === "long_leasehold" || f.property.tenure === "short_leasehold";
  const startYear = Number(startDate.slice(0, 4)) + (Number(startDate.slice(5, 7)) - 1) / 12;
  const leaseholdExpiry = leasehold && f.property.unexpiredTermYears != null ? startYear + f.property.unexpiredTermYears : null;
  lines.push({ key: "leasehold_term", value: leasehold ? (f.property.unexpiredTermYears != null ? `${f.property.unexpiredTermYears} years unexpired` : "Leasehold, term not recorded") : (f.property.tenure ?? "Not recorded"),
    source: f.property.tenure ? "property" : "default",
    basis: leasehold && f.property.unexpiredTermYears == null ? "No term: no lease decay modelled. Confirm." : "Property record" });
  if (leasehold && f.property.unexpiredTermYears == null) gaps.push("Leasehold with no unexpired term recorded.");

  const ltv = o.ltvPct !== undefined ? o.ltvPct / 100 : c?.ltvPct != null ? c.ltvPct / 100 : c?.debt != null && pos(price) ? c.debt / price! : M.ltv;
  const debtRate = o.debtRatePct !== undefined ? o.debtRatePct / 100 : c?.debtCostPct != null ? c.debtCostPct / 100 : M.debtRate;
  const debtSet = o.ltvPct !== undefined || c?.ltvPct != null || c?.debt != null;
  lines.push({ key: "debt", value: `${pct(ltv, 0)} LTV at ${pct(debtRate)}, interest only, refinanced every ${OTHER_DEFAULTS.debtTermYears} years`,
    source: debtSet ? "case" : "default", basis: debtSet ? "Investment case" : `${M.label} default: ${M.debtBasis}` });

  const taxRate = o.taxRatePct !== undefined ? o.taxRatePct / 100 : M.taxRate;
  lines.push({ key: "tax", value: pct(taxRate, 1), source: o.taxRatePct !== undefined ? "case" : "default",
    basis: o.taxRatePct !== undefined ? "Investment case" : `${M.taxBasis}. Simplified: no capital allowances, no structure relief` });

  const fxSpot = f.fx?.yenPerUnit ?? null;
  if (fxSpot === null) gaps.push("No yen rate on file for this currency: yen returns use a placeholder rate.");
  const spot = fxSpot ?? (ccy === "EUR" ? 175 : 205);
  const hedgeRatio = o.hedgeRatioPct !== undefined ? o.hedgeRatioPct / 100 : OTHER_DEFAULTS.hedgeRatio;
  lines.push({ key: "currency", value: `¥${spot.toFixed(1)} per ${ccy === "GBP" ? "£" : ccy === "EUR" ? "€" : ccy}; ${Math.round(hedgeRatio * 100)}% hedged at about ${pct(Math.max(0, M.policyRate - YEN_POLICY_RATE), 1)} a year`,
    source: fxSpot !== null ? "fx_rates" : "default",
    basis: `${f.fx ? `Rate ${f.fx.asOf} (${f.fx.source})` : "Placeholder rate"}; hedge cost from policy rates (${M.policyBasis}; ${YEN_POLICY_BASIS}), not a bank quote` });

  const fees = {
    acqPct: o.acqFeePct !== undefined ? o.acqFeePct / 100 : REIWA_FEES.acqPct,
    amPctEquity: o.amFeePct !== undefined ? o.amFeePct / 100 : REIWA_FEES.amPctEquity,
    promotePct: o.promotePct !== undefined ? o.promotePct / 100 : REIWA_FEES.promotePct,
    hurdle: o.hurdlePct !== undefined ? o.hurdlePct / 100 : REIWA_FEES.hurdle,
  };
  lines.push({ key: "fees", value: `${pct(fees.acqPct, 1)} on acquisition, ${pct(fees.amPctEquity, 1)} a year, ${pct(fees.promotePct, 0)} over ${pct(fees.hurdle, 0)}`,
    source: o.acqFeePct !== undefined || o.amFeePct !== undefined ? "case" : "default", basis: "Reiwa standard proposal unless set on the case" });

  const params: Params = {
    startDate, holdYears: hold, price: price!, purchaseCostsPct,
    saleCostsPct: o.saleCostsPct !== undefined ? o.saleCostsPct / 100 : M.saleCostsPct,
    exitYield: ey, initialCapex,
    ervGrowth, voidMonths, rentFreeMonths, renewalProb, renewalRentFreeMonths: L.renewalRentFreeMonths,
    newLeaseYears: L.newLeaseYears, lettingFeePct: M.lettingFeePct, voidCostPsf: M.voidCostPsf,
    nonRecoverablePct: nonRec, fixedCostsPa: fixed, costInflation: OTHER_DEFAULTS.costInflation,
    groundRent: gr, lifecycle: LIFECYCLE,
    leaseholdExpiry, shortLeasePremium: OTHER_DEFAULTS.shortLeasePremium,
    ltv, debtRate, debtTermYears: OTHER_DEFAULTS.debtTermYears,
    refiRate: o.refiRatePct !== undefined ? o.refiRatePct / 100 : debtRate,
    arrangementFeePct: OTHER_DEFAULTS.arrangementFeePct,
    taxRate, fees,
    fxSpot: spot, dealRate: M.policyRate, yenRate: YEN_POLICY_RATE, hedgeRatio,
    hedgeCostLong: Math.max(0, M.policyRate - YEN_POLICY_RATE),
    fxExitSpot: o.fxExitSpot ?? spot,
    amendments: {},
  };
  if (use === "hotel") gaps.push("Hotels are operating assets; a lease-based model understates their risk.");
  return { ok: true, tier, leases, params, lines, gaps };
}

function dominantUse(rows: RentRollRow[]): Use {
  const byUse = new Map<Use, number>();
  for (const r of rows) byUse.set(r.use, (byUse.get(r.use) ?? 0) + (r.rentPa || r.ervPa || 0));
  let best: Use = "other", max = -1;
  for (const [u, v] of byUse) if (v > max) { best = u; max = v; }
  return best;
}
