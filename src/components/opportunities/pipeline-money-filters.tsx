"use client";

import {
  PRICE_PRESETS, YIELD_PRESETS, activePricePreset, activeYieldPreset, type PipelineFilters,
} from "@/lib/pipeline/filter";
import { cn } from "@/lib/utils";

// ============================================================================
// The price range and minimum entry yield controls for the pipeline filter bar.
// ----------------------------------------------------------------------------
// Presets are one-click bands; the boxes beside them take any custom bound. Choosing a preset
// fills the boxes, so what is applied is always visible and editable. Clicking the preset that is
// already on clears it.
//
// Price is in pounds (GBP deals only), from-inclusive, up-to-exclusive. Both facts are said on screen.
// ============================================================================

const chip = (on: boolean) => cn(
  "h-8 rounded border px-2.5 text-xs font-medium transition-colors",
  on ? "border-purple bg-purple text-surface" : "border-line bg-surface-card text-ink-muted hover:text-ink",
);
const box = "h-8 w-[4.25rem] rounded border border-line bg-surface-card px-2 text-xs tabular text-ink placeholder:text-ink-faint " +
  "focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30";

export function PriceFilter({ filters, onPatch, nonGbpHidden }: {
  filters: PipelineFilters;
  onPatch: (patch: Partial<PipelineFilters>) => void;
  /** Deals otherwise matching but not in pounds, so not comparable to a £ range. */
  nonGbpHidden: number;
}) {
  const active = activePricePreset(filters);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Price range, in millions of pounds" data-filter="price">
      <span className="mr-0.5 text-2xs font-medium uppercase tracking-label text-ink-faint">Price</span>
      {PRICE_PRESETS.map((p) => (
        <button key={p.id} type="button" aria-pressed={active === p.id} data-preset={p.id}
          onClick={() => onPatch(active === p.id ? { priceMin: "", priceMax: "" } : { priceMin: p.min, priceMax: p.max })}
          className={chip(active === p.id)}>
          {p.label}
        </button>
      ))}
      <input type="text" inputMode="decimal" value={filters.priceMin} placeholder="From £m" aria-label="Price from, £m, inclusive"
        onChange={(e) => onPatch({ priceMin: e.target.value })} className={box} />
      <span className="text-2xs text-ink-faint" aria-hidden="true">to</span>
      <input type="text" inputMode="decimal" value={filters.priceMax} placeholder="Up to £m" aria-label="Price up to, £m, not including this figure"
        onChange={(e) => onPatch({ priceMax: e.target.value })} className={box} />
      {nonGbpHidden > 0 && (
        <span className="text-2xs text-ink-faint" data-note="non-gbp">
          {nonGbpHidden} deal{nonGbpHidden === 1 ? "" : "s"} not in pounds {nonGbpHidden === 1 ? "is" : "are"} left out: the price range is for GBP only
        </span>
      )}
    </div>
  );
}

export function YieldFilter({ filters, onPatch }: {
  filters: PipelineFilters;
  onPatch: (patch: Partial<PipelineFilters>) => void;
}) {
  const active = activeYieldPreset(filters);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Minimum entry yield" data-filter="yield">
      <span className="mr-0.5 text-2xs font-medium uppercase tracking-label text-ink-faint">Entry yield</span>
      {YIELD_PRESETS.map((y) => (
        <button key={y} type="button" aria-pressed={active === y} data-preset={`y${y}`}
          onClick={() => onPatch({ yieldMin: active === y ? "" : String(y) })}
          className={chip(active === y)}>
          {y}%+
        </button>
      ))}
      <input type="text" inputMode="decimal" value={filters.yieldMin} placeholder="Min %" aria-label="Minimum entry yield, percent"
        onChange={(e) => onPatch({ yieldMin: e.target.value })} className={box} />
    </div>
  );
}
