// ============================================================================
// Value parsing - broker text to typed values.
// ----------------------------------------------------------------------------
// Every parser returns a ParseResult rather than a bare value, because the
// interesting cases are the ambiguous ones. A parser that cannot be confident
// says so; it never guesses, and it never returns a number it had to invent.
//
// Pure module: no server imports, no I/O. Fully unit tested.
// ============================================================================

export interface ParseResult<T> {
  value: T | null;
  /** 0-1. null when the value came from a human rather than a heuristic. */
  confidence: number | null;
  /** Machine-readable reasons a reviewer should look at this value. */
  notes: string[];
  /** The literal source text the value was read from. */
  excerpt: string;
}

const ok = <T,>(value: T, excerpt: string, confidence = 1, notes: string[] = []): ParseResult<T> =>
  ({ value, confidence, notes, excerpt });
const nil = <T,>(excerpt: string, notes: string[] = []): ParseResult<T> =>
  ({ value: null, confidence: null, notes, excerpt });

const clean = (raw: unknown): string =>
  raw === null || raw === undefined ? "" : String(raw).replace(/ /g, " ").trim();

/** Values brokers use to mean "not stated". Treated as absent, never as zero. */
const BLANKS = new Set([
  "", "-", "--", "—", "–", "n/a", "na", "n.a.", "nil", "none", "tbc", "tba",
  "t.b.c.", "unknown", "not stated", "not disclosed", "undisclosed", "confidential",
  "on application", "poa", "price on application", "ask", "refer to agent", "?",
]);

export function isBlank(raw: unknown): boolean {
  return BLANKS.has(clean(raw).toLowerCase());
}

// ---- Currency --------------------------------------------------------------
export type CurrencyCode = "GBP" | "EUR" | "USD" | "JPY";

const SYMBOL_CURRENCY: Record<string, CurrencyCode> = {
  "£": "GBP", "€": "EUR", "$": "USD", "¥": "JPY",
};

const CODE_PATTERN = /\b(GBP|EUR|USD|JPY)\b/i;

/** The currency a piece of text names explicitly, or null. Never assumed. */
export function detectCurrency(raw: unknown): CurrencyCode | null {
  const text = clean(raw);
  for (const [symbol, code] of Object.entries(SYMBOL_CURRENCY)) {
    if (text.includes(symbol)) return code;
  }
  const m = text.match(CODE_PATTERN);
  return m ? (m[1].toUpperCase() as CurrencyCode) : null;
}

/** Hedging language brokers put in front of a figure. */
const APPROXIMATE =
  /\b(?:circa|approx(?:imately)?|around|in excess of|excess of|offers over|offers in the region of|region of)\b|\bc\.|\bca\./i;

// ---- Money -----------------------------------------------------------------
const MULTIPLIERS: [RegExp, number][] = [
  [/\bbn\b|\bbillion\b/i, 1_000_000_000],
  [/\bm\b|\bmn\b|\bmillion\b/i, 1_000_000],
  [/\bk\b|\bthousand\b/i, 1_000],
];

/**
 * Parse a broker money string. Handles "£12,500,000", "12.5m", "c. £8.0m",
 * "EUR 3.4 million", "offers over £2,750,000".
 *
 * Returns the currency only when the text names one - the caller supplies the
 * batch default rather than this function assuming GBP.
 */
export function parseMoney(raw: unknown): ParseResult<number> & { currency: CurrencyCode | null } {
  const excerpt = clean(raw);
  const base = { currency: detectCurrency(excerpt) };
  if (isBlank(excerpt)) return { ...nil<number>(excerpt), ...base };

  const notes: string[] = [];
  let confidence = 1;

  // Trailing \b would not match after "c." - "." is not a word character - so the
  // abbreviated forms are anchored on their own.
  if (APPROXIMATE.test(excerpt)) {
    notes.push("approximate_value");
    confidence = 0.85;
  }
  if (/\b(per|\/)\s*(sq|sf|ft|m2|sqm|sqft)/i.test(excerpt)) {
    notes.push("looks_like_unit_rate");
    confidence = Math.min(confidence, 0.4);
  }

  // Strip currency markers and words, keep digits, separators and the multiplier.
  const numeric = excerpt
    .replace(/[£€$¥]/g, " ")
    .replace(CODE_PATTERN, " ")
    .replace(/\b(circa|c\.|approx\.?|approximately|around|in excess of|excess of|offers over|offers in the region of|from|guide|asking|quoting|price|p\.a\.?|pa)\b/gi, " ")
    .trim();

  const match = numeric.match(/(-?\d[\d,.  ]*)/);
  if (!match) return { ...nil<number>(excerpt, [...notes, "no_number_found"]), ...base };

  const digits = normaliseDecimal(match[1]);
  if (digits === null) {
    return { ...nil<number>(excerpt, [...notes, "ambiguous_separators"]), ...base };
  }

  let value = digits;
  const tail = numeric.slice(match.index! + match[1].length);
  for (const [pattern, factor] of MULTIPLIERS) {
    if (pattern.test(tail)) { value *= factor; break; }
  }

  if (value < 0) notes.push("negative_value");
  return { ...ok(value, excerpt, confidence, notes), ...base };
}

/**
 * Resolve "1,234.56" / "1.234,56" / "1 234" to a number.
 * Returns null when the separators are genuinely ambiguous rather than picking
 * a convention and corrupting the figure.
 */
export function normaliseDecimal(input: string): number | null {
  const s = input.replace(/[\s ]/g, "");
  if (!/^-?[\d,.]+$/.test(s) || !/\d/.test(s)) return null;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  // A number carries at most ONE decimal separator, so a repeated separator can
  // only be grouping. That single fact resolves most of the UK/European
  // ambiguity without having to guess a locale.
  const strip = (value: string, char: string) => value.split(char).join("");
  const decimalise = (value: string, char: string) =>
    strip(value, char === "." ? "," : ".").replace(char, ".");

  let normalised: string;
  if (dots > 1 && commas > 1) {
    return null;                                   // malformed
  } else if (dots > 1) {
    // "85.000.000" or "1.234.567,89" - dots group, a lone comma is decimal.
    normalised = commas === 1 ? decimalise(s, ",") : strip(s, ".");
  } else if (commas > 1) {
    // "12,500,000" or "12,500,000.75" - commas group, a lone dot is decimal.
    normalised = dots === 1 ? decimalise(s, ".") : strip(s, ",");
  } else if (dots === 1 && commas === 1) {
    // Whichever comes last is the decimal separator.
    normalised = s.lastIndexOf(",") > s.lastIndexOf(".") ? decimalise(s, ",") : decimalise(s, ".");
  } else if (dots === 1) {
    // "1.234" is either 1234 (European grouping) or 1.234 (UK decimal), with
    // nothing to tell them apart. Refuse rather than corrupt the figure.
    if (/^-?\d{1,3}\.\d{3}$/.test(s)) return null;
    normalised = s;
  } else if (commas === 1) {
    // "1,234" at exactly three trailing digits is UK grouping; "4,12" is a
    // European decimal.
    normalised = /^-?\d{1,3},\d{3}$/.test(s) ? strip(s, ",") : s.replace(",", ".");
  } else {
    normalised = s;
  }

  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

// ---- Percent ---------------------------------------------------------------
/**
 * Parse a yield or occupancy. The database stores percentages as percent
 * numbers (4.2 means 4.2%), matching formatPct and the seeded data.
 *
 * A bare decimal at or below 1 with no "%" is ambiguous - 0.045 is almost
 * certainly 4.5%, but saying so is a guess. The value is returned as written
 * and flagged, so the reviewer decides rather than the parser.
 */
export function parsePercent(raw: unknown): ParseResult<number> {
  const excerpt = clean(raw);
  if (isBlank(excerpt)) return nil(excerpt);

  const hasSign = excerpt.includes("%");
  const notes: string[] = [];
  let confidence = hasSign ? 1 : 0.8;

  if (APPROXIMATE.test(excerpt)) {
    notes.push("approximate_value");
    confidence = Math.min(confidence, 0.85);
  }

  const match = excerpt.replace(/%/g, " ").match(/(-?\d[\d,. ]*)/);
  if (!match) return nil(excerpt, [...notes, "no_number_found"]);

  const value = normaliseDecimal(match[1]);
  if (value === null) return nil(excerpt, [...notes, "ambiguous_separators"]);

  if (!hasSign && value > 0 && value <= 1) {
    notes.push("possible_fraction_not_percent");
    confidence = 0.3;
  }
  if (value > 100) {
    notes.push("above_100_percent");
    confidence = Math.min(confidence, 0.4);
  }

  return ok(value, excerpt, confidence, notes);
}

// ---- Area ------------------------------------------------------------------
export type AreaUnit = "sqft" | "sqm";

// No trailing \b after the superscript forms: "²" is not a word character, so
// /m²\b/ never matches and the stray "m" is then read as a million multiplier.
const SQFT = /(?:\bsq\.?\s*ft\b|\bsqft\b|\bsf\b|\bsquare\s+feet\b|\bft2\b|ft²)/i;
const SQM = /(?:\bsq\.?\s*m\b|\bsqm\b|\bsquare\s+met(?:re|er)s?\b|\bm2\b|m²)/i;

/** The unit a piece of text names, or null. Never assumed from magnitude. */
export function detectAreaUnit(raw: unknown): AreaUnit | null {
  const text = clean(raw);
  if (SQFT.test(text)) return "sqft";
  if (SQM.test(text)) return "sqm";
  return null;
}

export function parseArea(raw: unknown): ParseResult<number> & { unit: AreaUnit | null } {
  const excerpt = clean(raw);
  const unit = detectAreaUnit(excerpt);
  if (isBlank(excerpt)) return { ...nil<number>(excerpt), unit };

  const notes: string[] = [];
  let confidence = unit ? 1 : 0.7;
  if (!unit) notes.push("unit_not_stated");

  const numeric = excerpt.replace(SQFT, " ").replace(SQM, " ");
  const match = numeric.match(/(-?\d[\d,. ]*)/);
  if (!match) return { ...nil<number>(excerpt, [...notes, "no_number_found"]), unit };

  let value = normaliseDecimal(match[1]);
  if (value === null) return { ...nil<number>(excerpt, [...notes, "ambiguous_separators"]), unit };

  const tail = numeric.slice(match.index! + match[1].length);
  if (/\bm\b|\bmillion\b/i.test(tail)) value *= 1_000_000;
  else if (/\bk\b/i.test(tail)) value *= 1_000;

  return { ...ok(value, excerpt, confidence, notes), unit };
}

export const SQFT_PER_SQM = 10.7639;

// ---- Dates -----------------------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const iso = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Parse a date to an ISO 'YYYY-MM-DD' string.
 *
 * Day-first is assumed for all-numeric dates, because the source material is UK
 * and European. Where the value is genuinely ambiguous (both parts <= 12) that
 * assumption is flagged, so "03/04/2026" is never silently read as 3 April by a
 * reviewer who meant 4 March.
 */
export function parseDate(raw: unknown): ParseResult<string> {
  const excerpt = clean(raw);
  if (isBlank(excerpt)) return nil(excerpt);

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return ok(iso(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()), excerpt);
  }

  // ISO first - unambiguous.
  const isoMatch = excerpt.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch.map(Number) as unknown as [string, number, number, number];
    return validDate(y, m, d) ? ok(iso(y, m, d), excerpt) : nil(excerpt, ["invalid_date"]);
  }

  // "16 Sep 2026" / "Sep 16 2026" / "September 2026"
  const named = excerpt.match(
    /\b(?:(\d{1,2})\s+)?([A-Za-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})\b/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 4).toLowerCase()] ?? MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) {
      const year = Number(named[4]);
      const day = Number(named[1] ?? named[3] ?? 1);
      if (validDate(year, month, day)) {
        const dayStated = named[1] !== undefined || named[3] !== undefined;
        return ok(iso(year, month, day), excerpt, dayStated ? 1 : 0.6,
          dayStated ? [] : ["day_not_stated_assumed_first"]);
      }
    }
  }

  // Numeric, day-first.
  const numeric = excerpt.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;

    if (a > 12 && validDate(year, b, a)) return ok(iso(year, b, a), excerpt);
    if (b > 12 && validDate(year, a, b)) {
      return ok(iso(year, a, b), excerpt, 0.9, ["month_first_inferred"]);
    }
    if (validDate(year, b, a)) {
      return ok(iso(year, b, a), excerpt, 0.6, ["day_month_ambiguous_assumed_day_first"]);
    }
  }

  return nil(excerpt, ["unrecognised_date_format"]);
}

// ---- Text ------------------------------------------------------------------
export function parseText(raw: unknown): ParseResult<string> {
  const excerpt = clean(raw);
  if (isBlank(excerpt)) return nil(excerpt);
  return ok(excerpt.replace(/\s+/g, " "), excerpt);
}

export function parseMultiline(raw: unknown): ParseResult<string> {
  const excerpt = clean(raw);
  if (isBlank(excerpt)) return nil(excerpt);
  return ok(excerpt.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n"), excerpt);
}
