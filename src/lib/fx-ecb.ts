// ============================================================================
// ECB euro foreign exchange reference rates: parsing and conversion. Pure.
// ----------------------------------------------------------------------------
// The feed is EUR-based: "1 EUR = N <currency>". fx_rates.rate_to_gbp is
// GBP-based: GBP per 1 unit of the currency. So:
//
//   rate_to_gbp(EUR) = N(GBP)                 the feed's own EUR->GBP value
//   rate_to_gbp(X)   = N(GBP) / N(X)          for USD and JPY
//   rate_to_gbp(GBP) = 1                      by definition, never derived
//
// The date is the one INSIDE the file, never today's: the ECB publishes once per
// business day, and at a weekend or a bank holiday the same file simply persists.
// Stamping it with the run date would make a three-day-old rate look fresh.
//
// Nothing here fetches or writes. A feed that does not parse, or that is missing a
// currency, throws EcbFeedError and the caller writes NOTHING: a partial or
// guessed set of rates is worse than a stale one, because staleness is flagged
// (src/lib/fx.ts) and a wrong number is not.
// ============================================================================
import { isIsoDate } from "@/lib/fx";

export const ECB_FEED_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** The source written on every automatic update. The settings card and the sync both key on it. */
export const ECB_AUTO_SOURCE = "ECB reference rate (auto)";

/** The currencies fx_rates keeps that the feed must supply. */
export const ECB_REQUIRED = ["GBP", "USD", "JPY"] as const;

export class EcbFeedError extends Error {
  constructor(message: string) { super(message); this.name = "EcbFeedError"; }
}

export interface EcbFeed {
  /** The ECB's own publication date, ISO. */
  date: string;
  /** Units of each currency per 1 EUR. */
  perEur: Record<string, number>;
}

/**
 * Read the daily XML. Deliberately strict and regex-based: the document is tiny
 * and fixed-shape, and a parser dependency would be more surface than it removes.
 * Anything off-shape is an error, not a best guess.
 */
export function parseEcbXml(xml: string): EcbFeed {
  if (typeof xml !== "string" || xml.length === 0) throw new EcbFeedError("The feed was empty.");
  if (xml.length > 200_000) throw new EcbFeedError("The feed was far larger than the ECB's daily file.");

  const days = [...xml.matchAll(/<Cube\s+time\s*=\s*['"]([^'"]+)['"]\s*>/g)].map((m) => m[1]);
  if (days.length !== 1) throw new EcbFeedError(`Expected exactly one dated block in the feed, found ${days.length}.`);
  const date = days[0];
  if (!isIsoDate(date)) throw new EcbFeedError(`The feed's date "${date}" is not a calendar date.`);

  const perEur: Record<string, number> = {};
  for (const m of xml.matchAll(/<Cube\s+currency\s*=\s*['"]([A-Z]{3})['"]\s+rate\s*=\s*['"]([^'"]+)['"]\s*\/?>/g)) {
    const rate = Number(m[2]);
    if (!Number.isFinite(rate) || rate <= 0) throw new EcbFeedError(`The feed's ${m[1]} rate "${m[2]}" is not a positive number.`);
    if (m[1] in perEur) throw new EcbFeedError(`The feed lists ${m[1]} twice.`);
    perEur[m[1]] = rate;
  }
  const missing = ECB_REQUIRED.filter((c) => !(c in perEur));
  if (missing.length > 0) throw new EcbFeedError(`The feed has no ${missing.join(", ")} rate.`);
  return { date, perEur };
}

export interface CrossRate { currency: "GBP" | "EUR" | "USD" | "JPY"; rateToGbp: string; asOf: string }

/** Six decimal places: the column is numeric(12,6), and fx.ts refuses more. */
const six = (n: number): string => n.toFixed(6);

/**
 * GBP-based rates for the four currencies the product keeps, as six-decimal
 * strings (so nothing downstream sees a float's trailing noise). Throws rather
 * than return a rate that would round to zero.
 */
export function crossRatesToGbp(feed: EcbFeed): CrossRate[] {
  const eurToGbp = feed.perEur.GBP;
  const out: CrossRate[] = [
    { currency: "GBP", rateToGbp: six(1), asOf: feed.date },
    { currency: "EUR", rateToGbp: six(eurToGbp), asOf: feed.date },
    { currency: "USD", rateToGbp: six(eurToGbp / feed.perEur.USD), asOf: feed.date },
    { currency: "JPY", rateToGbp: six(eurToGbp / feed.perEur.JPY), asOf: feed.date },
  ];
  for (const r of out) {
    if (!(Number(r.rateToGbp) > 0)) throw new EcbFeedError(`The ${r.currency} rate rounds to zero at six decimal places.`);
  }
  return out;
}
