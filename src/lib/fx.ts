// ============================================================================
// FX rates: what a rate is, when it has gone stale, and what may be saved.
// ----------------------------------------------------------------------------
// Pure. A rate is either the ECB's daily reference rate (written by the sync in
// data/fx-sync.ts) or whatever an administrator typed, with the source they named
// and the date it was good for; until the first sync the table holds the seeded
// "Demo static rates", which are neither. The honest thing the product can do is
// say how old a rate is, and never present a placeholder as a market rate. A rate older than
// FX_STALE_AFTER_DAYS is FLAGGED wherever it is shown or composed ("this rate is
// 41 days old"); it is never a hard block, because a month-old rate is still
// better than no valuation and the person reading can judge that, provided they
// are told.
//
// "Today" is always an argument. Nothing here reads a clock, so the same rate
// and the same date give the same sentence in a test, a memo and a page.
// ============================================================================

/** The four currencies the portfolio and the memos are valued in. */
export const FX_CURRENCIES = ["GBP", "EUR", "USD", "JPY"] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

/** Every rate is to this currency. GBP to GBP is 1 by definition, so it cannot be stale. */
export const FX_BASE_CURRENCY: FxCurrency = "GBP";

export const FX_STALE_AFTER_DAYS = 30;
export const FX_SOURCE_MAX_CHARS = 200;
const RATE_MAX = 999_999; // numeric(12,6): six integer digits

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of an ISO date, or null when it is not a real calendar date. */
function dayStart(iso: string): number | null {
  const m = ISO_DATE.exec(iso.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  // Rejects 2026-02-31, which Date.UTC would quietly roll into March.
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? t : null;
}

export function isIsoDate(value: string): boolean {
  return dayStart(value) !== null;
}

/** Whole days from `asOf` to `today`; null when either is not a real date. Never negative. */
export function fxAgeDays(asOf: string, today: string): number | null {
  const a = dayStart(asOf);
  const t = dayStart(today);
  if (a === null || t === null) return null;
  return Math.max(0, Math.round((t - a) / DAY_MS));
}

export interface FxStaleness {
  ageDays: number;
  stale: boolean;
  /** "This rate is 41 days old." when stale, otherwise null. */
  note: string | null;
}

/**
 * How old a rate is and whether to say so. An `asOf` that is not a date cannot
 * be aged, so it returns null and the caller must not claim the rate is fresh.
 */
export function fxStaleness(asOf: string, today: string): FxStaleness | null {
  const ageDays = fxAgeDays(asOf, today);
  if (ageDays === null) return null;
  const stale = ageDays > FX_STALE_AFTER_DAYS;
  return { ageDays, stale, note: stale ? `This rate is ${ageDays} days old.` : null };
}

/** The staleness line for a set of dates: the oldest one governs. */
export function oldestStaleness(dates: readonly string[], today: string): FxStaleness | null {
  let worst: FxStaleness | null = null;
  for (const d of dates) {
    const s = fxStaleness(d, today);
    if (s && (worst === null || s.ageDays > worst.ageDays)) worst = s;
  }
  return worst;
}

/** The same flag for a valuation that uses several rates, where the oldest governs. */
export function fxSetNote(staleness: FxStaleness | null): string | null {
  return staleness?.stale
    ? `The oldest rate used is ${staleness.ageDays} days old (rates over ${FX_STALE_AFTER_DAYS} days are flagged), so these values may not reflect current exchange rates.`
    : null;
}

// ---- Converting an amount ---------------------------------------------------

/**
 * An amount in one currency expressed in another, through GBP. `rateToGbp` is GBP
 * per 1 unit of the currency, as fx_rates holds it, so:
 *
 *   amount (in FROM) x rate(FROM)  = GBP        GBP / rate(TO)  = amount (in TO)
 *
 * The base currency's rate is 1 by definition and needs no row. Null when either
 * rate is missing or not a positive number: a rate that cannot be read is never
 * assumed.
 */
export function convertViaGbp(amount: number | null | undefined, fromRateToGbp: number | null | undefined, toRateToGbp: number | null | undefined): number | null {
  const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (typeof amount !== "number" || !Number.isFinite(amount) || !ok(fromRateToGbp) || !ok(toRateToGbp)) return null;
  return (amount * fromRateToGbp) / toRateToGbp;
}

// ---- Saving a rate ----------------------------------------------------------

export interface FxRateInput { currency: FxCurrency; rate: number; source: string; asOf: string }

/** A source that is a placeholder, not a source. */
const PLACEHOLDER_SOURCE = /\b(demo|static|placeholder|tbc|tbd|n\/?a|unknown)\b/i;

/**
 * True when a rate's source says it is a stand-in (the seeded "Demo static rates") or says
 * nothing. Such a rate may be used inside the building with a warning; it must never reach an
 * investor, because a number that looks live but is not is worse than no number.
 */
export function isPlaceholderFxSource(source: string | null | undefined): boolean {
  const s = (source ?? "").trim();
  return s === "" || PLACEHOLDER_SOURCE.test(s);
}

const SOURCE_PROMPT = "Name where this rate came from, for example 'ECB euro reference rate' or 'Bloomberg close'.";

/**
 * Validate one rate submission. Returns the cleaned input or a sentence for the
 * person. The source is REQUIRED on every update: a rate nobody can trace is the
 * thing this card exists to stop. The seeded "Demo static rates" label is
 * rejected for the same reason, since keeping it would relabel a typed number as
 * a demonstration value or, worse, leave a real one looking like one.
 */
export function validateRateSubmission(
  raw: { currency?: unknown; rate?: unknown; source?: unknown; asOf?: unknown },
  today: string,
): { ok: true; value: FxRateInput } | { ok: false; error: string } {
  const currency = String(raw.currency ?? "").trim().toUpperCase();
  if (!(FX_CURRENCIES as readonly string[]).includes(currency)) {
    return { ok: false, error: `Rates are kept for ${FX_CURRENCIES.join(", ")} only.` };
  }

  const rateText = String(raw.rate ?? "").trim();
  const rate = rateText === "" ? NaN : Number(rateText);
  if (!Number.isFinite(rate) || rate <= 0) return { ok: false, error: `${currency}: the rate must be a number above zero.` };
  if (rate > RATE_MAX) return { ok: false, error: `${currency}: that rate is too large to be right.` };
  if (currency === "GBP" && rate !== 1) return { ok: false, error: "GBP to GBP is 1 by definition." };
  const decimals = (rateText.split(".")[1] ?? "").length;
  if (decimals > 6) return { ok: false, error: `${currency}: at most six decimal places.` };

  const source = String(raw.source ?? "").trim();
  if (source === "") return { ok: false, error: `${currency}: a source is required. ${SOURCE_PROMPT}` };
  if (source.length > FX_SOURCE_MAX_CHARS) return { ok: false, error: `${currency}: keep the source under ${FX_SOURCE_MAX_CHARS} characters.` };
  if (PLACEHOLDER_SOURCE.test(source)) return { ok: false, error: `${currency}: "${source}" is a placeholder, not a source. ${SOURCE_PROMPT}` };

  const asOf = String(raw.asOf ?? "").trim();
  if (!isIsoDate(asOf)) return { ok: false, error: `${currency}: enter the date the rate is good for.` };
  const age = fxAgeDays(asOf, today);
  if (age === null || asOf > today) return { ok: false, error: `${currency}: the date cannot be in the future.` };

  return { ok: true, value: { currency: currency as FxCurrency, rate, source, asOf } };
}
