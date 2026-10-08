// ============================================================================
// An investor organisation's mandate: what it says it is looking for. Pure: no React, no
// server imports, safe in a client component and testable without a database.
// ----------------------------------------------------------------------------
// Rule-based and deliberately plain. A mandate is a handful of preferences; matching a deal to
// it is overlap and range checks (see ./match), not a weighted score.
//
// NOT THE INVESTMENT SCORE. src/lib/scoring is Reiwa's own assessment of how good a deal is.
// A mandate asks a different question - does this deal fit what THIS investor wants - so a deal
// can score well and fit nobody, or score modestly and be exactly what one investor is after.
// Nothing in this folder imports from, or shares a vocabulary with, the scoring module
// (tests/unit/investor-mandates.test.ts holds that).
//
// DEAL SIZE IS A SIMPLIFICATION. The size range is compared with a deal's TOTAL COST. An
// investor's real ticket is its equity cheque, which depends on leverage and any co-investment,
// and no equity-required figure exists on a deal yet. So `dealSizeMin` / `dealSizeMax` mean "the
// size of deal they will look at", and must not be mistaken for a finished definition of ticket
// size. When an equity-required figure exists, that is the number to compare instead.
// ============================================================================
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";

export type MandateCurrency = "GBP" | "EUR" | "USD" | "JPY";
export const MANDATE_CURRENCIES: readonly MandateCurrency[] = ["GBP", "EUR", "USD", "JPY"];

export interface Mandate {
  /** Empty = no preference on that dimension: it is not tested. */
  markets: string[];
  assetTypes: string[];
  strategies: string[];
  /** In the mandate's currency, whole units (not millions). Inclusive at both ends. */
  dealSizeMin: number | null;
  dealSizeMax: number | null;
  currency: MandateCurrency;
  /** Percent. A deal needs at least this entry yield. */
  minEntryYieldPct: number | null;
}

export const EMPTY_MANDATE: Mandate = {
  markets: [], assetTypes: [], strategies: [], dealSizeMin: null, dealSizeMax: null,
  currency: "GBP", minEntryYieldPct: null,
};

/** The vocabularies a mandate may use. Asset types and strategies are the ones deals use. */
export const ASSET_TYPE_OPTIONS: readonly string[] = Object.keys(ASSET_TYPE_LABEL);
export const STRATEGY_OPTIONS: readonly string[] = Object.keys(STRATEGY_LABEL);
/** Suggestions only: a market is free text on a deal, so a mandate may name any. */
export const MARKET_SUGGESTIONS: readonly string[] = [
  "London", "Amsterdam", "Paris", "Berlin", "Frankfurt", "Madrid", "Milan", "Dublin",
];

export const MAX_LIST = 12;
const MAX_LABEL = 80;

export const assetTypeLabel = (v: string): string => (ASSET_TYPE_LABEL as Record<string, string>)[v] ?? v;
export const strategyLabel = (v: string): string => (STRATEGY_LABEL as Record<string, string>)[v] ?? v;

/** True when the mandate states at least one preference. A mandate that states none matches nothing. */
export function hasCriteria(m: Mandate): boolean {
  return m.markets.length > 0 || m.assetTypes.length > 0 || m.strategies.length > 0 ||
    m.dealSizeMin !== null || m.dealSizeMax !== null || m.minEntryYieldPct !== null;
}

// ---- The editor's input, and its validation --------------------------------
/** What the editor holds: sizes in MILLIONS and yield as text, exactly as typed. */
export interface MandateInput {
  markets: string[];
  assetTypes: string[];
  strategies: string[];
  dealSizeMinM: string;
  dealSizeMaxM: string;
  currency: string;
  minEntryYieldPct: string;
}

export type ParsedMandate = { ok: true; mandate: Mandate } | { ok: false; error: string };

const MONEY = /^\d{1,6}(\.\d{1,4})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

function cleanList(raw: unknown, what: string, allowed?: readonly string[]): { ok: true; list: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, list: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `${what} must be a list.` };
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return { ok: false, error: `${what} must be a list of names.` };
    const v = item.replace(/[\u0000-\u001f]/g, " ").trim().replace(/\s+/g, " ");
    if (!v) continue;
    if (v.length > MAX_LABEL) return { ok: false, error: `A ${what.toLowerCase()} entry is too long.` };
    const key = v.toLowerCase();
    if (allowed && !allowed.includes(v)) return { ok: false, error: `"${v}" is not a recognised ${what.toLowerCase()} option.` };
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(v);
  }
  if (list.length > MAX_LIST) return { ok: false, error: `Choose at most ${MAX_LIST} ${what.toLowerCase()} options.` };
  return { ok: true, list: list.sort((a, b) => a.localeCompare(b)) };
}

function millions(raw: unknown, what: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = typeof raw === "string" ? raw.trim() : raw === null || raw === undefined ? "" : String(raw).trim();
  if (t === "") return { ok: true, value: null };
  if (!MONEY.test(t)) return { ok: false, error: `${what} must be a number of millions, for example 12.5.` };
  return { ok: true, value: Math.round(Number(t) * 1_000_000) };
}

/** Validate and normalise what the editor sent. Errors are written for the person reading them. */
export function parseMandateInput(raw: Partial<MandateInput> | null | undefined): ParsedMandate {
  const r = raw ?? {};
  const markets = cleanList(r.markets, "Markets");
  if (!markets.ok) return markets;
  const assetTypes = cleanList(r.assetTypes, "Asset types", ASSET_TYPE_OPTIONS);
  if (!assetTypes.ok) return assetTypes;
  const strategies = cleanList(r.strategies, "Strategies", STRATEGY_OPTIONS);
  if (!strategies.ok) return strategies;

  const min = millions(r.dealSizeMinM, "Minimum deal size");
  if (!min.ok) return min;
  const max = millions(r.dealSizeMaxM, "Maximum deal size");
  if (!max.ok) return max;
  if (min.value !== null && max.value !== null && min.value > max.value) {
    return { ok: false, error: "The minimum deal size is above the maximum." };
  }

  const currency = typeof r.currency === "string" && r.currency !== "" ? r.currency : "GBP";
  if (!(MANDATE_CURRENCIES as readonly string[]).includes(currency)) {
    return { ok: false, error: "Choose a currency from the list." };
  }

  const yieldText = typeof r.minEntryYieldPct === "string" ? r.minEntryYieldPct.trim() : "";
  let minEntryYieldPct: number | null = null;
  if (yieldText !== "") {
    if (!PERCENT.test(yieldText) || Number(yieldText) > 100) {
      return { ok: false, error: "The minimum entry yield must be a percentage between 0 and 100, for example 6.5." };
    }
    minEntryYieldPct = Number(yieldText);
  }

  return {
    ok: true,
    mandate: {
      markets: markets.list, assetTypes: assetTypes.list, strategies: strategies.list,
      dealSizeMin: min.value, dealSizeMax: max.value, currency: currency as MandateCurrency,
      minEntryYieldPct,
    },
  };
}

/** The editor's starting values for a stored mandate. */
export function toMandateInput(m: Mandate): MandateInput {
  const inMillions = (n: number | null) => (n === null ? "" : String(Number((n / 1_000_000).toFixed(4))));
  return {
    markets: [...m.markets], assetTypes: [...m.assetTypes], strategies: [...m.strategies],
    dealSizeMinM: inMillions(m.dealSizeMin), dealSizeMaxM: inMillions(m.dealSizeMax),
    currency: m.currency, minEntryYieldPct: m.minEntryYieldPct === null ? "" : String(m.minEntryYieldPct),
  };
}
