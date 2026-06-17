import type { Deal } from "@/types/database";
import {
  formatMoneyCompact, formatPct, formatMultiple, formatPerArea,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/** The 10-figure key-metrics strip beneath the deal header. */
export function KeyMetricsStrip({ deal }: { deal: Deal }) {
  const metrics: { label: string; value: string }[] = [
    { label: "Price", value: formatMoneyCompact(deal.price_guidance, deal.currency) },
    { label: "Passing Rent", value: formatMoneyCompact(deal.passing_rent, deal.currency) },
    { label: "ERV", value: formatMoneyCompact(deal.erv, deal.currency) },
    { label: "NIY", value: formatPct(deal.niy, 1) },
    { label: "Rev. Yield", value: formatPct(deal.reversionary_yield, 1) },
    { label: "Capex", value: formatMoneyCompact(deal.capex_budget, deal.currency) },
    { label: "Target IRR", value: formatPct(deal.target_irr, 1) },
    { label: "Equity Mult.", value: formatMultiple(deal.equity_multiple) },
    { label: "Price / sq ft", value: formatPerArea(deal.price_guidance, deal.size_sqft, deal.currency, "sqft") },
    { label: "Price / sq m", value: formatPerArea(deal.price_guidance, deal.size_sqm, deal.currency, "sqm") },
  ];

  return (
    <div className="border-b border-line bg-surface-card">
      <div className="grid grid-cols-2 divide-x divide-line sm:grid-cols-5 lg:grid-cols-10">
        {metrics.map((m, i) => (
          <div
            key={m.label}
            className={cn(
              "px-4 py-3",
              // hide right divider wrapping on small grids handled by divide-x
              i >= 5 && "border-t border-line lg:border-t-0",
            )}
          >
            <div className="text-[10px] uppercase tracking-label text-ink-faint">{m.label}</div>
            <div className="tabular mt-1 text-sm font-semibold text-ink">{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
