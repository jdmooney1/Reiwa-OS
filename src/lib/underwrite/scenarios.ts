// ============================================================================
// Scenarios, hold periods and reverse stress tests over the engine. PURE.
// ----------------------------------------------------------------------------
// The scenario set is fixed and named, so two deals are always stressed the
// same way and an assessment can be compared with the one before it. The
// shocks are deliberately blunt; the point is a consistent yardstick, not a
// forecast.
// ============================================================================
import { NO_SHOCK, runEngine, type EngineResult, type Lease, type Params, type Shock } from "@/lib/underwrite/engine";

export const SCENARIOS = [
  { key: "base", label: "Base", shock: {} },
  { key: "downside", label: "Downside", shock: { exitYieldAdd: 0.005, ervShock: -0.1, growthAdd: -0.02, voidAdd: 6, rfAdd: 3, deferredPaid: false } },
  { key: "upside", label: "Upside", shock: { exitYieldAdd: -0.0025, ervShock: 0.05, growthAdd: 0.01 } },
  { key: "severe", label: "Severe combined", shock: { exitYieldAdd: 0.0075, ervShock: -0.15, growthAdd: -0.03, voidAdd: 9, rfAdd: 3, rateAdd: 0.01, breaksExercised: true, deferredPaid: false } },
] as const satisfies readonly { key: string; label: string; shock: Partial<Shock> }[];
export type ScenarioKey = (typeof SCENARIOS)[number]["key"];

export const SENSITIVITIES = [
  { key: "exit_up_50", label: "Exit yield +0.50%", shock: { exitYieldAdd: 0.005 } },
  { key: "exit_down_25", label: "Exit yield -0.25%", shock: { exitYieldAdd: -0.0025 } },
  { key: "erv_down_10", label: "Market rents -10%", shock: { ervShock: -0.1 } },
  { key: "voids_up_6", label: "Voids +6 months", shock: { voidAdd: 6 } },
  { key: "rate_up_100", label: "Debt cost +1.00%", shock: { rateAdd: 0.01 } },
  { key: "breaks", label: "Every tenant break exercised", shock: { breaksExercised: true } },
  { key: "yen_strong_15", label: "Yen 15% stronger at sale (unhedged)", shock: { fxExitFactor: 0.85 } },
] as const satisfies readonly { key: string; label: string; shock: Partial<Shock> }[];

export const HORIZONS = [5, 8, 10, 15, 25, 50] as const;

/** Growth below zero is allowed by a shock, but never below -100%. */
function shock(s: Partial<Shock>): Shock {
  return { ...NO_SHOCK, ...s };
}

export interface ScenarioRow {
  key: string;
  label: string;
  irrNet: number;
  irrYenHedged: number;
  irrYenUnhedged: number;
  multipleNet: number;
  icrMin: number | null;
  exitValue: number;
}

function row(key: string, label: string, r: EngineResult): ScenarioRow {
  return {
    key, label, irrNet: r.irrNet, irrYenHedged: r.irrYenHedged, irrYenUnhedged: r.irrYenUnhedged,
    multipleNet: r.multipleNet, icrMin: r.icrMin, exitValue: r.exit.gross,
  };
}

export interface HorizonRow {
  years: number;
  saleYear: number;
  unexpiredYears: number | null;
  exitYield: number;
  exitValue: number;
  irrNet: number;
  irrYenHedged: number;
  multipleNet: number;
  cashYieldAvg: number;
}

/** Bisection for x in [lo, hi] where f(x) crosses `target`; null when it does not. */
function solve(f: (x: number) => number, target: number, lo: number, hi: number): number | null {
  // Scan for the first bracket with a sign change: an IRR is undefined (NaN) at
  // the far end of a stress, so the bracket cannot simply be the end points.
  const steps = 24;
  let a = NaN, b = NaN;
  let prev = lo, fprev = f(lo) - target;
  for (let i = 1; i <= steps; i++) {
    const x = lo + (hi - lo) * i / steps, fx = f(x) - target;
    if (Number.isFinite(fprev) && Number.isFinite(fx) && fprev * fx <= 0) { a = prev; b = x; break; }
    prev = x; fprev = fx;
  }
  if (!Number.isFinite(a)) return null;
  const fa = f(a) - target;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2, fm = f(m) - target;
    if (!Number.isFinite(fm)) return null;
    if ((fm > 0) === (fa > 0)) a = m; else b = m;
  }
  return (a + b) / 2;
}

export interface ReverseStress {
  /** The exit yield at which the hedged yen IRR is zero. */
  exitYieldYenZero: number | null;
  /** The cut in market rents at which the hedged yen IRR is zero (-0.25 = 25% lower). */
  ervShockYenZero: number | null;
  /** The price at which the hedged yen IRR reaches each target. */
  priceForYen: { target: number; price: number | null }[];
}

export const YEN_TARGETS = [0.05, 0.06, 0.07, 0.08] as const;

export interface Analysis {
  base: EngineResult;
  scenarios: ScenarioRow[];
  sensitivities: ScenarioRow[];
  horizons: HorizonRow[];
  reverse: ReverseStress;
}

export function analyse(leases: Lease[], params: Params): Analysis {
  const base = runEngine(leases, params);
  const scenarios = SCENARIOS.map((s) => row(s.key, s.label, runEngine(leases, params, shock(s.shock))));
  const sensitivities = SENSITIVITIES.map((s) => row(s.key, s.label, runEngine(leases, params, shock(s.shock))));

  const horizons: HorizonRow[] = HORIZONS.map((h) => {
    const r = runEngine(leases, { ...params, holdYears: h });
    return {
      years: h, saleYear: r.exit.year, unexpiredYears: r.exit.unexpiredYears, exitYield: r.exit.exitYield,
      exitValue: r.exit.gross, irrNet: r.irrNet, irrYenHedged: r.irrYenHedged,
      multipleNet: r.multipleNet, cashYieldAvg: r.cashYieldAvg,
    };
  });

  const yenAt = (s: Partial<Shock>, p: Params = params) => runEngine(leases, p, shock(s)).irrYenHedged;
  const reverse: ReverseStress = {
    exitYieldYenZero: (() => {
      const add = solve((x) => yenAt({ exitYieldAdd: x }), 0, -0.02, 0.1);
      return add === null ? null : params.exitYield + add;
    })(),
    ervShockYenZero: solve((x) => yenAt({ ervShock: x }), 0, -0.6, 0.3),
    priceForYen: YEN_TARGETS.map((target) => {
      // IRR falls as price rises, so the bracket is searched on the price factor.
      const x = solve((k) => yenAt({}, { ...params, price: params.price * k }), target, 0.5, 1.3);
      return { target, price: x === null ? null : params.price * x };
    }),
  };

  return { base, scenarios, sensitivities, horizons, reverse };
}

// ---------------------------------------------------------------------------
// Proposed terms: what the assessment suggests, priced by the engine
// ---------------------------------------------------------------------------

/**
 * The levers an assessment may propose. Each is an INPUT, chosen by judgement
 * and labelled as a proposal; the engine prices it like any other input. None
 * of these is a result, and nothing a model writes is ever shown as one.
 */
export interface ProposedTerms {
  /** Upfront price as a share of the asking price (0.92 = 8% below). */
  priceFactor: number;
  /** Deferred consideration as a share of the asking price, paid in year 2 only if rents hold up. */
  deferredShare: number;
  /** Extra months of vendor rent guarantee on space vacant or expiring within a year. */
  extraGuaranteeMonths: number;
  /** Vendor rent top-up for year-1 voids, in months of the affected rent. */
  topUpMonths: number;
  /** Sponsor acquisition fee, decimal. */
  acqFeePct: number;
}

/** Apply proposed terms to the inputs. Pure: returns new leases and params. */
export function applyTerms(leases: Lease[], params: Params, t: ProposedTerms): { leases: Lease[]; params: Params } {
  const startIdx = (iso: string | null | undefined) => {
    if (!iso) return null;
    const [y, m] = iso.split("-").map(Number);
    const [sy, sm] = params.startDate.split("-").map(Number);
    return (y - sy) * 12 + (m - sm);
  };
  const addMonths = (iso: string, k: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    const total = (y * 12 + (m - 1)) + k;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  let affectedRent = 0;
  const out = leases.map((l) => {
    const end = startIdx(l.guaranteeUntil ?? l.expiry);
    const soon = end !== null && end <= 12;
    if (!soon) return l;
    affectedRent += l.rentPa > 0 ? l.rentPa : (l.ervPa ?? (l.ervPsf ?? 0) * l.areaSqft);
    if (t.extraGuaranteeMonths <= 0 || !l.guaranteeUntil) return l;
    const g = addMonths(l.guaranteeUntil, Math.round(t.extraGuaranteeMonths));
    return { ...l, guaranteeUntil: g, expiry: l.expiry && l.expiry < g ? g : l.expiry };
  });
  return {
    leases: out,
    params: {
      ...params,
      price: params.price * t.priceFactor,
      fees: { ...params.fees, acqPct: t.acqFeePct },
      amendments: {
        deferred: t.deferredShare > 0 ? { amount: params.price * t.deferredShare, month: 18, conditional: true } : null,
        topUpYear1: affectedRent * Math.max(0, t.topUpMonths) / 12,
      },
    },
  };
}

export interface TermsComparison {
  terms: ProposedTerms;
  headlinePrice: number;
  upfrontPrice: number;
  rows: { key: string; label: string; asking: ScenarioRow; proposed: ScenarioRow }[];
}

export function compareTerms(leases: Lease[], params: Params, terms: ProposedTerms): TermsComparison {
  const am = applyTerms(leases, params, terms);
  const rows = SCENARIOS.map((s) => ({
    key: s.key, label: s.label,
    asking: row(s.key, s.label, runEngine(leases, params, shock(s.shock))),
    proposed: row(s.key, s.label, runEngine(am.leases, am.params, shock(s.shock))),
  }));
  return {
    terms,
    headlinePrice: params.price * (terms.priceFactor + terms.deferredShare),
    upfrontPrice: params.price * terms.priceFactor,
    rows,
  };
}
