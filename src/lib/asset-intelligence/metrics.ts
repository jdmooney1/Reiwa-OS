// ============================================================================
// Asset Intelligence — metric definitions, variance & portfolio aggregation.
// Portfolio figures are DERIVED from asset records here (never entered).
// ============================================================================
import type { Currency } from "@/types/database";
import type {
  AssetFile, AssetMetrics, BusinessPlan, PerformancePeriod, PlanType,
  Valuation, SeverityBand,
} from "@/lib/asset-intelligence/types";
import { formatMoneyCompact, formatPct, formatMultiple } from "@/lib/format";
import type { Tone } from "@/lib/domain";

export type MetricKey = keyof AssetMetrics;
export type MetricUnit = "money" | "pct" | "x";

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: MetricUnit;
  higherIsBetter: boolean; // drives variance tone
}

export const METRICS: Record<MetricKey, MetricDef> = {
  gross_rental_income: { key: "gross_rental_income", label: "Gross Rental Income", unit: "money", higherIsBetter: true },
  noi: { key: "noi", label: "NOI", unit: "money", higherIsBetter: true },
  operating_expenses: { key: "operating_expenses", label: "Operating Expenses", unit: "money", higherIsBetter: false },
  occupancy_pct: { key: "occupancy_pct", label: "Occupancy", unit: "pct", higherIsBetter: true },
  capex: { key: "capex", label: "CapEx", unit: "money", higherIsBetter: false },
  valuation: { key: "valuation", label: "Valuation", unit: "money", higherIsBetter: true },
  yield_pct: { key: "yield_pct", label: "Yield", unit: "pct", higherIsBetter: true },
  debt: { key: "debt", label: "Debt", unit: "money", higherIsBetter: false },
  ltv_pct: { key: "ltv_pct", label: "LTV", unit: "pct", higherIsBetter: false },
  cash_on_cash_pct: { key: "cash_on_cash_pct", label: "Cash-on-Cash", unit: "pct", higherIsBetter: true },
  equity_multiple: { key: "equity_multiple", label: "Equity Multiple", unit: "x", higherIsBetter: true },
  irr_pct: { key: "irr_pct", label: "IRR", unit: "pct", higherIsBetter: true },
};

export function formatMetric(key: MetricKey, value: number | null | undefined, currency: Currency): string {
  if (value == null) return "—";
  switch (METRICS[key].unit) {
    case "money": return formatMoneyCompact(value, currency);
    case "pct": return formatPct(value, key === "occupancy_pct" || key === "ltv_pct" ? 1 : 2);
    case "x": return formatMultiple(value);
  }
}

// ---- Plan / period accessors ----------------------------------------------
export function planOf(file: AssetFile, type: PlanType): BusinessPlan | undefined {
  return file.plans
    .filter((p) => p.plan_type === type)
    .sort((a, b) => b.version - a.version)[0];
}

export function latestClosedPeriod(file: AssetFile): PerformancePeriod | undefined {
  return file.periods
    .filter((p) => p.status === "closed")
    .sort((a, b) => +new Date(b.period_end) - +new Date(a.period_end))[0];
}

export function priorClosedPeriod(file: AssetFile): PerformancePeriod | undefined {
  return file.periods
    .filter((p) => p.status === "closed")
    .sort((a, b) => +new Date(b.period_end) - +new Date(a.period_end))[1];
}

export function latestValuation(file: AssetFile): Valuation | undefined {
  return [...file.valuations].sort((a, b) => +new Date(b.valuation_date) - +new Date(a.valuation_date))[0];
}


// ---- Variance --------------------------------------------------------------
export interface Variance {
  abs: number | null;
  pct: number | null; // fractional (0.042 = 4.2%)
}

export function variance(current: number | null | undefined, base: number | null | undefined): Variance {
  if (current == null || base == null) return { abs: null, pct: null };
  const abs = current - base;
  return { abs, pct: base !== 0 ? abs / base : null };
}

/** Tone for a variance, respecting whether higher is better for that metric. */
export function varianceTone(key: MetricKey, v: Variance): Tone {
  if (v.abs == null || v.abs === 0) return "muted";
  const good = METRICS[key].higherIsBetter ? v.abs > 0 : v.abs < 0;
  return good ? "positive" : "negative";
}

// ---- The three-way comparison (Underwriting / Current Forecast / Actual) ---
export interface ThreeWay {
  underwriting: number | null;
  forecast: number | null;
  actual: number | null;
}

export function threeWay(file: AssetFile, key: MetricKey): ThreeWay {
  const uw = planOf(file, "underwriting");
  const fc = planOf(file, "current_forecast") ?? planOf(file, "approved");
  const act = latestClosedPeriod(file);
  return {
    underwriting: uw ? uw[key] : null,
    forecast: fc ? fc[key] : null,
    actual: act ? act[key] : null,
  };
}

/**
 * Actual against plan: the latest closed period against the plan currently in
 * force (the forecast, else the approved plan), falling back to underwriting
 * only when no forecast exists. Null when there is no actual or no plan figure
 * for the metric. `against` says which plan was used, so a caller never has to
 * guess what "plan" meant.
 *
 * This is the number that matters once actuals exist. Forecast-vs-underwriting
 * (threeWay) measures how the view of the future has moved; this measures what
 * has happened.
 */
export function actualVsPlan(
  file: AssetFile, key: MetricKey,
): { v: Variance; plan: number; actual: number; against: "forecast" | "underwriting" } | null {
  const tw = threeWay(file, key);
  if (tw.actual == null) return null;
  const against = tw.forecast != null ? "forecast" : "underwriting";
  const plan = against === "forecast" ? tw.forecast : tw.underwriting;
  if (plan == null) return null;
  return { v: variance(tw.actual, plan), plan, actual: tw.actual, against };
}

// ---- Asset current snapshot (derived) --------------------------------------
export interface AssetSnapshot {
  currency: Currency;
  acquisition_price: number | null;
  equity_invested: number | null;
  current_valuation: number | null;
  noi: number | null;
  occupancy: number | null;
  debt: number | null;
  ltv: number | null;
  yield: number | null;
  underwrite_irr: number | null;
  forecast_irr: number | null;
  irr_delta_ppt: number | null; // forecast − underwrite, percentage points
  valuation_vs_cost_pct: number | null;
  risk_severity: SeverityBand | null;
  decisions_required: number;
}

const SEVERITY_RANK: Record<SeverityBand, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function worstOpenSeverity(file: AssetFile): SeverityBand | null {
  const open = file.risks.filter((r) => r.status === "open" && r.severity);
  if (open.length === 0) return null;
  return open.reduce<SeverityBand>((worst, r) =>
    SEVERITY_RANK[r.severity!] > SEVERITY_RANK[worst] ? r.severity! : worst, "low");
}

export function decisionsRequired(file: AssetFile): number {
  return file.decisions.filter((d) => d.status === "required" || d.status === "open").length;
}

export function assetSnapshot(file: AssetFile): AssetSnapshot {
  const val = latestValuation(file)?.valuation ?? planOf(file, "current_forecast")?.valuation ?? null;
  const period = latestClosedPeriod(file);
  const forecast = planOf(file, "current_forecast") ?? planOf(file, "approved");
  const uw = planOf(file, "underwriting");
  const debt = period?.debt ?? forecast?.debt ?? null;
  const noi = period?.noi ?? forecast?.noi ?? null;
  const occupancy = period?.occupancy_pct ?? forecast?.occupancy_pct ?? null;
  const ltv = debt != null && val ? (debt / val) * 100 : null;
  const yield_ = period?.yield_pct ?? forecast?.yield_pct ?? null;
  const underwrite_irr = uw?.irr_pct ?? null;
  const forecast_irr = forecast?.irr_pct ?? null;
  const acq = file.asset.acquisition_price ?? null;
  return {
    currency: file.asset.currency,
    acquisition_price: acq,
    equity_invested: file.asset.equity_invested ?? null,
    current_valuation: val,
    noi,
    occupancy,
    debt,
    ltv,
    yield: yield_,
    underwrite_irr,
    forecast_irr,
    irr_delta_ppt: forecast_irr != null && underwrite_irr != null ? forecast_irr - underwrite_irr : null,
    valuation_vs_cost_pct: val != null && acq ? ((val - acq) / acq) * 100 : null,
    risk_severity: worstOpenSeverity(file),
    decisions_required: decisionsRequired(file),
  };
}

// ---- Portfolio aggregation (derived from assets) ---------------------------
export interface PortfolioAggregate {
  assetCount: number;
  totalAcquisition: number;
  currentValuation: number;
  equityInvested: number;
  debt: number;
  ltv: number | null;
  noi: number | null;
  occupancy: number | null; // valuation-weighted
  projectedIrr: number | null; // equity-weighted
  /**
   * Value against cost, over ONLY the assets that have both a valuation and an
   * acquisition price. Null when none do. See `coverage`.
   */
  valuationVsCostPct: number | null;
  /**
   * How many assets each ratio above was actually computed from. An asset with
   * no valuation recorded is not a distressed asset, it is a missing number, so
   * it is left out of the ratios it would poison and counted here instead. It
   * stays in assetCount, the money totals and every count.
   */
  coverage: { ltv: number; valueVsCost: number; irr: number };
  byCountry: { label: string; value: number }[];
  byCurrency: { label: string; value: number }[];
  worstSeverity: SeverityBand | null;
  developmentCount: number;
  decisionsRequired: number;
  reportingCurrency: Currency;
}

/**
 * Aggregate a set of assets into one portfolio position.
 *
 * `rates` is REQUIRED and has no fallback, by design. There used to be a
 * DEMO_FX_TO_GBP table serving double duty as a default argument and as a
 * per-currency `?? 1` backstop inside rateOf. Both were silent: a caller who
 * forgot the argument got invented rates, and a caller who passed a rate table
 * missing one currency got that currency converted at 1.0 — valuing a yen
 * position as though it were sterling, roughly a 190x overstatement, on a
 * screen whose entire job is to state what the portfolio is worth.
 *
 * A wrong number that renders is worse than a page that fails, because nobody
 * can see it is wrong. So a missing rate throws, and the caller supplies the
 * table from fx_rates with its source and date (see src/lib/data/portfolio.ts).
 */
export function portfolioAggregate(
  files: AssetFile[],
  rates: Record<string, number>,
  reportingCurrency: Currency = "GBP",
): PortfolioAggregate {
  const rateOf = (c: string) => {
    const r = rates[c];
    if (r == null) {
      throw new Error(
        `No FX rate for ${c}. The portfolio cannot be valued without it — ` +
        "load the rate into fx_rates rather than assuming one.",
      );
    }
    return r;
  };
  const base = rateOf(reportingCurrency);
  const snaps = files.map((f) => ({
    f,
    s: assetSnapshot(f),
    fx: rateOf(f.asset.currency) / base, // asset currency → reporting currency
  }));
  // Sum money metrics in the reporting currency (FX-converted).
  const sum = (fn: (x: (typeof snaps)[number]) => number | null | undefined) =>
    snaps.reduce((a, x) => a + ((fn(x) ?? 0) * x.fx), 0);

  const totalAcquisition = sum((x) => x.s.acquisition_price);
  const currentValuation = sum((x) => x.s.current_valuation);
  const equityInvested = sum((x) => x.s.equity_invested);
  const debt = sum((x) => x.s.debt);
  const noi = sum((x) => x.s.noi);

  // Valuation-weighted occupancy (weights FX-consistent as a ratio).
  const valW = (x: (typeof snaps)[number]) => (x.s.current_valuation ?? 0) * x.fx;
  const occW = snaps.reduce((a, x) => a + (x.s.occupancy != null ? x.s.occupancy * valW(x) : 0), 0);
  const occ = currentValuation > 0 ? occW / currentValuation : null;

  // Equity-weighted forecast IRR, over the assets that HAVE a forecast IRR. The
  // denominator used to be every asset's equity, so an asset with no IRR pulled
  // the average toward zero.
  const eqW = (x: (typeof snaps)[number]) => (x.s.equity_invested ?? 0) * x.fx;
  const withIrr = snaps.filter((x) => x.s.forecast_irr != null && eqW(x) > 0);
  const irrEquity = withIrr.reduce((a, x) => a + eqW(x), 0);
  const irr = irrEquity > 0
    ? withIrr.reduce((a, x) => a + x.s.forecast_irr! * eqW(x), 0) / irrEquity
    : null;

  // Ratios that need a valuation. Debt and cost are summed over the SAME assets
  // as the valuation they are divided into: 101.5% LTV and -68.9pts against cost
  // were an unvalued asset's debt and price sitting in a numerator whose
  // denominator never contained its value.
  const ltvSet = snaps.filter((x) => (x.s.current_valuation ?? 0) > 0 && x.s.debt != null);
  const ltvValue = ltvSet.reduce((a, x) => a + x.s.current_valuation! * x.fx, 0);
  const ltvDebt = ltvSet.reduce((a, x) => a + x.s.debt! * x.fx, 0);
  const costSet = snaps.filter((x) => (x.s.current_valuation ?? 0) > 0 && (x.s.acquisition_price ?? 0) > 0);
  const costValue = costSet.reduce((a, x) => a + x.s.current_valuation! * x.fx, 0);
  const costBase = costSet.reduce((a, x) => a + x.s.acquisition_price! * x.fx, 0);

  const group = (fn: (x: (typeof snaps)[number]) => string | null) => {
    const m = new Map<string, number>();
    for (const x of snaps) {
      const k = fn(x);
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + (x.s.current_valuation ?? 0) * x.fx);
    }
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };

  const worst = snaps.reduce<SeverityBand | null>((w, x) => {
    if (!x.s.risk_severity) return w;
    if (!w || SEVERITY_RANK[x.s.risk_severity] > SEVERITY_RANK[w]) return x.s.risk_severity;
    return w;
  }, null);

  return {
    assetCount: files.length,
    totalAcquisition,
    currentValuation,
    equityInvested,
    debt,
    ltv: ltvValue > 0 ? (ltvDebt / ltvValue) * 100 : null,
    noi,
    occupancy: occ,
    projectedIrr: irr,
    valuationVsCostPct: costBase > 0 ? ((costValue - costBase) / costBase) * 100 : null,
    coverage: { ltv: ltvSet.length, valueVsCost: costSet.length, irr: withIrr.length },
    byCountry: group((x) => x.f.asset.country),
    byCurrency: group((x) => x.f.asset.currency),
    worstSeverity: worst,
    developmentCount: files.filter((f) => f.asset.lifecycle_stage === "development").length,
    // A count. It went through `sum`, which FX-converts, so a yen asset's
    // decisions were multiplied by 0.005 and the dashboard read 4.55.
    decisionsRequired: snaps.reduce((a, x) => a + x.s.decisions_required, 0),
    reportingCurrency,
  };
}


export const SEVERITY_TONE: Record<SeverityBand, Tone> = {
  low: "positive", medium: "caution", high: "negative", critical: "negative",
};
export const SEVERITY_LABEL: Record<SeverityBand, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "Critical",
};
