// ============================================================================
// Market to currency: a guard against a slip, silent when it cannot judge.
// ============================================================================
import { describe, it, expect } from "vitest";
import { expectedCurrency, currencyMismatch } from "@/lib/market-currency";

describe("expectedCurrency", () => {
  it.each([
    ["London", "GBP"], ["Amsterdam", "EUR"], ["Paris", "EUR"], ["Dublin", "EUR"], ["Tokyo", "JPY"],
    ["  london ", "GBP"],
  ])("%s -> %s", (market, ccy) => expect(expectedCurrency(market)).toBe(ccy));

  it("falls back to the country when the market is unknown", () => {
    expect(expectedCurrency("Osaka", "Japan")).toBe("JPY");
    expect(expectedCurrency(null, "Netherlands")).toBe("EUR");
    expect(expectedCurrency("Other", "United Kingdom")).toBe("GBP");
  });

  it("has no opinion on a market it does not know", () => {
    expect(expectedCurrency("Other")).toBeNull();
    expect(expectedCurrency(null)).toBeNull();
    expect(expectedCurrency("Lisbon", "Portugal")).toBeNull();
  });
});

describe("currencyMismatch", () => {
  it("flags a Tokyo asset in GBP and an Amsterdam deal in GBP", () => {
    expect(currencyMismatch("GBP", "Tokyo")).toMatch(/Tokyo deals are normally JPY.*GBP/);
    expect(currencyMismatch("GBP", "Amsterdam")).toMatch(/normally EUR/);
  });

  it("is silent when the currency fits or cannot be judged", () => {
    expect(currencyMismatch("GBP", "London")).toBeNull();
    expect(currencyMismatch("JPY", "Tokyo")).toBeNull();
    expect(currencyMismatch("USD", "Other")).toBeNull();
    expect(currencyMismatch("USD", null)).toBeNull();
  });
});
