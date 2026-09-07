import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { Currency } from "@/types/database";
import type { Tone } from "@/lib/domain";
import type { Variance, MetricUnit } from "@/lib/asset-intelligence/metrics";
import { formatMoneyCompact, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const TEXT: Record<Tone, string> = {
  positive: "text-positive", negative: "text-negative", caution: "text-caution",
  gold: "text-gold-deep", neutral: "text-ink-muted", muted: "text-ink-faint",
};

/**
 * Variance indicator — an arrow + magnitude, coloured by whether the movement is
 * favourable for that metric (tone supplied by the caller, e.g. varianceTone()).
 * Prefers the percentage; falls back to the absolute for pure-count metrics.
 */
export function VarianceValue({
  v, tone, unit = "pct", currency = "GBP", showAbs = false, className,
}: {
  v: Variance;
  tone: Tone;
  unit?: MetricUnit | "ppt";
  currency?: Currency;
  showAbs?: boolean;
  className?: string;
}) {
  if (v.abs == null) return <span className="text-ink-faint">—</span>;
  const Arrow = v.abs > 0 ? ArrowUp : v.abs < 0 ? ArrowDown : Minus;
  const sign = v.abs > 0 ? "+" : "";

  let magnitude: string;
  if (showAbs || v.pct == null) {
    magnitude =
      unit === "money" ? `${sign}${formatMoneyCompact(v.abs, currency)}`
      : unit === "ppt" ? `${sign}${v.abs.toFixed(1)} pts`
      : `${sign}${v.abs.toFixed(1)}`;
  } else {
    magnitude = `${sign}${formatPct(v.pct * 100, 1)}`;
  }

  return (
    <span className={cn("tabular inline-flex items-center gap-0.5 text-xs font-medium", TEXT[tone], className)}>
      {/* Decorative: the direction is already in the sign of the magnitude,
          so the movement is never signalled by colour or icon alone. */}
      <Arrow aria-hidden="true" className="h-3 w-3" strokeWidth={2.25} />
      {magnitude}
    </span>
  );
}
