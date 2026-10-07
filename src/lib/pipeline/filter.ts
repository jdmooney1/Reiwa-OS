// ============================================================================
// Pipeline filtering. Pure: no React, no server imports, safe in a client
// component and testable without a DOM.
// ----------------------------------------------------------------------------
// Nine filters combine with AND. An empty value means "any". Each option shown
// in the bar carries a live count computed over the rows that match every OTHER
// filter, so choosing "London" tells you how many of those are untriaged, and
// an option that would return nothing reads 0 rather than being silently absent.
// ============================================================================
import type { TriageStatus, TriagePriority } from "@/lib/data/opportunity-types";

/** The fields filtering reads. Any PipelineRow satisfies it. */
export interface FilterableRow {
  name: string;
  address: string | null;
  brokerName: string | null;
  market: string | null;
  assetType: string;
  strategy: string | null;
  triageStatus: TriageStatus;
  triagePriority: TriagePriority | null;
  // Optional so a row built for a test (or any caller that has no case) still satisfies the type;
  // a missing value is treated exactly as a blank one.
  currency?: string;
  caseAcquisitionPrice?: number | null;
  caseEntryYieldPct?: number | null;
}

export interface PipelineFilters {
  triageStatus: TriageStatus | "";
  triagePriority: TriagePriority | "";
  market: string;
  assetType: string;
  strategy: string;
  query: string;
  /** Price from, in £m, INCLUSIVE. A decimal string, "" = no lower bound. */
  priceMin: string;
  /** Price up to, in £m, EXCLUSIVE. "" = no upper bound. See priceInRange. */
  priceMax: string;
  /** Minimum entry yield, in percent, inclusive. "" = any. */
  yieldMin: string;
}

export const NO_FILTERS: PipelineFilters = {
  triageStatus: "", triagePriority: "", market: "", assetType: "", strategy: "", query: "",
  priceMin: "", priceMax: "", yieldMin: "",
};

// ---- Price and yield --------------------------------------------------------
/** Prices are filtered in pounds. A deal in another currency has no comparable £ price (no rate is applied). */
export const PRICE_FILTER_CURRENCY = "GBP";

/**
 * A non-negative decimal from a filter field, or null when it is blank or not a number. A value that does
 * not parse is treated as "no bound" rather than as an error: the field is free text and the URL can carry
 * anything.
 */
export function parseBound(raw: string | null | undefined): number | null {
  const t = (raw ?? "").trim();
  if (t === "" || !/^\d{1,6}(\.\d{1,4})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The four price bands offered as one-click presets. Contiguous by construction: each band runs from its
 * minimum (inclusive) up to its maximum (EXCLUSIVE), so a £15.0m deal is in "15-30" and never in "5-15",
 * and nothing falls between two bands.
 */
export const PRICE_PRESETS: readonly { id: string; label: string; min: string; max: string }[] = [
  { id: "lt5", label: "Under £5m", min: "", max: "5" },
  { id: "5-15", label: "£5-15m", min: "5", max: "15" },
  { id: "15-30", label: "£15-30m", min: "15", max: "30" },
  { id: "30+", label: "£30m+", min: "30", max: "" },
];

export const YIELD_PRESETS: readonly number[] = [5, 6, 7];

/** Which preset the current price bounds equal exactly, or null (including a custom range). */
export function activePricePreset(f: Pick<PipelineFilters, "priceMin" | "priceMax">): string | null {
  const min = parseBound(f.priceMin), max = parseBound(f.priceMax);
  if (min === null && max === null) return null;
  return PRICE_PRESETS.find((p) => parseBound(p.min) === min && parseBound(p.max) === max)?.id ?? null;
}

/** Which yield preset the minimum equals, or null (including "any" and a custom value). */
export function activeYieldPreset(f: Pick<PipelineFilters, "yieldMin">): number | null {
  const n = parseBound(f.yieldMin);
  return n !== null && YIELD_PRESETS.includes(n) ? n : null;
}

const priceFilterOn = (f: PipelineFilters) => parseBound(f.priceMin) !== null || parseBound(f.priceMax) !== null;

/** True when the row's £ price lies in [priceMin, priceMax). A row with no £ price is never in a range. */
function priceInRange(r: FilterableRow, f: PipelineFilters): boolean {
  const min = parseBound(f.priceMin), max = parseBound(f.priceMax);
  if (min === null && max === null) return true;
  if ((r.currency ?? PRICE_FILTER_CURRENCY) !== PRICE_FILTER_CURRENCY) return false;
  const price = r.caseAcquisitionPrice;
  if (price === null || price === undefined || !Number.isFinite(price)) return false;
  const millions = price / 1_000_000;
  if (min !== null && millions < min) return false;
  if (max !== null && millions >= max) return false;
  return true;
}

function yieldAtLeast(r: FilterableRow, f: PipelineFilters): boolean {
  const min = parseBound(f.yieldMin);
  if (min === null) return true;
  const y = r.caseEntryYieldPct;
  return y !== null && y !== undefined && Number.isFinite(y) && y >= min;
}

export type FilterKey = keyof PipelineFilters;

export function hasActiveFilters(f: PipelineFilters): boolean {
  return (Object.keys(f) as FilterKey[]).some((k) => f[k].trim() !== "");
}

/** Every word typed must appear somewhere in name, address or broker. */
function matchesQuery(r: FilterableRow, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = [r.name, r.address, r.brokerName].filter(Boolean).join(" ").toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

function matches<T extends FilterableRow>(r: T, f: PipelineFilters, skip?: FilterKey | readonly FilterKey[]): boolean {
  const skipped = (k: FilterKey) => (Array.isArray(skip) ? skip.includes(k) : skip === k);
  if (!skipped("triageStatus") && f.triageStatus && r.triageStatus !== f.triageStatus) return false;
  // A priority exists only on a live row (the database enforces it), so asking
  // for P1 can only ever match live rows.
  if (!skipped("triagePriority") && f.triagePriority && r.triagePriority !== f.triagePriority) return false;
  if (!skipped("market") && f.market && r.market !== f.market) return false;
  if (!skipped("assetType") && f.assetType && r.assetType !== f.assetType) return false;
  if (!skipped("strategy") && f.strategy && r.strategy !== f.strategy) return false;
  if (!skipped("query") && !matchesQuery(r, f.query)) return false;
  if (!skipped("priceMin") && !priceInRange(r, f)) return false;
  if (!skipped("yieldMin") && !yieldAtLeast(r, f)) return false;
  return true;
}

/**
 * How many rows pass every filter EXCEPT the price range yet are hidden by it only because they are not in
 * pounds. Said out loud next to the price filter, because a filter that quietly drops every yen and euro deal
 * would be a filter that lies.
 */
export function nonGbpHiddenByPrice<T extends FilterableRow>(rows: T[], f: PipelineFilters): number {
  if (!priceFilterOn(f)) return 0;
  return rows.filter((r) => (r.currency ?? PRICE_FILTER_CURRENCY) !== PRICE_FILTER_CURRENCY && matches(r, f, ["priceMin", "priceMax"])).length;
}

export function applyFilters<T extends FilterableRow>(rows: T[], f: PipelineFilters): T[] {
  return rows.filter((r) => matches(r, f));
}

export interface FacetOption {
  value: string;
  /** Rows that match every other filter AND have this value. */
  count: number;
}

/**
 * The options for one filter: the distinct values present in the DATA (never a
 * hardcoded list, so a new market appears when the first deal in it is loaded),
 * each with how many rows it would return given the other filters.
 */
export function facet<T extends FilterableRow>(
  rows: T[], f: PipelineFilters, key: "market" | "assetType" | "strategy",
): FacetOption[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[key];
    if (!v) continue; // an unset market or strategy is not an option to choose
    if (!counts.has(v)) counts.set(v, 0);
    if (matches(r, f, key)) counts.set(v, counts.get(v)! + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

export function triageFacet<T extends FilterableRow>(
  rows: T[], f: PipelineFilters,
): Record<TriageStatus, number> {
  const out: Record<TriageStatus, number> = { untriaged: 0, live: 0, dead: 0, reference: 0 };
  for (const r of rows) if (matches(r, f, "triageStatus")) out[r.triageStatus] += 1;
  return out;
}

export function priorityFacet<T extends FilterableRow>(
  rows: T[], f: PipelineFilters,
): Record<TriagePriority, number> {
  const out: Record<TriagePriority, number> = { P1: 0, P2: 0, P3: 0 };
  for (const r of rows) {
    if (r.triagePriority && matches(r, f, "triagePriority")) out[r.triagePriority] += 1;
  }
  return out;
}

/**
 * How much of the pipeline has been looked at. Everything loads as untriaged,
 * so `reviewed` starts at 0 and rises as deals are triaged: the number worth
 * watching. Counts ALL rows, not the filtered view.
 */
export function triageProgress(rows: FilterableRow[]): { total: number; untriaged: number; reviewed: number } {
  const untriaged = rows.filter((r) => r.triageStatus === "untriaged").length;
  return { total: rows.length, untriaged, reviewed: rows.length - untriaged };
}

/** Changing triage status away from live clears a priority that could no longer apply. */
export function setFilter(f: PipelineFilters, key: FilterKey, value: string): PipelineFilters {
  const next = { ...f, [key]: value } as PipelineFilters;
  if (key === "triageStatus" && value !== "live") next.triagePriority = "";
  return next;
}
