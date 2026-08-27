import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { AssetFile } from "@/lib/asset-intelligence/types";
import {
  assetSnapshot, portfolioAggregate,
  SEVERITY_TONE, SEVERITY_LABEL, type Variance,
} from "@/lib/asset-intelligence/metrics";
import { LIFECYCLE_LABEL, LIFECYCLE_TONE } from "@/lib/asset-intelligence/labels";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { formatMoneyCompact, formatPct } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricTile } from "@/components/shared/metric-tile";
import { VarianceValue } from "@/components/shared/variance";
import { cn } from "@/lib/utils";

export function PortfolioDashboard({ files }: { files: AssetFile[] }) {
  const agg = portfolioAggregate(files, "GBP");

  return (
    <div className="space-y-6 px-8 py-6">
      {/* Primary KPI strip */}
      <Card>
        <div className="grid grid-cols-2 divide-x divide-line border-b border-line sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Assets" value={String(agg.assetCount)} />
          <Kpi label="Acquisition Cost" value={formatMoneyCompact(agg.totalAcquisition, "GBP")} sub="GBP-equiv" />
          <Kpi label="Current Valuation" value={formatMoneyCompact(agg.currentValuation, "GBP")}
            extra={<VarianceValue v={{ abs: agg.valuationVsCostPct, pct: agg.valuationVsCostPct != null ? agg.valuationVsCostPct / 100 : null }} tone={agg.valuationVsCostPct != null && agg.valuationVsCostPct >= 0 ? "positive" : "negative"} showAbs unit="ppt" />} />
          <Kpi label="Equity Invested" value={formatMoneyCompact(agg.equityInvested, "GBP")} />
          <Kpi label="Debt" value={formatMoneyCompact(agg.debt, "GBP")} />
          <Kpi label="LTV" value={formatPct(agg.ltv, 1)} />
        </div>
        <div className="grid grid-cols-2 divide-x divide-line sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="NOI" value={formatMoneyCompact(agg.noi, "GBP")} sub="run-rate" />
          <Kpi label="Occupancy" value={formatPct(agg.occupancy, 1)} sub="val-weighted" />
          <Kpi label="Projected IRR" value={formatPct(agg.projectedIrr, 1)} sub="equity-weighted" />
          <Kpi label="Development" value={`${agg.developmentCount} ${agg.developmentCount === 1 ? "asset" : "assets"}`} />
          <Kpi label="Upcoming Events" value={String(agg.upcomingEvents)} sub="next 120 days"
            tone={agg.upcomingEvents > 0 ? "caution" : undefined} />
          <Kpi label="Decisions Required" value={String(agg.decisionsRequired)}
            tone={agg.decisionsRequired > 0 ? "negative" : "positive"} />
        </div>
      </Card>

      {/* Exposure + risk row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ExposureCard title="Geographic Exposure" rows={agg.byCountry} total={agg.currentValuation} />
        <ExposureCard title="Currency Exposure" rows={agg.byCurrency} total={agg.currentValuation} />
        <Card>
          <CardHeader eyebrow="Portfolio" title="Risk & Performance" />
          <CardBody className="space-y-3">
            <Row label="Portfolio risk level">
              {agg.worstSeverity ? (
                <Badge tone={SEVERITY_TONE[agg.worstSeverity]} dot>{SEVERITY_LABEL[agg.worstSeverity]}</Badge>
              ) : <span className="text-xs text-ink-faint">—</span>}
            </Row>
            <Row label="Performance vs underwriting">
              <span className={cn("text-xs font-medium", (agg.projectedIrr ?? 0) >= 0 ? "text-ink" : "text-negative")}>
                Equity IRR {formatPct(agg.projectedIrr, 1)} (forecast)
              </span>
            </Row>
            <Row label="Value vs acquisition cost">
              <VarianceValue v={{ abs: agg.valuationVsCostPct, pct: agg.valuationVsCostPct != null ? agg.valuationVsCostPct / 100 : null }}
                tone={agg.valuationVsCostPct != null && agg.valuationVsCostPct >= 0 ? "positive" : "negative"} showAbs unit="ppt" />
            </Row>
            <Row label="Development exposure">
              <span className="text-xs text-ink">{agg.developmentCount} of {agg.assetCount} assets</span>
            </Row>
          </CardBody>
        </Card>
      </div>

      {/* Asset table */}
      <Card>
        <CardHeader eyebrow="Portfolio" title="Assets"
          action={<span className="text-2xs text-ink-faint">Aggregated from asset records</span>} />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Asset", "Location", "Strategy", "Acq. Cost", "Current Value", "NOI", "Occ.", "LTV", "Forecast IRR", "vs Underwriting", "Risk", "Decisions"].map((h, i) => (
                    <th key={h} className={cn("px-3 py-2.5 text-2xs font-medium uppercase tracking-label text-ink-faint",
                      i >= 3 && i <= 8 && "text-right", (i === 9 || i === 11) && "text-center")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-line">
                {files.map((f) => {
                  const s = assetSnapshot(f);
                  const irrVar: Variance = { abs: s.irr_delta_ppt, pct: null };
                  const tone = s.irr_delta_ppt == null ? "muted" : s.irr_delta_ppt >= 0 ? "positive" : "negative";
                  const perfLabel = s.irr_delta_ppt == null ? "—" : s.irr_delta_ppt >= 0.3 ? "Ahead" : s.irr_delta_ppt <= -0.3 ? "Behind" : "On track";
                  return (
                    <tr key={f.asset.asset_id} className="hover:bg-gold/[0.04]">
                      <td className="px-3 py-2.5">
                        <Link href={`/assets/${f.asset.asset_id}`} className="font-medium text-ink hover:text-gold-deep">
                          {f.asset.name}
                        </Link>
                        <div className="mt-0.5">
                          <Badge tone={LIFECYCLE_TONE[f.asset.lifecycle_stage]}>{LIFECYCLE_LABEL[f.asset.lifecycle_stage]}</Badge>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted">{f.asset.city}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{f.asset.strategy ? STRATEGY_LABEL[f.asset.strategy] : ASSET_TYPE_LABEL[f.asset.asset_type]}</td>
                      <td className="px-3 py-2.5 text-right text-ink">{formatMoneyCompact(s.acquisition_price, s.currency)}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-ink">{formatMoneyCompact(s.current_valuation, s.currency)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-muted">{formatMoneyCompact(s.noi, s.currency)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-muted">{formatPct(s.occupancy, 0)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-muted">{formatPct(s.ltv, 1)}</td>
                      <td className="px-3 py-2.5 text-right text-ink-muted">{formatPct(s.forecast_irr, 1)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={cn("text-2xs font-medium",
                            tone === "positive" && "text-positive", tone === "negative" && "text-negative", tone === "muted" && "text-ink-faint")}>{perfLabel}</span>
                          <VarianceValue v={irrVar} tone={tone} unit="ppt" showAbs />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {s.risk_severity
                          ? <Badge tone={SEVERITY_TONE[s.risk_severity]} dot>{SEVERITY_LABEL[s.risk_severity]}</Badge>
                          : <span className="text-2xs text-ink-faint">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {s.decisions_required > 0 ? (
                          <span className="inline-flex items-center gap-1 text-2xs font-medium text-negative">
                            <AlertTriangle className="h-3 w-3" /> {s.decisions_required}
                          </span>
                        ) : <span className="text-2xs text-ink-faint">0</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, tone, extra }: {
  label: string; value: string; sub?: string; tone?: "caution" | "negative" | "positive"; extra?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] uppercase tracking-label text-ink-faint">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("tabular text-lg font-semibold",
          tone === "negative" && "text-negative", tone === "caution" && "text-caution",
          tone === "positive" && "text-positive", !tone && "text-ink")}>{value}</span>
        {extra}
      </div>
      {sub && <div className="text-[10px] text-ink-faint">{sub}</div>}
    </div>
  );
}

function ExposureCard({ title, rows, total }: { title: string; rows: { label: string; value: number }[]; total: number }) {
  return (
    <Card>
      <CardHeader eyebrow="Exposure" title={title} />
      <CardBody className="space-y-2.5">
        {rows.map((r) => {
          const pct = total > 0 ? (r.value / total) * 100 : 0;
          return (
            <div key={r.label}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-ink">{r.label}</span>
                <span className="tabular text-ink-muted">{formatMoneyCompact(r.value, "GBP")} · {pct.toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-sunken">
                <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div className="text-xs italic text-ink-faint">No data.</div>}
      </CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-ink-muted">{label}</span>
      {children}
    </div>
  );
}
