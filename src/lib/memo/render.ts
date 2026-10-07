// ============================================================================
// Memo rendering helpers. Pure: formatting and wording, shared by the workspace
// view and the print view so the two cannot drift.
// ============================================================================
import type { Block, MetricItem } from "@/lib/memo/compose";
import type { OutputFormat } from "@/lib/memo/sections";
import { formatMoney, formatPct, formatMultiple, formatArea } from "@/lib/format";
import type { Currency } from "@/types/database";

/** What a metric the record does not carry reads as. Never a guess, never zero. */
export const NOT_RECORDED = "Not recorded";

export { TARGETS_DISCLAIMER, INVESTOR_FIGURES_DISCLAIMER } from "@/lib/investor-copy";

/** Formats whose audience is outside the building. */
export const isExternalFormat = (f: OutputFormat): boolean => f !== "ic";

export function formatMetric(m: MetricItem, currency: string): string {
  if (m.value === null || m.value === "") return NOT_RECORDED;
  const n = typeof m.value === "number" ? m.value : Number(m.value);
  switch (m.format) {
    case "money": return formatMoney(n, currency as Currency);
    case "pct": return formatPct(n, 2);
    case "pct1": return formatPct(n, 1);
    case "multiple": return formatMultiple(n);
    case "years": return `${n} years`;
    case "area_sqft": return formatArea(n, "sqft");
    case "area_sqm": return formatArea(n, "sqm");
    default: return String(m.value);
  }
}

/**
 * The rows of a metrics block to PRINT. In a document that leaves the building a
 * row with no value is simply not claimed; in the workspace and the internal memo
 * it is shown as "Not recorded", because there an author needs to see the gap.
 */
export function visibleMetrics(items: MetricItem[], format: OutputFormat, surface: "workspace" | "print"): MetricItem[] {
  if (surface === "print" && isExternalFormat(format)) return items.filter((m) => m.value !== null && m.value !== "");
  return items;
}

/** A block, flattened to plain text lines, for tests and for any plain-text export. */
export function blockText(b: Block, currency: string): string[] {
  switch (b.kind) {
    case "metrics": return b.items.map((m) => `${m.label}: ${formatMetric(m, currency)}`);
    case "text": return [b.text];
    case "facts": return b.items.map((i) => `${i.label}: ${i.value}`);
    case "list": return b.items.flatMap((i) => [[i.title, ...i.tags].join(" | "), ...(i.detail ? [i.detail] : [])]);
  }
}
