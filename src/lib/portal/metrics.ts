// ============================================================================
// The investor metric vocabulary (P4).
// ----------------------------------------------------------------------------
// One definition of what an approved metric is called and how it is rendered,
// shared by the opportunity page and the comparison table so the two can never
// drift apart. Every value comes from the published version; a value the
// publication does not carry renders as an em dash and is never inferred,
// interpolated or substituted from an internal record.
// ============================================================================
import {
  formatMoneyCompact, formatMoney, formatPct, formatMultiple, formatArea,
} from "@/lib/format";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import type { AssetType, Strategy } from "@/types/database";
import type { PortalOpportunity } from "@/lib/data/portal-feed";

export const NOT_DISCLOSED = "—";

/** Label for an approved enum value, without inventing one for an unknown code. */
export function assetTypeLabel(value: string | null): string {
  if (!value) return NOT_DISCLOSED;
  return ASSET_TYPE_LABEL[value as AssetType] ?? value;
}

export function strategyLabel(value: string | null): string {
  if (!value) return NOT_DISCLOSED;
  return STRATEGY_LABEL[value as Strategy] ?? value;
}

/** "South Kensington, London" — as much location as was approved, no more. */
export function locationLabel(o: PortalOpportunity): string {
  const parts = [o.submarket, o.city, o.country].filter(Boolean) as string[];
  // Drop a duplicate when submarket and city carry the same name.
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.length > 0 ? unique.join(", ") : NOT_DISCLOSED;
}

export interface Metric {
  key: string;
  label: string;
  value: string;
  /** False when the publication carries no approved value for this metric. */
  present: boolean;
}

const metric = (key: string, label: string, raw: unknown, value: string): Metric => ({
  key, label, value: raw == null ? NOT_DISCLOSED : value, present: raw != null,
});

/**
 * The full metric set, in the order an investment memorandum would present it.
 * `compact` shortens the acquisition value for cards and the comparison table.
 */
export function opportunityMetrics(
  o: PortalOpportunity, opts: { compact?: boolean } = {},
): Metric[] {
  const money = opts.compact ? formatMoneyCompact : formatMoney;
  return [
    metric("headlinePrice", "Target acquisition value", o.headlinePrice,
      money(o.headlinePrice, o.currency)),
    metric("targetIrr", "Target IRR", o.targetIrr, formatPct(o.targetIrr, 1)),
    metric("targetNiy", "Target net initial yield", o.targetNiy, formatPct(o.targetNiy, 2)),
    metric("targetEquityMultiple", "Target equity multiple", o.targetEquityMultiple,
      formatMultiple(o.targetEquityMultiple)),
    metric("holdPeriodYears", "Indicative hold period", o.holdPeriodYears,
      o.holdPeriodYears == null ? NOT_DISCLOSED : `${o.holdPeriodYears} years`),
    metric("size", "Approximate size", o.sizeSqft ?? o.sizeSqm,
      o.sizeSqft != null ? formatArea(o.sizeSqft, "sqft")
        : o.sizeSqm != null ? formatArea(o.sizeSqm, "sqm") : NOT_DISCLOSED),
  ];
}

/** The metrics worth putting on a card — only those the publication carries. */
export function headlineMetrics(o: PortalOpportunity): Metric[] {
  return opportunityMetrics(o, { compact: true })
    .filter((m) => ["headlinePrice", "targetIrr", "targetNiy"].includes(m.key) && m.present);
}

/** The rows of the comparison table, qualitative attributes included. */
export function comparisonRows(o: PortalOpportunity): Metric[] {
  return [
    metric("location", "Location", o.city ?? o.country ?? o.submarket, locationLabel(o)),
    metric("assetType", "Asset type", o.assetType, assetTypeLabel(o.assetType)),
    metric("strategy", "Strategy", o.strategy, strategyLabel(o.strategy)),
    ...opportunityMetrics(o, { compact: true }),
  ];
}
