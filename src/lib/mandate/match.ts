// ============================================================================
// Does a deal fit an investor's mandate? Pure: no React, no server imports.
// ----------------------------------------------------------------------------
// Overlap and range checks, one per preference the mandate states. No weights, no score.
//
// Each stated preference is checked on its own and comes back as:
//   pass     the deal satisfies it
//   fail     the deal contradicts it
//   unknown  the deal has no figure to test it with (not yet underwritten, no market set, a
//            different currency). Unknown is NOT a failure: a deal with no yield yet may still be
//            exactly what the investor wants, and the person deciding who to call should be told
//            what is missing rather than have the deal silently dropped.
// A preference the mandate leaves blank is not tested at all.
//
// The verdict:
//   no_mandate  the mandate states nothing (matches no deal; never "everyone")
//   no_fit      at least one check failed
//   possible    nothing failed, but at least one check is unknown
//   fit         every stated preference passed
//
// NOT THE INVESTMENT SCORE: see ./mandate. Deal size is compared with total cost, a
// simplification described there.
// ============================================================================
import { hasCriteria, assetTypeLabel, strategyLabel, type Mandate } from "@/lib/mandate/mandate";

export type Criterion = "market" | "assetType" | "strategy" | "dealSize" | "entryYield";
export type Outcome = "pass" | "fail" | "unknown";
export type Verdict = "fit" | "possible" | "no_fit" | "no_mandate";

export interface CriterionResult {
  criterion: Criterion;
  outcome: Outcome;
  /** One line, safe to show to staff as it stands. */
  reason: string;
}

export interface MandateMatch {
  verdict: Verdict;
  /** Only the criteria the mandate states, in a fixed order. */
  checks: CriterionResult[];
  passed: number;
}

/** The facts about a deal that a mandate is tested against. Any may be missing. */
export interface MandateDeal {
  market: string | null;
  assetType: string | null;
  strategy: string | null;
  currency: string | null;
  /** The deal's total cost, in `currency`. See the note on deal size above. */
  totalCost: number | null;
  /** Entry yield, in percent. */
  entryYieldPct: number | null;
}

const norm = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const isNum = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

function money(n: number, currency: string): string {
  const m = n / 1_000_000;
  const text = `${Number(m.toFixed(m >= 100 ? 0 : 1))}m`;
  return currency === "GBP" ? `£${text}` : `${currency} ${text}`;
}

function listCheck(
  criterion: "market" | "assetType" | "strategy", label: string, wanted: string[],
  dealValue: string | null, show: (v: string) => string,
): CriterionResult | null {
  if (wanted.length === 0) return null;
  const options = wanted.map(show).join(", ");
  if (norm(dealValue) === "") {
    return { criterion, outcome: "unknown", reason: `${label}: not set on the deal (wants ${options})` };
  }
  const hit = wanted.some((w) => norm(w) === norm(dealValue));
  return hit
    ? { criterion, outcome: "pass", reason: `${label}: ${show(dealValue as string)} is one of ${options}` }
    : { criterion, outcome: "fail", reason: `${label}: ${show(dealValue as string)} is not one of ${options}` };
}

export function matchMandate(mandate: Mandate, deal: MandateDeal): MandateMatch {
  if (!hasCriteria(mandate)) return { verdict: "no_mandate", checks: [], passed: 0 };

  const checks: CriterionResult[] = [];
  const add = (c: CriterionResult | null) => { if (c) checks.push(c); };
  const asIs = (v: string) => v;

  add(listCheck("market", "Market", mandate.markets, deal.market, asIs));
  add(listCheck("assetType", "Asset type", mandate.assetTypes, deal.assetType, assetTypeLabel));
  add(listCheck("strategy", "Strategy", mandate.strategies, deal.strategy, strategyLabel));

  const { dealSizeMin: lo, dealSizeMax: hi } = mandate;
  if (lo !== null || hi !== null) {
    const range = lo !== null && hi !== null
      ? `${money(lo, mandate.currency)} to ${money(hi, mandate.currency)}`
      : lo !== null ? `at least ${money(lo, mandate.currency)}` : `up to ${money(hi as number, mandate.currency)}`;
    if (!isNum(deal.totalCost)) {
      checks.push({ criterion: "dealSize", outcome: "unknown", reason: `Deal size: no total cost on the deal yet (wants ${range})` });
    } else if (norm(deal.currency) !== norm(mandate.currency)) {
      // No exchange rate is applied: a converted figure would be a guess.
      checks.push({ criterion: "dealSize", outcome: "unknown",
        reason: `Deal size: the deal is in ${deal.currency ?? "an unknown currency"}, the mandate in ${mandate.currency} (wants ${range})` });
    } else if ((lo !== null && deal.totalCost < lo) || (hi !== null && deal.totalCost > hi)) {
      checks.push({ criterion: "dealSize", outcome: "fail", reason: `Deal size: ${money(deal.totalCost, mandate.currency)} is outside ${range}` });
    } else {
      checks.push({ criterion: "dealSize", outcome: "pass", reason: `Deal size: ${money(deal.totalCost, mandate.currency)} is within ${range}` });
    }
  }

  if (mandate.minEntryYieldPct !== null) {
    const need = mandate.minEntryYieldPct;
    if (!isNum(deal.entryYieldPct)) {
      checks.push({ criterion: "entryYield", outcome: "unknown", reason: `Entry yield: not yet underwritten (wants ${need}% or more)` });
    } else if (deal.entryYieldPct >= need) {
      checks.push({ criterion: "entryYield", outcome: "pass", reason: `Entry yield: ${deal.entryYieldPct}% meets ${need}% or more` });
    } else {
      checks.push({ criterion: "entryYield", outcome: "fail", reason: `Entry yield: ${deal.entryYieldPct}% is below ${need}%` });
    }
  }

  const passed = checks.filter((c) => c.outcome === "pass").length;
  const verdict: Verdict = checks.some((c) => c.outcome === "fail") ? "no_fit"
    : checks.some((c) => c.outcome === "unknown") ? "possible" : "fit";
  return { verdict, checks, passed };
}

// ---- Ranking ----------------------------------------------------------------
export interface Ranked<T> { item: T; match: MandateMatch }

function rank<T>(entries: Ranked<T>[], name: (t: T) => string): Ranked<T>[] {
  // Fit before possible, then more checks passed, then by name: the same input always gives the same order.
  return entries
    .filter((e) => e.match.verdict === "fit" || e.match.verdict === "possible")
    .sort((a, b) =>
      (a.match.verdict === "fit" ? 0 : 1) - (b.match.verdict === "fit" ? 0 : 1) ||
      b.match.passed - a.match.passed ||
      name(a.item).localeCompare(name(b.item)));
}

/** The investors worth a call about one deal. Only `fit` and `possible`, best first. */
export function rankInvestorsForDeal<T extends { name: string; mandate: Mandate }>(
  deal: MandateDeal, investors: T[],
): Ranked<T>[] {
  return rank(investors.map((item) => ({ item, match: matchMandate(item.mandate, deal) })), (t) => t.name);
}

/** The deals that suit one investor. Only `fit` and `possible`, best first. */
export function rankDealsForInvestor<T extends MandateDeal & { name: string }>(
  mandate: Mandate, deals: T[],
): Ranked<T>[] {
  return rank(deals.map((item) => ({ item, match: matchMandate(mandate, item) })), (t) => t.name);
}
