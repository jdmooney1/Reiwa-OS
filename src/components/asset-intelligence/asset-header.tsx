import Link from "next/link";
import { ChevronLeft, MapPin, FileText } from "lucide-react";
import type { AssetFile } from "@/lib/asset-intelligence/types";
import { assetSnapshot } from "@/lib/asset-intelligence/metrics";
import { LIFECYCLE_LABEL, LIFECYCLE_TONE } from "@/lib/asset-intelligence/labels";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { formatMoneyCompact, formatPct } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function AssetHeader({ file, portfolioName }: { file: AssetFile; portfolioName: string | null }) {
  const a = file.asset;
  const s = assetSnapshot(file);
  return (
    <div className="bg-navy text-surface">
      <div className="px-8 pt-5">
        <Link href="/portfolio" className="inline-flex items-center gap-1 text-2xs text-surface/50 transition-colors hover:text-surface">
          <ChevronLeft className="h-3 w-3" /> Portfolio
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-6 px-8 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-2xl text-surface">{a.name}</h1>
            <Badge tone={LIFECYCLE_TONE[a.lifecycle_stage]} dark dot>{LIFECYCLE_LABEL[a.lifecycle_stage]}</Badge>
            {a.is_demo && <Badge tone="gold" dark>Demo data</Badge>}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-sm text-surface/60">
            <MapPin className="h-3.5 w-3.5 text-gold/70" strokeWidth={1.75} />
            <span>{a.address}</span><span className="text-surface/30">·</span>
            <span>{a.city}</span><span className="text-surface/30">·</span><span>{a.country}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {portfolioName && <Badge tone="neutral" dark>{portfolioName}</Badge>}
            {a.strategy && <Badge tone="neutral" dark>{STRATEGY_LABEL[a.strategy]}</Badge>}
            <Badge tone="neutral" dark>{ASSET_TYPE_LABEL[a.asset_type]}</Badge>
            {a.source_deal_id && (
              <Link href={`/opportunities/${a.source_deal_id}`}>
                <Badge tone="muted" dark className="hover:border-gold/60">
                  <FileText className="h-2.5 w-2.5" /> Underwriting case
                </Badge>
              </Link>
            )}
          </div>
        </div>
        {/* Headline snapshot */}
        <div className="flex items-center gap-6">
          <HeadFig label="Current Value" value={formatMoneyCompact(s.current_valuation, a.currency)} />
          <HeadFig label="Occupancy" value={formatPct(s.occupancy, 0)} />
          <HeadFig label="Forecast IRR" value={formatPct(s.forecast_irr, 1)}
            sub={s.underwrite_irr != null ? `UW ${formatPct(s.underwrite_irr, 1)}` : undefined} />
        </div>
      </div>
    </div>
  );
}

function HeadFig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-right">
      <div className="eyebrow-light mb-1">{label}</div>
      <div className="tabular text-lg font-semibold text-surface">{value}</div>
      {sub && <div className="tabular text-2xs text-surface/40">{sub}</div>}
    </div>
  );
}
