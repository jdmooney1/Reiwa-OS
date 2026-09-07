import Link from "next/link";
import { ChevronLeft, MapPin } from "lucide-react";
import type { Deal, InvestmentScore } from "@/types/database";
import {
  STAGE_LABEL, STATUS_LABEL, STATUS_TONE, ASSET_TYPE_LABEL, STRATEGY_LABEL,
  RECOMMENDATION_LABEL, RECOMMENDATION_TONE,
} from "@/lib/domain";
import { Badge } from "@/components/ui/badge";
import { ScoreDial } from "@/components/shared/score-dial";

export function DealHeader({
  deal,
  score,
}: {
  deal: Deal;
  score: InvestmentScore | null;
}) {
  return (
    <div className="bg-navy text-surface">
      <div className="px-8 pt-5">
        <Link
          href="/pipeline"
          className="inline-flex items-center gap-1 text-2xs text-surface/60 transition-colors hover:text-surface"
        >
          <ChevronLeft className="h-3 w-3" /> Pipeline
        </Link>
      </div>

      <div className="flex items-start justify-between gap-8 px-8 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="font-serif text-2xl text-surface">{deal.asset_name}</h1>
            <Badge tone={STATUS_TONE[deal.status]} dark dot>
              {STATUS_LABEL[deal.status]}
            </Badge>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-sm text-surface/60">
            <MapPin className="h-3.5 w-3.5 text-gold/70" strokeWidth={1.75} />
            <span>{deal.address}</span>
            <span className="text-surface/60">·</span>
            <span>{deal.city}</span>
            <span className="text-surface/60">·</span>
            <span>{deal.country}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge tone="gold" dark>{STAGE_LABEL[deal.deal_stage]}</Badge>
            <Badge tone="neutral" dark>{ASSET_TYPE_LABEL[deal.asset_type]}</Badge>
            {deal.strategy && <Badge tone="neutral" dark>{STRATEGY_LABEL[deal.strategy]}</Badge>}
            {deal.submarket && <Badge tone="muted" dark>{deal.submarket}</Badge>}
          </div>
        </div>

        {/* Score + recommendation */}
        <div className="flex shrink-0 items-center gap-5">
          <div className="text-right">
            <div className="eyebrow-light mb-1">Recommendation</div>
            {score?.recommendation ? (
              <Badge tone={RECOMMENDATION_TONE[score.recommendation]} dark>
                {RECOMMENDATION_LABEL[score.recommendation]}
              </Badge>
            ) : (
              <span className="text-sm text-surface/60">Not scored</span>
            )}
            <div className="mt-2 text-2xs text-surface/60">
              {deal.probability ?? 0}% probability
            </div>
          </div>
          <div className="flex flex-col items-center">
            <div className="eyebrow-light mb-1.5">Score</div>
            <ScoreDial score={score?.overall_score ?? null} size={64} dark />
          </div>
        </div>
      </div>
    </div>
  );
}
