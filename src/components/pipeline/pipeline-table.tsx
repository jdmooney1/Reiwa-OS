import Link from "next/link";
import type { DealSummary } from "@/lib/mock-data";
import {
  ASSET_TYPE_LABEL, STRATEGY_LABEL, STAGE_LABEL, STATUS_LABEL, STATUS_TONE,
  RECOMMENDATION_LABEL, RECOMMENDATION_TONE, scoreTone,
} from "@/lib/domain";
import { formatMoneyCompact, formatPct } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PipelineTable({ deals }: { deals: DealSummary[] }) {
  return (
    <div className="px-8 py-6">
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunken/50 text-left">
              {["Asset", "Market", "Type", "Strategy", "Stage", "Price", "NIY", "IRR", "Score", "Prob.", "Rec.", "Status"].map(
                (h, i) => (
                  <th
                    key={h}
                    className={cn(
                      "px-3 py-2.5 text-2xs font-medium uppercase tracking-label text-ink-faint",
                      i >= 5 && i <= 9 && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="tabular">
            {deals.map((deal) => (
              <tr
                key={deal.deal_id}
                className="border-b border-line last:border-0 hover:bg-gold/[0.04]"
              >
                <td className="px-3 py-2.5">
                  <Link href={`/deals/${deal.deal_id}`} className="font-medium text-ink hover:text-gold-deep">
                    {deal.asset_name}
                  </Link>
                  <div className="text-2xs text-ink-faint">{deal.submarket}</div>
                </td>
                <td className="px-3 py-2.5 text-ink-muted">{deal.city}</td>
                <td className="px-3 py-2.5 text-ink-muted">{ASSET_TYPE_LABEL[deal.asset_type]}</td>
                <td className="px-3 py-2.5 text-ink-muted">{deal.strategy ? STRATEGY_LABEL[deal.strategy] : "—"}</td>
                <td className="px-3 py-2.5 text-ink-muted">{STAGE_LABEL[deal.deal_stage]}</td>
                <td className="px-3 py-2.5 text-right font-medium text-ink">{formatMoneyCompact(deal.price_guidance, deal.currency)}</td>
                <td className="px-3 py-2.5 text-right text-ink-muted">{formatPct(deal.niy, 1)}</td>
                <td className="px-3 py-2.5 text-right text-ink-muted">{formatPct(deal.target_irr, 1)}</td>
                <td className="px-3 py-2.5 text-right">
                  {deal.overall_score != null ? (
                    <span
                      className={cn(
                        "font-medium",
                        scoreTone(deal.overall_score) === "positive" && "text-positive",
                        scoreTone(deal.overall_score) === "gold" && "text-gold-deep",
                        scoreTone(deal.overall_score) === "caution" && "text-caution",
                        scoreTone(deal.overall_score) === "negative" && "text-negative",
                      )}
                    >
                      {Math.round(deal.overall_score)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-ink-muted">{deal.probability ?? 0}%</td>
                <td className="px-3 py-2.5">
                  {deal.recommendation && (
                    <Badge tone={RECOMMENDATION_TONE[deal.recommendation]}>
                      {RECOMMENDATION_LABEL[deal.recommendation]}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={STATUS_TONE[deal.status]} dot>
                    {STATUS_LABEL[deal.status]}
                  </Badge>
                </td>
              </tr>
            ))}
            {deals.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-10 text-center text-sm text-ink-faint">
                  No deals match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
