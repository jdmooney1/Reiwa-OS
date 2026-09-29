// ============================================================================
// Which currency a market normally trades in.
// ----------------------------------------------------------------------------
// Nothing tied an opportunity's currency to its market: a Tokyo asset was saved
// as GBP, an Amsterdam deal as GBP after a test. Currency is a free text column
// with no check, so the rule has to live where the value is written.
//
// The markets are the ones the New Opportunity form offers; the currencies are
// the ones fx_rates carries (GBP, EUR, USD, JPY). Tokyo / Japan are here because
// fx_rates already holds a JPY rate and the diligence templates already reason
// about GBP/JPY and EUR/JPY exposure.
//
// A market that is not listed, or "Other", has NO expected currency: the check
// stays silent rather than guessing. It is a guard against a slip, not a
// restriction - a deliberate mismatch is allowed once it is confirmed.
// ============================================================================
import type { Currency } from "@/types/database";

const BY_MARKET: Record<string, Currency> = {
  london: "GBP",
  amsterdam: "EUR", paris: "EUR", berlin: "EUR", frankfurt: "EUR",
  madrid: "EUR", milan: "EUR", dublin: "EUR",
  tokyo: "JPY",
};

const BY_COUNTRY: Record<string, Currency> = {
  "united kingdom": "GBP", uk: "GBP", england: "GBP",
  netherlands: "EUR", france: "EUR", germany: "EUR", spain: "EUR", italy: "EUR", ireland: "EUR",
  japan: "JPY",
};

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** The currency this market normally trades in, or null when unknown. */
export function expectedCurrency(
  market: string | null | undefined, country?: string | null,
): Currency | null {
  return BY_MARKET[norm(market)] ?? BY_COUNTRY[norm(country)] ?? null;
}

/** null when the currency is fine or cannot be judged; otherwise a sentence to show. */
export function currencyMismatch(
  currency: string, market: string | null | undefined, country?: string | null,
): string | null {
  const expected = expectedCurrency(market, country);
  if (!expected || expected === currency) return null;
  const where = norm(market) ? market!.trim() : country!.trim();
  return `${where} deals are normally ${expected}, but this one is set to ${currency}.`;
}
