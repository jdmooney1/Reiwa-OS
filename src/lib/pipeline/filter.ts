// ============================================================================
// Pipeline filtering. Pure: no React, no server imports, safe in a client
// component and testable without a DOM.
// ----------------------------------------------------------------------------
// Six filters combine with AND. An empty value means "any". Each option shown
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
}

export interface PipelineFilters {
  triageStatus: TriageStatus | "";
  triagePriority: TriagePriority | "";
  market: string;
  assetType: string;
  strategy: string;
  query: string;
}

export const NO_FILTERS: PipelineFilters = {
  triageStatus: "", triagePriority: "", market: "", assetType: "", strategy: "", query: "",
};

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

function matches<T extends FilterableRow>(r: T, f: PipelineFilters, skip?: FilterKey): boolean {
  if (skip !== "triageStatus" && f.triageStatus && r.triageStatus !== f.triageStatus) return false;
  // A priority exists only on a live row (the database enforces it), so asking
  // for P1 can only ever match live rows.
  if (skip !== "triagePriority" && f.triagePriority && r.triagePriority !== f.triagePriority) return false;
  if (skip !== "market" && f.market && r.market !== f.market) return false;
  if (skip !== "assetType" && f.assetType && r.assetType !== f.assetType) return false;
  if (skip !== "strategy" && f.strategy && r.strategy !== f.strategy) return false;
  if (skip !== "query" && !matchesQuery(r, f.query)) return false;
  return true;
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
