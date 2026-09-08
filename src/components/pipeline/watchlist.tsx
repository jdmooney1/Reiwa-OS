import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { DealSummary } from "@/lib/mock-data";
import {
  ASSET_TYPE_LABEL, STAGE_LABEL, scoreTone,
} from "@/lib/domain";
import { formatMoneyCompact, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Priority watchlist — active deals ranked by a blend of conviction (score),
 * progress (probability) and size. The desk's "what needs attention" list.
 */
export function Watchlist({ deals }: { deals: DealSummary[] }) {
  const ranked = deals
    .filter((d) => d.status === "active")
    .map((d) => ({
      deal: d,
      priority:
        (d.overall_score ?? 0) * 0.6 +
        (d.probability ?? 0) * 0.3 +
        Math.min((d.price_guidance ?? 0) / 1_000_000, 40) * 0.4,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 6);

  return (
    <div className="px-8 py-6">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-lg border border-line bg-surface-card">
        <div className="border-b border-line px-5 py-3.5">
          <div className="eyebrow mb-0.5">Priority Watchlist</div>
          <div className="text-xs text-ink-muted">
            Active deals requiring founder &amp; analyst attention, ranked by conviction and progress.
          </div>
        </div>
        <ol>
          {ranked.map(({ deal }, i) => (
            <li key={deal.deal_id}>
              <Link
                href={`/deals/${deal.deal_id}`}
                className="group flex items-center gap-4 border-b border-line px-5 py-3.5 last:border-0 hover:bg-purple/[0.04]"
              >
                <span className="tabular w-5 text-center text-base text-ink-faint">
                  {i + 1}
                </span>
                <div
                  className={cn(
                    "tabular flex h-9 w-9 shrink-0 items-center justify-center rounded text-sm font-semibold",
                    scoreTone(deal.overall_score) === "positive" && "bg-positive/10 text-positive",
                    scoreTone(deal.overall_score) === "accent" && "bg-surface-sunken text-ink-muted",
                    scoreTone(deal.overall_score) === "caution" && "bg-caution/10 text-caution",
                    scoreTone(deal.overall_score) === "negative" && "bg-negative/10 text-negative",
                  )}
                >
                  {deal.overall_score != null ? Math.round(deal.overall_score) : "—"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{deal.asset_name}</div>
                  <div className="truncate text-2xs text-ink-faint">
                    {deal.city} · {ASSET_TYPE_LABEL[deal.asset_type]} · {STAGE_LABEL[deal.deal_stage]}
                  </div>
                </div>
                {deal.key_risk && (
                  <div className="hidden items-center gap-1 text-2xs text-caution sm:flex">
                    <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                    <span className="max-w-[10rem] truncate">{deal.key_risk}</span>
                  </div>
                )}
                <div className="tabular w-24 text-right">
                  <div className="text-sm font-medium text-ink">
                    {formatMoneyCompact(deal.price_guidance, deal.currency)}
                  </div>
                  <div className="text-2xs text-ink-faint">{formatPct(deal.target_irr, 1)} IRR</div>
                </div>
                <ChevronRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
