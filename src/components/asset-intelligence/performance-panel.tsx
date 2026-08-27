"use client";

import { useFormStatus } from "react-dom";
import type { AssetFile } from "@/lib/asset-intelligence/types";
import {
  threeWay, variance, varianceTone, formatMetric, METRICS, type MetricKey,
} from "@/lib/asset-intelligence/metrics";
import { addPerformancePeriodAction } from "@/app/actions/assets";
import { formatMoneyCompact, formatPct, formatDate } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { VarianceValue } from "@/components/shared/variance";

const TW_ROWS: MetricKey[] = ["noi", "occupancy_pct", "valuation", "debt", "ltv_pct"];

export function PerformancePanel({ file, canWrite }: { file: AssetFile; canWrite: boolean }) {
  const cur = file.asset.currency;
  const periods = [...file.periods].sort((a, b) => +new Date(a.period_end) - +new Date(b.period_end));

  return (
    <div className="space-y-6">
      {/* Three-way vs underwriting */}
      <Card>
        <CardHeader eyebrow="Performance" title="Underwriting · Forecast · Latest Actual"
          action={<span className="text-2xs text-ink-faint">Δ = forecast vs underwriting</span>} />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-5 py-2.5 text-2xs font-medium uppercase tracking-label text-ink-faint">Metric</th>
                {["Underwriting", "Forecast", "Actual", "Δ vs UW"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-right text-2xs font-medium uppercase tracking-label text-ink-faint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-line">
              {TW_ROWS.map((key) => {
                const tw = threeWay(file, key);
                const v = variance(tw.forecast, tw.underwriting);
                return (
                  <tr key={key}>
                    <td className="px-5 py-2.5 text-ink-muted">{METRICS[key].label}</td>
                    <td className="px-4 py-2.5 text-right text-ink">{formatMetric(key, tw.underwriting, cur)}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-ink">{formatMetric(key, tw.forecast, cur)}</td>
                    <td className="px-4 py-2.5 text-right text-ink-muted">{tw.actual != null ? formatMetric(key, tw.actual, cur) : "—"}</td>
                    <td className="px-4 py-2.5 text-right"><VarianceValue v={v} tone={varianceTone(key, v)} unit={METRICS[key].unit} currency={cur} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Actuals over time */}
      <Card>
        <CardHeader eyebrow="Actuals" title="Performance Periods" />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Period", "Ending", "NOI", "Occupancy", "Valuation", "Debt", "LTV"].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 text-2xs font-medium uppercase tracking-label text-ink-faint ${i >= 2 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular divide-y divide-line">
              {periods.map((p) => (
                <tr key={p.period_id}>
                  <td className="px-4 py-2.5 font-medium text-ink">{p.period_label}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{formatDate(p.period_end)}</td>
                  <td className="px-4 py-2.5 text-right text-ink">{formatMoneyCompact(p.noi, cur)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-muted">{formatPct(p.occupancy_pct, 0)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-muted">{formatMoneyCompact(p.valuation, cur)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-muted">{formatMoneyCompact(p.debt, cur)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-muted">{formatPct(p.ltv_pct, 1)}</td>
                </tr>
              ))}
              {periods.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-xs italic text-ink-faint">No performance periods recorded yet.</td></tr>}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Entry form */}
      {canWrite && (
        <Card>
          <CardHeader eyebrow="Update" title="Record Performance Period"
            action={<span className="text-2xs text-ink-faint">Appended immutably; variance recalculates</span>} />
          <CardBody>
            <form action={addPerformancePeriodAction.bind(null, file.asset.asset_id)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <F label="Period label" name="periodLabel" placeholder="Q3 2026" required />
                <F label="Period end" name="periodEnd" type="date" required />
                <F label="NOI" name="noi" type="number" placeholder="2020000" />
                <F label="Occupancy %" name="occupancyPct" type="number" step="0.1" placeholder="86" />
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <F label="Valuation" name="valuation" type="number" placeholder="59500000" />
                <F label="Debt" name="debt" type="number" placeholder="29000000" />
                <F label="LTV %" name="ltvPct" type="number" step="0.1" placeholder="48.7" />
                <F label="Gross rent" name="grossRentalIncome" type="number" placeholder="2450000" />
              </div>
              <div className="flex justify-end"><Submit /></div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function F({ label, name, type = "text", placeholder, step, required }: {
  label: string; name: string; type?: string; placeholder?: string; step?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input name={name} type={type} placeholder={placeholder} step={step} required={required}
        className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink placeholder:text-ink-faint focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30" />
    </label>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="rounded bg-navy px-4 py-2 text-xs font-semibold text-surface hover:bg-navy-50 disabled:opacity-60">
      {pending ? "Recording…" : "Record Period"}
    </button>
  );
}
