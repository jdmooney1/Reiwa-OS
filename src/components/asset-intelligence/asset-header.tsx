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
    <div className="border-b border-line bg-surface-card text-ink">
      <div className="px-8 pt-5">
        <Link href="/portfolio" className="inline-flex items-center gap-1 text-2xs text-ink-faint transition-colors hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Portfolio
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-6 px-8 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl text-ink">{a.name}</h1>
            <Badge tone={LIFECYCLE_TONE[a.lifecycle_stage]} dot>{LIFECYCLE_LABEL[a.lifecycle_stage]}</Badge>
            {a.is_demo && <Badge tone="accent">Demo data</Badge>}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-faint">
            <MapPin className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} />
            <span>{a.address}</span><span className="text-ink-faint">·</span>
            <span>{a.city}</span><span className="text-ink-faint">·</span><span>{a.country}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {portfolioName && <Badge tone="neutral">{portfolioName}</Badge>}
            {a.strategy && <Badge tone="neutral">{STRATEGY_LABEL[a.strategy]}</Badge>}
            <Badge tone="neutral">{ASSET_TYPE_LABEL[a.asset_type]}</Badge>
            {a.source_deal_id && (
              <Link href={`/opportunities/${a.source_deal_id}`}>
                <Badge tone="muted" className="hover:border-line">
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
      <div className="eyebrow mb-1">{label}</div>
      <div className="tabular text-lg font-semibold text-ink">{value}</div>
      {sub && <div className="tabular text-2xs text-ink-faint">{sub}</div>}
    </div>
  );
}
