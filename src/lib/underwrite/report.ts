// ============================================================================
// One assessment run as data: the inputs used, the engine's results, and (when
// the assessment ran) the proposed terms priced by the engine. PURE.
// ----------------------------------------------------------------------------
// This is the object stored in deal_assessments.results and rendered by the
// Assessment tab. It is plain JSON, so what was shown on the day can be shown
// again unchanged after the engine moves on: a stored run is never recomputed.
// ============================================================================
import type { AnnualRow, EngineResult, Lease, Params } from "@/lib/underwrite/engine";
import type { InputLine, Tier } from "@/lib/underwrite/inputs";
import { analyse, compareTerms, type HorizonRow, type ProposedTerms, type ReverseStress, type ScenarioRow, type TermsComparison } from "@/lib/underwrite/scenarios";

/** Bumped when the engine changes what a number means, so old runs are read as what they were. */
export const ENGINE_VERSION = 1;

export interface Report {
  engineVersion: number;
  currency: string;
  tier: Tier;
  lines: InputLine[];
  gaps: string[];
  units: number;
  base: {
    equity: number; debt: number; irrDeal: number; irrUnlevered: number; irrNet: number;
    irrYenHedged: number; irrYenUnhedged: number; multipleNet: number; cashYieldAvg: number;
    icrMin: number | null; feesTotal: number; taxTotal: number;
    exit: EngineResult["exit"];
  };
  annual: AnnualRow[];
  scenarios: ScenarioRow[];
  sensitivities: ScenarioRow[];
  horizons: HorizonRow[];
  reverse: ReverseStress;
  price: number;
  terms: TermsComparison | null;
}

export function buildReport(
  currency: string, tier: Tier, leases: Lease[], params: Params, lines: InputLine[], gaps: string[],
): Report {
  const a = analyse(leases, params);
  const b = a.base;
  return {
    engineVersion: ENGINE_VERSION, currency, tier, lines, gaps, units: leases.length,
    base: {
      equity: b.equity, debt: b.debt, irrDeal: b.irrDeal, irrUnlevered: b.irrUnlevered, irrNet: b.irrNet,
      irrYenHedged: b.irrYenHedged, irrYenUnhedged: b.irrYenUnhedged, multipleNet: b.multipleNet,
      cashYieldAvg: b.cashYieldAvg, icrMin: b.icrMin, feesTotal: b.feesTotal, taxTotal: b.taxTotal, exit: b.exit,
    },
    annual: b.annual,
    scenarios: a.scenarios, sensitivities: a.sensitivities, horizons: a.horizons, reverse: a.reverse,
    price: params.price,
    terms: null,
  };
}

/** Price the assessment's proposed terms and attach them to the report. */
export function withTerms(report: Report, leases: Lease[], params: Params, terms: ProposedTerms): Report {
  return { ...report, terms: compareTerms(leases, params, terms) };
}

/** JSON cannot hold NaN or Infinity; an IRR that does not exist is stored as null and read back as NaN. */
export function toStorable(report: Report): unknown {
  return JSON.parse(JSON.stringify(report, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v)));
}

export function fromStorable(raw: unknown): Report | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Report;
  if (typeof r.engineVersion !== "number" || !Array.isArray(r.annual) || !r.base) return null;
  return r;
}
