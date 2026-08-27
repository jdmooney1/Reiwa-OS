// ============================================================================
// Asset Intelligence — AI layer architecture (provenance-first).
// ----------------------------------------------------------------------------
// The AI never presents inference as source data. Every statement is tagged with
// provenance so the UI can distinguish verified facts, calculations, forecasts,
// assumptions and AI commentary. Phase 1 emits only FACTS and CALCULATIONS
// derived deterministically from structured data; genuine model-authored
// COMMENTARY arrives in Phase 4 behind this same interface.
// ============================================================================
import type { Tone } from "@/lib/domain";
import type { AssetFile } from "@/lib/asset-intelligence/types";
import {
  METRICS, threeWay, variance, varianceTone, assetSnapshot, upcomingEvents,
  latestClosedPeriod, priorClosedPeriod, type MetricKey,
} from "@/lib/asset-intelligence/metrics";
import { formatMetric } from "@/lib/asset-intelligence/metrics";
import { formatPct, formatMoneyCompact } from "@/lib/format";

export type Provenance = "fact" | "calculation" | "forecast" | "assumption" | "commentary";

export interface IntelStatement {
  provenance: Provenance;
  text: string;
  tone?: Tone;
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  fact: "Fact",
  calculation: "Calculation",
  forecast: "Forecast",
  assumption: "Assumption",
  commentary: "AI Commentary",
};

export const PROVENANCE_TONE: Record<Provenance, Tone> = {
  fact: "neutral",
  calculation: "gold",
  forecast: "caution",
  assumption: "muted",
  commentary: "positive",
};

// The four structured questions the AI layer answers.
export interface AssetBrief {
  whatChanged: IntelStatement[];
  whyItMatters: IntelStatement[];
  whatNeedsAttention: IntelStatement[];
  whatsNext: IntelStatement[];
}

const MATERIAL_KEYS: MetricKey[] = ["noi", "occupancy_pct", "valuation", "irr_pct", "capex"];

/**
 * Material changes since underwriting / prior period — pure CALCULATIONS.
 * Threshold-filtered so only material movements surface.
 */
export function materialChanges(file: AssetFile): IntelStatement[] {
  const out: IntelStatement[] = [];
  const cur = file.asset.currency;

  // Forecast vs underwriting.
  for (const key of MATERIAL_KEYS) {
    const tw = threeWay(file, key);
    if (tw.forecast == null || tw.underwriting == null) continue;
    const v = variance(tw.forecast, tw.underwriting);
    if (v.pct == null || Math.abs(v.pct) < 0.02) continue; // < 2% not material
    const dir = v.abs! > 0 ? "up" : "down";
    out.push({
      provenance: "calculation",
      tone: varianceTone(key, v),
      text: `${METRICS[key].label} forecast is ${dir} ${formatPct(Math.abs(v.pct) * 100, 1)} vs underwriting (${formatMetric(key, tw.underwriting, cur)} → ${formatMetric(key, tw.forecast, cur)}).`,
    });
  }

  // Latest closed period vs prior period.
  const latest = latestClosedPeriod(file);
  const prior = priorClosedPeriod(file);
  if (latest && prior) {
    for (const key of ["noi", "occupancy_pct"] as MetricKey[]) {
      const v = variance(latest[key], prior[key]);
      if (v.pct == null || Math.abs(v.pct) < 0.02) continue;
      const dir = v.abs! > 0 ? "increased" : "decreased";
      out.push({
        provenance: "calculation",
        tone: varianceTone(key, v),
        text: `Actual ${METRICS[key].label} ${dir} ${formatPct(Math.abs(v.pct) * 100, 1)} in ${latest.period_label} vs ${prior.period_label}.`,
      });
    }
  }
  return out;
}

/**
 * Structured brief answering the four questions from system data only.
 * Facts and calculations are grounded; a genuine "commentary" pass (Phase 4)
 * would append model-authored IntelStatements tagged `commentary`.
 */
export function buildAssetBrief(file: AssetFile): AssetBrief {
  const s = assetSnapshot(file);
  const cur = file.asset.currency;

  const whyItMatters: IntelStatement[] = [];
  if (s.irr_delta_ppt != null && Math.abs(s.irr_delta_ppt) >= 0.1) {
    whyItMatters.push({
      provenance: "forecast",
      tone: s.irr_delta_ppt >= 0 ? "positive" : "negative",
      text: `Current forecast equity IRR is ${formatPct(s.forecast_irr, 1)} versus underwriting of ${formatPct(s.underwrite_irr, 1)} — a ${s.irr_delta_ppt >= 0 ? "gain" : "reduction"} of ${Math.abs(s.irr_delta_ppt).toFixed(1)} pts.`,
    });
  }
  if (s.valuation_vs_cost_pct != null) {
    whyItMatters.push({
      provenance: "calculation",
      tone: s.valuation_vs_cost_pct >= 0 ? "positive" : "negative",
      text: `Current valuation is ${formatPct(Math.abs(s.valuation_vs_cost_pct), 1)} ${s.valuation_vs_cost_pct >= 0 ? "above" : "below"} acquisition cost (${formatMoneyCompact(s.acquisition_price, cur)} → ${formatMoneyCompact(s.current_valuation, cur)}).`,
    });
  }

  const whatNeedsAttention: IntelStatement[] = [];
  for (const d of file.decisions.filter((d) => d.status === "required" || d.status === "open").slice(0, 3)) {
    whatNeedsAttention.push({
      provenance: "fact",
      tone: "caution",
      text: `Decision required: ${d.title}${d.deadline ? ` — by ${new Date(d.deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : ""}.`,
    });
  }
  for (const r of file.risks.filter((r) => r.status === "open" && (r.severity === "high" || r.severity === "critical")).slice(0, 2)) {
    whatNeedsAttention.push({ provenance: "fact", tone: "negative", text: `${r.severity === "critical" ? "Critical" : "High"} risk: ${r.title}.` });
  }

  const events = upcomingEvents(file, 90);
  const whatsNext: IntelStatement[] = events.slice(0, 4).map((e) => ({
    provenance: "fact" as const,
    text: `${new Date(e.event_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} — ${e.title}.`,
  }));
  if (events.length > 0) {
    whatsNext.unshift({
      provenance: "calculation",
      text: `${events.length} material event${events.length === 1 ? "" : "s"} occur within the next 90 days.`,
      tone: "caution",
    });
  }

  return { whatChanged: materialChanges(file), whyItMatters, whatNeedsAttention, whatsNext };
}
