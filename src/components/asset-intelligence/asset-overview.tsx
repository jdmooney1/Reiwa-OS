import { CalendarClock } from "lucide-react";
import type { AssetFile } from "@/lib/asset-intelligence/types";
import {
  assetSnapshot, threeWay, variance, varianceTone, formatMetric, upcomingEvents,
  METRICS, SEVERITY_TONE, SEVERITY_LABEL, type MetricKey,
} from "@/lib/asset-intelligence/metrics";
import { buildAssetBrief, PROVENANCE_LABEL, PROVENANCE_TONE, type IntelStatement } from "@/lib/asset-intelligence/ai";
import { DECISION_STATUS_TONE, DECISION_STATUS_LABEL, EVENT_TYPE_LABEL } from "@/lib/asset-intelligence/labels";
import { formatMoneyCompact, formatPct, formatDate } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VarianceValue } from "@/components/shared/variance";
import { cn } from "@/lib/utils";

const THREE_WAY_ROWS: MetricKey[] = [
  "gross_rental_income", "noi", "occupancy_pct", "valuation", "capex", "debt", "ltv_pct", "irr_pct",
];

export function AssetOverview({ file }: { file: AssetFile }) {
  const a = file.asset;
  const s = assetSnapshot(file);
  const cur = a.currency;
  const brief = buildAssetBrief(file);
  const events = upcomingEvents(file, 120);
  const openRisks = [...file.risks].filter((r) => r.status === "open")
    .sort((x, y) => (y.financial_impact ?? 0) - (x.financial_impact ?? 0));
  const decisions = file.decisions.filter((d) => d.status === "required" || d.status === "open");

  const snapshot: { label: string; value: string }[] = [
    { label: "Acquired", value: formatDate(a.acquisition_date) },
    { label: "Acq. Price", value: formatMoneyCompact(a.acquisition_price, cur) },
    { label: "Current Value", value: formatMoneyCompact(s.current_valuation, cur) },
    { label: "Equity", value: formatMoneyCompact(s.equity_invested, cur) },
    { label: "Debt", value: formatMoneyCompact(s.debt, cur) },
    { label: "NOI", value: formatMoneyCompact(s.noi, cur) },
    { label: "Occupancy", value: formatPct(s.occupancy, 0) },
    { label: "LTV", value: formatPct(s.ltv, 1) },
    { label: "Yield", value: formatPct(s.yield, 2) },
    { label: "UW IRR", value: formatPct(s.underwrite_irr, 1) },
    { label: "Forecast IRR", value: formatPct(s.forecast_irr, 1) },
  ];

  return (
    <div className="space-y-6">
      {/* Investment snapshot */}
      <Card>
        <div className="grid grid-cols-2 divide-x divide-line sm:grid-cols-4 lg:grid-cols-11">
          {snapshot.map((m, i) => (
            <div key={m.label} className={cn("px-3.5 py-3", i >= 4 && "border-t border-line lg:border-t-0")}>
              <div className="text-[10px] uppercase tracking-label text-ink-faint">{m.label}</div>
              <div className="tabular mt-1 text-sm font-semibold text-ink">{m.value}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* AI intelligence brief (interpretive layer — provenance-tagged) */}
      <Card className="border-navy/15">
        <CardHeader eyebrow="Asset Intelligence" title="Executive Brief"
          action={<span className="text-2xs text-ink-faint">Generated from structured data</span>} />
        <CardBody className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          <BriefColumn heading="What changed" statements={brief.whatChanged} />
          <BriefColumn heading="Why it matters" statements={brief.whyItMatters} />
          <BriefColumn heading="Requires attention" statements={brief.whatNeedsAttention} />
          <BriefColumn heading="What's next" statements={brief.whatsNext} />
        </CardBody>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-2.5">
          <span className="text-[10px] uppercase tracking-label text-ink-faint">Provenance</span>
          {(["fact", "calculation", "forecast", "assumption", "commentary"] as const).map((p) => (
            <span key={p} className="flex items-center gap-1 text-[10px] text-ink-muted">
              <ProvenanceDot p={p} /> {PROVENANCE_LABEL[p]}
            </span>
          ))}
          <span className="ml-auto text-[10px] italic text-ink-faint">AI inference is never presented as source data.</span>
        </div>
      </Card>

      {/* Performance vs underwriting (three-way) */}
      <Card>
        <CardHeader eyebrow="Performance" title="Original Underwriting · Current Forecast · Actual"
          action={<span className="text-2xs text-ink-faint">Δ = forecast vs underwriting</span>} />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-5 py-2.5 text-2xs font-medium uppercase tracking-label text-ink-faint">Metric</th>
                  {["Underwriting", "Current Forecast", "Actual", "Δ vs UW"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-right text-2xs font-medium uppercase tracking-label text-ink-faint">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-line">
                {THREE_WAY_ROWS.map((key) => {
                  const tw = threeWay(file, key);
                  const v = variance(tw.forecast, tw.underwriting);
                  return (
                    <tr key={key}>
                      <td className="px-5 py-2.5 text-ink-muted">{METRICS[key].label}</td>
                      <td className="px-4 py-2.5 text-right text-ink">{formatMetric(key, tw.underwriting, cur)}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-ink">{formatMetric(key, tw.forecast, cur)}</td>
                      <td className="px-4 py-2.5 text-right text-ink-muted">{tw.actual != null ? formatMetric(key, tw.actual, cur) : "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <VarianceValue v={v} tone={varianceTone(key, v)} unit={METRICS[key].unit} currency={cur} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Evidence: decisions · risks · events */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Decisions required */}
        <Card className={cn(decisions.length > 0 && "border-negative/30")}>
          <CardHeader eyebrow="Action" title="Decisions Required"
            action={<span className="tabular rounded bg-negative/10 px-1.5 py-0.5 text-2xs font-semibold text-negative">{decisions.length}</span>} />
          <CardBody className="p-0">
            {decisions.length === 0 ? <Empty text="No decisions outstanding." /> : (
              <ul className="divide-y divide-line">
                {decisions.map((d) => (
                  <li key={d.decision_id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-ink">{d.title}</span>
                      <Badge tone={DECISION_STATUS_TONE[d.status]}>{DECISION_STATUS_LABEL[d.status]}</Badge>
                    </div>
                    {d.recommendation && <p className="mt-1 text-2xs text-ink-muted">{d.recommendation}</p>}
                    <div className="mt-1 flex items-center gap-2 text-2xs text-ink-faint">
                      {d.deadline && <span>Due {formatDate(d.deadline)}</span>}
                      {d.financial_impact != null && <span>· Impact {formatMoneyCompact(d.financial_impact, cur)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Risks */}
        <Card>
          <CardHeader eyebrow="Risk" title="Highest-Priority Risks" />
          <CardBody className="p-0">
            {openRisks.length === 0 ? <Empty text="No open risks." /> : (
              <ul className="divide-y divide-line">
                {openRisks.slice(0, 5).map((r) => (
                  <li key={r.risk_id} className="flex items-start justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-ink">{r.title}</div>
                      <div className="text-2xs capitalize text-ink-faint">{r.category}
                        {r.financial_impact != null && ` · ${formatMoneyCompact(r.financial_impact, cur)}`}</div>
                    </div>
                    {r.severity && <Badge tone={SEVERITY_TONE[r.severity]} dot>{SEVERITY_LABEL[r.severity]}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Upcoming events */}
        <Card>
          <CardHeader eyebrow="Timeline" title="Upcoming Events"
            action={<span className="text-2xs text-ink-faint">next 120 days</span>} />
          <CardBody className="p-0">
            {events.length === 0 ? <Empty text="No events in the window." /> : (
              <ul className="divide-y divide-line">
                {events.map((e) => (
                  <li key={e.event_id} className="flex items-start gap-3 px-5 py-2.5">
                    <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-ink">{e.title}</div>
                      <div className="text-2xs text-ink-faint">{EVENT_TYPE_LABEL[e.type]}</div>
                    </div>
                    <span className="tabular shrink-0 text-2xs text-ink-muted">{formatDate(e.event_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function BriefColumn({ heading, statements }: { heading: string; statements: IntelStatement[] }) {
  return (
    <div>
      <div className="mb-2 text-2xs font-semibold uppercase tracking-label text-ink">{heading}</div>
      {statements.length === 0 ? (
        <p className="text-xs italic text-ink-faint">Nothing material.</p>
      ) : (
        <ul className="space-y-2">
          {statements.map((st, i) => (
            <li key={i} className="flex gap-2">
              <ProvenanceDot p={st.provenance} className="mt-1.5" />
              <span className={cn("text-xs leading-relaxed",
                st.tone === "negative" ? "text-negative" : st.tone === "positive" ? "text-positive" : "text-ink/90")}>
                {st.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProvenanceDot({ p, className }: { p: keyof typeof PROVENANCE_TONE; className?: string }) {
  const tone = PROVENANCE_TONE[p];
  return (
    <span
      title={PROVENANCE_LABEL[p]}
      className={cn("h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "gold" && "bg-gold", tone === "caution" && "bg-caution",
        tone === "positive" && "bg-positive", tone === "neutral" && "bg-ink-faint",
        tone === "muted" && "bg-line", tone === "negative" && "bg-negative", className)}
    />
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-4 text-xs italic text-ink-faint">{text}</p>;
}
