import type { Currency } from "@/types/database";

const CURRENCY_SYMBOL: Record<Currency, string> = {
  GBP: "£",
  EUR: "€",
  USD: "$",
  JPY: "¥",
};

/** Compact money, e.g. £42.5m / €85.0m — for cards and headers. */
export function formatMoneyCompact(
  value: number | null | undefined,
  currency: Currency = "GBP",
): string {
  if (value == null) return "—";
  const sym = CURRENCY_SYMBOL[currency];
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sym}${(value / 1_000_000_000).toFixed(1)}bn`;
  if (abs >= 1_000_000) return `${sym}${(value / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sym}${(value / 1_000).toFixed(0)}k`;
  return `${sym}${value.toLocaleString("en-GB")}`;
}

/**
 * Money as a document headline reads it: £12.5M, ¥1.20B, €850K. Billions are
 * always two decimals; millions take two below 10M and one above, so a rent of
 * 1.25M is not rounded to 1.3M and a price of 42.5M is not padded to 42.50M.
 */
export function formatMoneyUnits(
  value: number | null | undefined,
  currency: Currency = "GBP",
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sym = CURRENCY_SYMBOL[currency];
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sym}${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sym}${(value / 1_000_000).toFixed(abs < 10_000_000 ? 2 : 1)}M`;
  if (abs >= 1_000) return `${sym}${(value / 1_000).toFixed(0)}K`;
  return `${sym}${Math.round(value).toLocaleString("en-GB")}`;
}

/** Full money with thousands separators, e.g. £42,500,000. */
export function formatMoney(
  value: number | null | undefined,
  currency: Currency = "GBP",
  opts: { decimals?: number } = {},
): string {
  if (value == null) return "—";
  const sym = CURRENCY_SYMBOL[currency];
  return `${sym}${value.toLocaleString("en-GB", {
    minimumFractionDigits: opts.decimals ?? 0,
    maximumFractionDigits: opts.decimals ?? 0,
  })}`;
}

const FIXED = new Map<number, Intl.NumberFormat>();
/**
 * A number to a fixed count of decimals, rounding halves UP as a person reads them.
 *
 * `Number.prototype.toFixed` works on the binary value, so a figure typed as 13.35 is really
 * 13.3499999... and comes out "13.3", while 13.45 comes out "13.4" and 1.005 comes out "1.00":
 * halves round down or up at random. Intl formats the decimal the number was written as, so
 * 13.35 is "13.4" and 4.35 is "4.4", every time. A yield an investor reads should not depend on
 * how a binary double happens to fall.
 */
export function toFixedHalfUp(value: number, decimals: number): string {
  let f = FIXED.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-GB", {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false,
    });
    FIXED.set(decimals, f);
  }
  return f.format(value);
}

/** Percentage already expressed as a number, e.g. 4.25 -> "4.25%". */
export function formatPct(
  value: number | null | undefined,
  decimals = 2,
): string {
  if (value == null) return "—";
  return `${toFixedHalfUp(value, decimals)}%`;
}

/** Multiple, e.g. 1.8 -> "1.80x". */
export function formatMultiple(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${toFixedHalfUp(value, 2)}x`;
}

export function formatArea(
  value: number | null | undefined,
  unit: "sqft" | "sqm",
): string {
  if (value == null) return "—";
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })} ${
    unit === "sqft" ? "sq ft" : "sq m"
  }`;
}

/** Price per area unit. */
export function formatPerArea(
  value: number | null | undefined,
  area: number | null | undefined,
  currency: Currency,
  unit: "sqft" | "sqm",
): string {
  if (value == null || !area) return "—";
  const sym = CURRENCY_SYMBOL[currency];
  const perUnit = value / area;
  return `${sym}${perUnit.toLocaleString("en-GB", {
    maximumFractionDigits: 0,
  })}/${unit === "sqft" ? "sq ft" : "sq m"}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function currencySymbol(currency: Currency): string {
  return CURRENCY_SYMBOL[currency];
}
