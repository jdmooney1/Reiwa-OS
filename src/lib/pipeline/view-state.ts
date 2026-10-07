// ============================================================================
// The pipeline's view state, and how it lives in a URL.
// ----------------------------------------------------------------------------
// A view is the filters, the table sort and board-or-table. It is one small value so
// the same thing can be: read from the address bar (a filtered view can be bookmarked),
// written back to it as the person works, stored under a name (a saved view), and
// compared with the one on screen (to say "modified").
//
// Everything that arrives from outside - a query string anyone can edit, a saved
// definition read back from the database - goes through sanitise*, which keeps what
// is valid and drops the rest. Nothing here throws on bad input: a mangled bookmark
// opens as an unfiltered pipeline, not as an error page.
//
// Pure: no React, no server imports.
// ============================================================================
import { TRIAGE_STATUSES, TRIAGE_PRIORITIES } from "@/lib/data/opportunity-types";
import type { TriageStatus, TriagePriority } from "@/lib/data/opportunity-types";
import { NO_FILTERS, parseBound, type PipelineFilters } from "@/lib/pipeline/filter";
import { SORT_KEYS, type SortKey, type SortState } from "@/lib/pipeline/sort";

export type PipelineLayout = "board" | "table";
export type PipelineMode = "browse" | "triage";

export interface PipelineViewState {
  filters: PipelineFilters;
  sort: SortState | null;
  layout: PipelineLayout;
}

export const DEFAULT_VIEW: PipelineViewState = { filters: NO_FILTERS, sort: null, layout: "board" };

/** The query-string names. Short on purpose: a bookmark should be readable. */
const PARAM = {
  triageStatus: "triage", triagePriority: "priority", market: "market", assetType: "type",
  strategy: "strategy", query: "q", priceMin: "pmin", priceMax: "pmax", yieldMin: "ymin",
  sort: "sort", layout: "view", mode: "mode",
} as const;

const TEXT_MAX = 120;
const QUERY_MAX = 200;

type Source = URLSearchParams | Record<string, string | string[] | undefined>;
function read(src: Source, name: string): string {
  if (src instanceof URLSearchParams) return src.get(name) ?? "";
  const v = src[name];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** A bound field as stored: the number as typed, without padding, or "" when it is not a valid bound. */
function cleanBound(raw: string): string {
  const n = parseBound(raw);
  return n === null ? "" : String(n);
}

function cleanText(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

export function sanitiseFilters(raw: Partial<Record<keyof PipelineFilters, unknown>> | null | undefined): PipelineFilters {
  const r = raw ?? {};
  const triageStatus = (TRIAGE_STATUSES as readonly unknown[]).includes(r.triageStatus) ? (r.triageStatus as TriageStatus) : "";
  const wantedPriority = (TRIAGE_PRIORITIES as readonly unknown[]).includes(r.triagePriority) ? (r.triagePriority as TriagePriority) : "";
  return {
    triageStatus,
    // A priority exists only on a live deal, so it is kept only alongside "live" (setFilter enforces the same on screen).
    triagePriority: triageStatus === "live" ? wantedPriority : "",
    market: cleanText(r.market, TEXT_MAX),
    assetType: cleanText(r.assetType, TEXT_MAX),
    strategy: cleanText(r.strategy, TEXT_MAX),
    query: cleanText(r.query, QUERY_MAX),
    priceMin: cleanBound(typeof r.priceMin === "string" ? r.priceMin : ""),
    priceMax: cleanBound(typeof r.priceMax === "string" ? r.priceMax : ""),
    yieldMin: cleanBound(typeof r.yieldMin === "string" ? r.yieldMin : ""),
  };
}

/** "-price" is price, highest first; "price" is lowest first. Anything else is no sort. */
export function parseSort(raw: unknown): SortState | null {
  if (typeof raw !== "string") return null;
  const desc = raw.startsWith("-");
  const key = (desc ? raw.slice(1) : raw) as SortKey;
  return (SORT_KEYS as readonly string[]).includes(key) ? { key, dir: desc ? "desc" : "asc" } : null;
}
export const formatSort = (s: SortState | null): string => (s ? `${s.dir === "desc" ? "-" : ""}${s.key}` : "");

export function parseViewState(src: Source): PipelineViewState {
  return {
    filters: sanitiseFilters({
      triageStatus: read(src, PARAM.triageStatus), triagePriority: read(src, PARAM.triagePriority),
      market: read(src, PARAM.market), assetType: read(src, PARAM.assetType), strategy: read(src, PARAM.strategy),
      query: read(src, PARAM.query), priceMin: read(src, PARAM.priceMin), priceMax: read(src, PARAM.priceMax),
      yieldMin: read(src, PARAM.yieldMin),
    }),
    sort: parseSort(read(src, PARAM.sort)),
    layout: read(src, PARAM.layout) === "table" ? "table" : "board",
  };
}

export function parseMode(src: Source): PipelineMode {
  return read(src, PARAM.mode) === "triage" ? "triage" : "browse";
}

/** The query string for a view, without the leading "?". Defaults are left out, so the clean pipeline has none. */
export function toQueryString(state: PipelineViewState, mode: PipelineMode = "browse"): string {
  const f = sanitiseFilters(state.filters);
  const q = new URLSearchParams();
  const put = (name: string, value: string) => { if (value !== "") q.set(name, value); };
  put(PARAM.triageStatus, f.triageStatus);
  put(PARAM.triagePriority, f.triagePriority);
  put(PARAM.market, f.market);
  put(PARAM.assetType, f.assetType);
  put(PARAM.strategy, f.strategy);
  put(PARAM.query, f.query);
  put(PARAM.priceMin, f.priceMin);
  put(PARAM.priceMax, f.priceMax);
  put(PARAM.yieldMin, f.yieldMin);
  put(PARAM.sort, formatSort(state.sort));
  if (state.layout === "table") q.set(PARAM.layout, "table");
  if (mode === "triage") q.set(PARAM.mode, "triage");
  return q.toString();
}

/** Anything - a saved definition from the database, a request body - made into a valid view, or the default. */
export function sanitiseViewState(raw: unknown): PipelineViewState {
  if (typeof raw !== "object" || raw === null) return DEFAULT_VIEW;
  const o = raw as { filters?: unknown; sort?: unknown; layout?: unknown };
  const sort = typeof o.sort === "object" && o.sort !== null
    ? parseSort(`${(o.sort as SortState).dir === "desc" ? "-" : ""}${(o.sort as SortState).key}`)
    : null;
  return {
    filters: sanitiseFilters(typeof o.filters === "object" ? (o.filters as Record<string, unknown>) : null),
    sort,
    layout: o.layout === "table" ? "table" : "board",
  };
}

/** Same filters, same sort, same layout. The comparison behind "modified". */
export function sameView(a: PipelineViewState, b: PipelineViewState): boolean {
  return toQueryString(a) === toQueryString(b);
}
