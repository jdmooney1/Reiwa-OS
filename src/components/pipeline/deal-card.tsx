import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { DealSummary } from "@/lib/mock-data";
import {
  ASSET_TYPE_LABEL, STRATEGY_LABEL, STATUS_LABEL, STATUS_TONE,
  RECOMMENDATION_LABEL, RECOMMENDATION_TONE, scoreTone,
} from "@/lib/domain";
import { formatMoneyCompact, formatPct } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Pipeline deal card — dense, institutional, no chrome. */
export function DealCard({ deal }: { deal: DealSummary }) {
  return (
    <Link
      href={`/deals/${deal.deal_id}`}
      className="block rounded-lg border border-line bg-surface-card p-3.5 transition-all hover:border-gold/40 hover:shadow-[0_1px_0_rgba(194,161,78,0.25)]"
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink">
            {deal.asset_name}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-faint">
            {deal.city} · {ASSET_TYPE_LABEL[deal.asset_type]}
          </div>
        </div>
        {deal.overall_score != null && (
          <div
            className={cn(
              "tabular flex h-8 w-8 shrink-0 items-center justify-center rounded text-xs font-semibold",
              scoreTone(deal.overall_score) === "positive" && "bg-positive/10 text-positive",
              scoreTone(deal.overall_score) === "gold" && "bg-gold/10 text-gold-deep",
              scoreTone(deal.overall_score) === "caution" && "bg-caution/10 text-caution",
              scoreTone(deal.overall_score) === "negative" && "bg-negative/10 text-negative",
            )}
          >
            {deal.overall_score.toFixed(1)}
          </div>
        )}
      </div>

      {/* Metrics */}
      <div className="tabular mt-3 grid grid-cols-3 gap-y-2 border-t border-line pt-3 text-xs">
        <Figure label="Price" value={formatMoneyCompact(deal.price_guidance, deal.currency)} />
        <Figure label="NIY" value={formatPct(deal.niy, 1)} />
        <Figure label="Target IRR" value={formatPct(deal.target_irr, 1)} />
      </div>

      {/* Tags */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {deal.strategy && (
          <Badge tone="neutral">{STRATEGY_LABEL[deal.strategy]}</Badge>
        )}
        <Badge tone={STATUS_TONE[deal.status]} dot>
          {STATUS_LABEL[deal.status]}
        </Badge>
        {deal.recommendation && (
          <Badge tone={RECOMMENDATION_TONE[deal.recommendation]}>
            {RECOMMENDATION_LABEL[deal.recommendation]}
          </Badge>
        )}
      </div>

      {/* Footer: probability + key risk */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        <div className="flex items-center gap-1.5 text-2xs text-ink-faint">
          <span className="tabular font-medium text-ink-muted">{deal.probability ?? 0}%</span>
          <span>probability</span>
        </div>
        {deal.key_risk && (
          <div className="flex items-center gap-1 text-2xs text-caution" title="Key risk">
            <AlertTriangle className="h-3 w-3" strokeWidth={2} />
            <span className="max-w-[8rem] truncate">{deal.key_risk}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-label text-ink-faint">{label}</div>
      <div className="mt-0.5 font-medium text-ink">{value}</div>
    </div>
  );
}
