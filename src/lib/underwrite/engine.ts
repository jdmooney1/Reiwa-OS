// ============================================================================
// Deal assessment engine: a lease-by-lease monthly cash flow, after tax, fees
// and currency. PURE.
// ----------------------------------------------------------------------------
// This is the code that produces every number on the Assessment tab. The model
// that writes the assessment reads these numbers; it never produces one. Same
// rule as the memo (docs/07) and the memo review (docs/21): a figure is computed
// by code from named inputs, or it is not shown.
//
// Generalised from the Mutual House underwriting (October 2026), which is kept
// as a regression fixture in tests/unit/deal-engine.test.ts.
//
// Conventions
//   - Rates are decimals (0.0625), never percentages.
//   - Money is in the deal currency (GBP or EUR) unless a name says yen.
//   - Month 0 is the completion month. Year y covers months 12(y-1) .. 12y-1.
//   - The sale happens at the end of the hold, on the next twelve months' rent
//     less ground rent, capitalised at the exit yield grossed up for the
//     purchaser's costs (UK market convention, applied everywhere for one rule).
//   - A lease with no expiry is open-ended (a long lease or a freehold vacant
//     possession case is entered with an expiry).
//
// Nothing here reads a clock, a database or the network.
// ============================================================================

export type Use = "office" | "retail" | "residential" | "industrial" | "hotel" | "other";
export const USES: Use[] = ["office", "retail", "residential", "industrial", "hotel", "other"];

export type ReviewBasis = "upward_only" | "open_market" | "none";

/** One unit in the rent roll. Dates are ISO yyyy-mm-dd. */
export interface Lease {
  unit: string;
  tenant: string | null;
  use: Use;
  areaSqft: number;
  /** Passing rent per year; 0 when vacant. */
  rentPa: number;
  /** Lease end. Null means no expiry within any modelled horizon. Vacant units use the completion date. */
  expiry: string | null;
  /** A tenant break, if the downside should treat it as exercised. */
  breakDate?: string | null;
  reviewDate?: string | null;
  reviewBasis?: ReviewBasis;
  /** Market rent per year for this unit today. Falls back to ervPsf x area, then to the passing rent. */
  ervPa?: number | null;
  ervPsf?: number | null;
  /** A vendor guarantee pays the passing rent until this date (for a vacant or expiring unit). */
  guaranteeUntil?: string | null;
  /** Fit-out spent on a re-letting, per sq ft (today's money). */
  reletCapexPsf?: number | null;
  /** Per-unit override of the renewal assumption, where the facts are known (a tenant in talks to renew). */
  renewalProb?: number | null;
  renewalRentFreeMonths?: number | null;
}

export type GroundRent =
  | { kind: "none" }
  | { kind: "fixed"; amountPa: number; growth: number }
  | { kind: "geared"; pct: number; minimumPa: number };

export interface Amendments {
  /** Paid in month `month`, capitalised into cost. Not paid in a scenario where `conditional` and rents disappoint. */
  deferred?: { amount: number; month: number; conditional: boolean } | null;
  /** A one-off rent top-up from the vendor in year 1 (income). */
  topUpYear1?: number;
}

export interface Params {
  startDate: string;
  holdYears: number;
  price: number;
  purchaseCostsPct: number;
  saleCostsPct: number;
  exitYield: number;
  /** Capex spent in year 1 on top of re-letting costs (the case's capex line). */
  initialCapex: number;

  ervGrowth: Record<Use, number>;
  voidMonths: number;
  rentFreeMonths: number;
  /** Share of expiring tenants assumed to stay. Blends void and incentive, Argus-style. */
  renewalProb: number;
  renewalRentFreeMonths: number;
  newLeaseYears: number;
  lettingFeePct: number;
  voidCostPsf: number;
  nonRecoverablePct: number;
  fixedCostsPa: number;
  costInflation: number;
  groundRent: GroundRent;

  lifecycle: {
    sinkPct: number; sinkFromYear: number;
    refreshEveryYears: number; refreshPsf: number; refreshUse: Use[];
    majorFirstYear: number; majorEveryYears: number; majorPsf: number;
  };

  /** Leasehold expiry as a decimal year (2117.26); null for freehold. */
  leaseholdExpiry: number | null;
  /** Exit-yield add-on per decade of unexpired term below 80 years. */
  shortLeasePremium: number;

  ltv: number;
  debtRate: number;
  debtTermYears: number;
  refiRate: number;
  arrangementFeePct: number;

  taxRate: number;
  fees: { acqPct: number; amPctEquity: number; promotePct: number; hurdle: number };

  /** Yen per unit of deal currency, today. */
  fxSpot: number;
  /** Policy-rate proxies for the hedge: deal currency and yen. */
  dealRate: number;
  yenRate: number;
  hedgeRatio: number;
  /** Hedge cost a year after the first five years, when forward points are no longer quoted. */
  hedgeCostLong: number;
  /** Yen per unit at sale, for the unhedged share (moves in a straight line). */
  fxExitSpot: number;

  amendments: Amendments;
}

export interface AnnualRow {
  year: number;
  gross: number;
  groundRent: number;
  opex: number;
  noi: number;
  capex: number;
  interest: number;
  amFee: number;
  tax: number;
  distribution: number;
}

export interface EngineResult {
  holdYears: number;
  annual: AnnualRow[];
  equity: number;
  debt: number;
  exit: {
    year: number; forwardNet: number; exitYield: number; relativity: number;
    unexpiredYears: number | null; gross: number; net: number; taxOnGain: number; promote: number; proceeds: number;
  };
  deferredPaid: number;
  irrDeal: number;
  irrUnlevered: number;
  irrNet: number;
  irrYenHedged: number;
  irrYenUnhedged: number;
  multipleNet: number;
  cashYieldAvg: number;
  icrMin: number | null;
  feesTotal: number;
  taxTotal: number;
}

// ---------------------------------------------------------------------------
// Arithmetic helpers
// ---------------------------------------------------------------------------

/** Annual IRR by bisection; NaN when the flows do not change sign. */
export function irr(flows: number[]): number {
  const f = (r: number) => flows.reduce((s, c, t) => s + c / Math.pow(1 + r, t), 0);
  let lo = -0.99, hi = 2;
  if (f(lo) * f(hi) > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole months from `start` to `date` (negative when before). Null for an absent or bad date. */
export function monthIndex(start: string, date: string | null | undefined): number | null {
  if (!date) return null;
  const a = ISO.exec(start), b = ISO.exec(date.trim());
  if (!a || !b) return null;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
}

function startYear(start: string): number {
  const m = ISO.exec(start);
  return m ? Number(m[1]) + (Number(m[2]) - 1) / 12 : 0;
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

/** Value of a lease with `u` years left relative to one with 80 or more (growing annuity). */
export function leaseRelativity(u: number, y: number, g: number, floor = 80): number {
  if (u >= floor) return 1;
  const af = (n: number) => 1 - Math.pow((1 + g) / (1 + y + g), Math.max(0, n));
  return af(u) / af(floor);
}

// ---------------------------------------------------------------------------
// Rent: one lease through time
// ---------------------------------------------------------------------------

/**
 * `rent` is cash received. `headline` is the rent a valuer would capitalise: the
 * contracted rate, ignoring rent-free, and market rent for space in a void.
 */
interface UnitFlows { rent: number[]; headline: number[]; voidCost: number[]; capex: number[] }

function ervAt(lease: Lease, p: Params, t: number, ervShock: number): number {
  const base = lease.ervPa ?? (lease.ervPsf != null ? lease.ervPsf * lease.areaSqft : lease.rentPa);
  return base * (1 + ervShock) * Math.pow(1 + p.ervGrowth[lease.use], t / 12);
}

/**
 * Monthly rent, void cost and capex for one unit over `n` months.
 *
 * Expiry follows a blended path: a share `renewalProb` renews at market with a
 * short incentive, the rest leaves and is re-let after a void with a longer one.
 * The blend is applied to the void and incentive lengths, which keeps one
 * deterministic path per unit (the usual market-leasing-profile convention).
 */
function unitFlows(lease: Lease, p: Params, n: number, shock: Shock): UnitFlows {
  const rent = new Array(n).fill(0), headline = new Array(n).fill(0), voidCost = new Array(n).fill(0), capex = new Array(n).fill(0);
  const stay = lease.renewalProb ?? p.renewalProb;
  const q = 1 - stay;
  const voidM = Math.round((p.voidMonths + shock.voidAdd) * q);
  const rfM = Math.round((p.rentFreeMonths + shock.rfAdd) * q + (lease.renewalRentFreeMonths ?? p.renewalRentFreeMonths) * stay);
  const fee = p.lettingFeePct * (q + 0.5 * stay);
  const cpx = (lease.reletCapexPsf ?? 0) * lease.areaSqft * q;

  let rate = lease.rentPa;
  let end = monthIndex(p.startDate, lease.expiry);
  if (shock.breaksExercised && lease.breakDate) {
    const b = monthIndex(p.startDate, lease.breakDate);
    if (b !== null && (end === null || b < end)) end = b;
  }
  const review = monthIndex(p.startDate, lease.reviewDate ?? null);
  const guarantee = monthIndex(p.startDate, lease.guaranteeUntil ?? null);
  if (guarantee !== null && (end === null || guarantee > end)) end = Math.max(0, guarantee);
  if (lease.rentPa <= 0 && guarantee === null) end = 0; // vacant at completion
  if (end !== null && end < 0) end = 0;

  let t = 0;
  // Current lease.
  const stop = end === null ? n : Math.min(n, end);
  for (; t < stop; t++) {
    if (review !== null && t === review && review > 0) {
      const m = ervAt(lease, p, t, shock.ervShock);
      rate = lease.reviewBasis === "open_market" ? m : lease.reviewBasis === "none" ? rate : Math.max(rate, m);
    }
    rent[t] = rate / 12;
    headline[t] = rate / 12;
  }
  // Successive re-lettings to the end of the horizon.
  while (t < n) {
    const letAt = t + voidM;
    for (let k = t; k < Math.min(n, letAt); k++) {
      voidCost[k] += (p.voidCostPsf * lease.areaSqft / 12) * Math.pow(1 + p.costInflation, k / 12);
      headline[k] = ervAt(lease, p, k, shock.ervShock) / 12;
    }
    if (letAt >= n) break;
    const newRent = ervAt(lease, p, letAt, shock.ervShock);
    capex[letAt] += fee * newRent + cpx * Math.pow(1 + p.costInflation, letAt / 12);
    const term = Math.max(1, Math.round(p.newLeaseYears * 12));
    const reviewAt = letAt + Math.round(term / 2);
    let r = newRent;
    for (let k = letAt; k < Math.min(n, letAt + term); k++) {
      if (k === reviewAt) r = Math.max(r, ervAt(lease, p, k, shock.ervShock));
      headline[k] = r / 12;
      if (k >= letAt + rfM) rent[k] = r / 12;
    }
    t = letAt + term;
  }
  return { rent, headline, voidCost, capex };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** A scenario's shocks to the base inputs. All zero is the base case. */
export interface Shock {
  ervShock: number;          // -0.1 = market rents 10% lower
  growthAdd: number;         // added to every rental growth rate
  voidAdd: number;           // months
  rfAdd: number;             // months
  exitYieldAdd: number;      // decimal
  rateAdd: number;           // decimal, on debt and refinancing
  fxExitFactor: number;      // 0.85 = yen 15% stronger at sale (unhedged share)
  breaksExercised: boolean;
  deferredPaid: boolean;
}

export const NO_SHOCK: Shock = {
  ervShock: 0, growthAdd: 0, voidAdd: 0, rfAdd: 0, exitYieldAdd: 0, rateAdd: 0,
  fxExitFactor: 1, breaksExercised: false, deferredPaid: true,
};

export function runEngine(leases: Lease[], params: Params, shock: Shock = NO_SHOCK): EngineResult {
  const p: Params = {
    ...params,
    ervGrowth: Object.fromEntries(USES.map((u) => [u, params.ervGrowth[u] + shock.growthAdd])) as Record<Use, number>,
  };
  const H = Math.max(1, Math.round(p.holdYears));
  const n = (H + 1) * 12; // the hold plus the forward year the sale is priced on

  const gross = new Array(n).fill(0), head = new Array(n).fill(0), voidC = new Array(n).fill(0), relet = new Array(n).fill(0);
  for (const l of leases) {
    const f = unitFlows(l, p, n, shock);
    for (let t = 0; t < n; t++) { gross[t] += f.rent[t]; head[t] += f.headline[t]; voidC[t] += f.voidCost[t]; relet[t] += f.capex[t]; }
  }

  const ground = gross.map((g, t) => {
    const gr = p.groundRent;
    if (gr.kind === "none") return 0;
    if (gr.kind === "fixed") return gr.amountPa / 12 * Math.pow(1 + gr.growth, Math.floor(t / 12));
    return Math.max(gr.pct * g, gr.minimumPa / 12);
  });
  const opex = gross.map((g, t) => p.nonRecoverablePct * g + p.fixedCostsPa / 12 * Math.pow(1 + p.costInflation, t / 12) + voidC[t]);

  // Annualise.
  const yr = (a: number[], y: number) => sum(a.slice((y - 1) * 12, y * 12));
  const G: number[] = [], GR: number[] = [], OX: number[] = [], NOI: number[] = [], CX: number[] = [];
  const area = leases.reduce((s, l) => s + l.areaSqft, 0);
  const refreshArea = leases.filter((l) => p.lifecycle.refreshUse.includes(l.use)).reduce((s, l) => s + l.areaSqft, 0);
  for (let y = 1; y <= H + 1; y++) {
    G.push(yr(gross, y)); GR.push(yr(ground, y)); OX.push(yr(opex, y));
    NOI.push(G[y - 1] - GR[y - 1] - OX[y - 1]);
    const ci = Math.pow(1 + p.costInflation, y - 1);
    let cx = yr(relet, y);
    if (y === 1) cx += p.initialCapex;
    const lc = p.lifecycle;
    if (y >= lc.sinkFromYear) cx += lc.sinkPct * G[y - 1];
    if (lc.refreshEveryYears > 0 && y > lc.refreshEveryYears && (y - 1) % lc.refreshEveryYears === 0) cx += lc.refreshPsf * refreshArea * ci;
    if (lc.majorEveryYears > 0 && y >= lc.majorFirstYear && (y - lc.majorFirstYear) % lc.majorEveryYears === 0) cx += lc.majorPsf * area * ci;
    CX.push(cx);
  }
  NOI[0] += p.amendments.topUpYear1 ?? 0;

  const def = p.amendments.deferred;
  const deferredPaid = def && def.amount > 0 && (shock.deferredPaid || !def.conditional) ? def.amount : 0;
  if (deferredPaid && def) {
    const y = Math.min(H, Math.floor(def.month / 12) + 1);
    CX[y - 1] += deferredPaid * (1 + p.purchaseCostsPct);
  }

  // Exit.
  const exitYearDecimal = startYear(p.startDate) + H;
  const unexpired = p.leaseholdExpiry != null ? p.leaseholdExpiry - exitYearDecimal : null;
  const gL = (p.ervGrowth.office + p.ervGrowth.retail) / 2;
  let y = p.exitYield + shock.exitYieldAdd;
  if (unexpired !== null) y += Math.max(0, (80 - unexpired) / 10) * p.shortLeasePremium;
  const rel = unexpired === null ? 1 : leaseRelativity(unexpired, y, gL);
  // Valuer's convention: capitalise the headline rent for the year after the
  // sale, less ground rent on it, then deduct the rent a buyer will not receive
  // in that year (voids and rent-free still running). Valuing on cash alone would
  // write a whole lease off for a twelve-month rent-free.
  const fwdHeadline = sum(head.slice(H * 12, H * 12 + 12));
  const gr = p.groundRent;
  const groundOn = (rent: number) => gr.kind === "none" ? 0
    : gr.kind === "fixed" ? gr.amountPa * Math.pow(1 + gr.growth, H)
    : Math.max(gr.pct * rent, gr.minimumPa);
  const forwardNet = fwdHeadline - groundOn(fwdHeadline);
  const shortfall = Math.max(0, (fwdHeadline - G[H]) - (groundOn(fwdHeadline) - groundOn(G[H])));
  const exitGross = Math.max(0, forwardNet / (y * (1 + p.purchaseCostsPct)) * rel - shortfall);
  const exitNet = exitGross * (1 - p.saleCostsPct);

  // Capital stack.
  const acq = p.price * (1 + p.purchaseCostsPct);
  const debt = p.price * p.ltv;
  const loanFee = debt * p.arrangementFeePct;
  const feeAcq = p.price * p.fees.acqPct;
  const equity = acq - debt + loanFee + feeAcq;
  const amFee = equity * p.fees.amPctEquity;

  const interest: number[] = [];
  for (let t = 1; t <= H; t++) {
    const fixed = t <= p.debtTermYears;
    const rate = (fixed ? p.debtRate : p.refiRate) + shock.rateAdd;
    const refiFee = !fixed && (t - p.debtTermYears - 1) % p.debtTermYears === 0 ? debt * p.arrangementFeePct : 0;
    interest.push(debt * rate + refiFee);
  }

  // Deal level (before tax and fees).
  const unlev = [-acq, ...NOI.slice(0, H).map((x, i) => x - CX[i])];
  unlev[H] += exitNet;
  const lev = [-(acq - debt + loanFee), ...NOI.slice(0, H).map((x, i) => x - CX[i] - interest[i])];
  lev[H] += exitNet - debt;

  // Investor: tax with losses carried forward, then fees.
  let loss = 0, capexCum = 0;
  const tax: number[] = [];
  const inv = [-equity];
  for (let t = 1; t <= H; t++) {
    let taxable = NOI[t - 1] - interest[t - 1] - amFee - loss; loss = 0;
    if (taxable < 0) { loss = -taxable; taxable = 0; }
    tax.push(taxable * p.taxRate);
    capexCum += CX[t - 1];
    inv.push(NOI[t - 1] - CX[t - 1] - interest[t - 1] - amFee - tax[t - 1]);
  }
  const dist = inv.slice(1);
  const gain = Math.max(0, exitNet - (acq + feeAcq + capexCum) - loss);
  const taxOnGain = gain * p.taxRate;
  inv[H] += exitNet - debt - taxOnGain;
  let promote = 0;
  if (irr(inv) > p.fees.hurdle && p.fees.promotePct > 0) {
    let req = equity * Math.pow(1 + p.fees.hurdle, H);
    for (let t = 1; t < H; t++) req -= inv[t] * Math.pow(1 + p.fees.hurdle, H - t);
    promote = p.fees.promotePct * Math.max(0, inv[H] - req);
    inv[H] -= promote;
  }

  // Yen. Hedged: forward points from the rate gap for five years, then a flat cost.
  const f5 = Math.pow((1 + p.yenRate) / (1 + p.dealRate), 5);
  const hedged = (t: number) => (t <= 5 ? Math.pow((1 + p.yenRate) / (1 + p.dealRate), t) : f5 * Math.pow(1 - p.hedgeCostLong, t - 5));
  const exitSpot = p.fxExitSpot * shock.fxExitFactor;
  const spot = (t: number) => p.fxSpot + (exitSpot - p.fxSpot) * t / H;
  const yenH = inv.map((c, t) => c * p.fxSpot * hedged(t));
  const yenMix = inv.map((c, t) => c * (p.hedgeRatio * p.fxSpot * hedged(t) + (1 - p.hedgeRatio) * spot(t)));
  const yenU = inv.map((c, t) => c * spot(t));

  const annual: AnnualRow[] = [];
  for (let t = 1; t <= H; t++) {
    annual.push({
      year: Math.floor(startYear(p.startDate)) + t - 1,
      gross: G[t - 1], groundRent: GR[t - 1], opex: OX[t - 1], noi: NOI[t - 1], capex: CX[t - 1],
      interest: interest[t - 1], amFee, tax: tax[t - 1], distribution: dist[t - 1],
    });
  }
  const icr = debt > 0 ? Math.min(...NOI.slice(0, H).map((x, i) => x / (interest[i] || Infinity))) : null;

  return {
    holdYears: H, annual, equity, debt,
    exit: {
      year: Math.floor(startYear(p.startDate)) + H - 1, forwardNet, exitYield: y, relativity: rel,
      unexpiredYears: unexpired, gross: exitGross, net: exitNet, taxOnGain, promote,
      proceeds: exitNet - debt - taxOnGain - promote,
    },
    deferredPaid,
    irrDeal: irr(lev),
    irrUnlevered: irr(unlev),
    irrNet: irr(inv),
    irrYenHedged: p.hedgeRatio === 1 ? irr(yenH) : irr(yenMix),
    irrYenUnhedged: irr(yenU),
    multipleNet: sum(inv.slice(1)) / equity,
    cashYieldAvg: sum(dist) / H / equity,
    icrMin: icr,
    feesTotal: feeAcq + amFee * H + promote,
    taxTotal: sum(tax) + taxOnGain,
  };
}
