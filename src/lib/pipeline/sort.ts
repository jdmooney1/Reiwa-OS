// ============================================================================
// Pipeline table sorting. Pure: no React, safe in a client component.
// ----------------------------------------------------------------------------
// Four numeric columns sort: Price, Total cost, Entry yield, IRR. A blank always
// sorts LAST, whichever way the column is sorted: an un-underwritten deal has no
// price to be "smallest", and putting it first on an ascending sort would bury the
// real ones. Ties keep the order the rows arrived in, so a sort never reshuffles
// rows it cannot tell apart.
//
// Money columns compare pounds only. A yen or euro figure is not comparable to a
// pound figure without a rate, and applying one would put a demonstration value
// into a decision screen, so those rows sort with the blanks. The percentage
// columns are currency-free and sort everything.
// ============================================================================
import { PRICE_FILTER_CURRENCY } from "@/lib/pipeline/filter";

export type SortKey = "price" | "totalCost" | "entryYield" | "irr";
export const SORT_KEYS: readonly SortKey[] = ["price", "totalCost", "entryYield", "irr"];
export type SortDir = "asc" | "desc";
export interface SortState { key: SortKey; dir: SortDir }

export const SORT_LABEL: Record<SortKey, string> = {
  price: "Price", totalCost: "Total cost", entryYield: "Entry yield", irr: "IRR",
};

/** The fields sorting reads. Any PipelineRow satisfies it. */
export interface SortableRow {
  currency: string;
  caseAcquisitionPrice: number | null;
  caseTotalCost: number | null;
  caseEntryYieldPct: number | null;
  caseTargetIrr: number | null;
}

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** The comparable number for a row under a key, or null when it has none (blank, or not in pounds). */
export function sortValue(r: SortableRow, key: SortKey): number | null {
  switch (key) {
    case "price": return r.currency === PRICE_FILTER_CURRENCY && finite(r.caseAcquisitionPrice) ? r.caseAcquisitionPrice : null;
    case "totalCost": return r.currency === PRICE_FILTER_CURRENCY && finite(r.caseTotalCost) ? r.caseTotalCost : null;
    case "entryYield": return finite(r.caseEntryYieldPct) ? r.caseEntryYieldPct : null;
    case "irr": return finite(r.caseTargetIrr) ? r.caseTargetIrr : null;
  }
}

/**
 * What a click on a header does: highest first, then lowest first, then back to the order the rows came in.
 * Clicking a different column starts that column at highest first.
 */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  if (!current || current.key !== key) return { key, dir: "desc" };
  return current.dir === "desc" ? { key, dir: "asc" } : null;
}

export function sortRows<T extends SortableRow>(rows: readonly T[], sort: SortState | null): T[] {
  if (!sort) return [...rows];
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: sortValue(row, sort.key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.index - b.index;
      if (a.v === null) return 1;               // blanks last, in both directions
      if (b.v === null) return -1;
      return a.v === b.v ? a.index - b.index : (a.v - b.v) * sign;
    })
    .map((x) => x.row);
}

/** The aria-sort value for a header. */
export function ariaSort(sort: SortState | null, key: SortKey): "ascending" | "descending" | "none" {
  if (!sort || sort.key !== key) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}
