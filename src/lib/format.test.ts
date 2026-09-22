import { describe, expect, it } from "vitest";
import {
  currencySymbol, formatArea, formatMoney, formatMoneyCompact,
  formatMultiple, formatPct, formatPerArea,
} from "@/lib/format";

// An absent figure must always read as absent. Reiwa OS is a screening system:
// a missing NIY rendering as "0.00%" is a worse failure than an empty screen.
const ABSENT = "—";

describe("absent values", () => {
  it.each([
    ["formatMoney", () => formatMoney(null)],
    ["formatMoneyCompact", () => formatMoneyCompact(undefined)],
    ["formatPct", () => formatPct(null)],
    ["formatMultiple", () => formatMultiple(null)],
    ["formatArea", () => formatArea(null, "sqft")],
    ["formatPerArea (no value)", () => formatPerArea(null, 100, "GBP", "sqft")],
    ["formatPerArea (no area)", () => formatPerArea(1000, null, "GBP", "sqft")],
  ])("%s renders nothing rather than a zero", (_name, fn) => {
    expect(fn()).toBe(ABSENT);
  });

  it("never divides by a zero area", () => {
    expect(formatPerArea(1_000_000, 0, "GBP", "sqft")).toBe(ABSENT);
  });

  it("distinguishes a genuine zero from an absent figure", () => {
    expect(formatPct(0, 1)).toBe("0.0%");
    expect(formatMoney(0)).toBe("£0");
  });
});

describe("currency", () => {
  it("carries a symbol for every currency Reiwa deals in, yen included", () => {
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("JPY")).toBe("¥");
  });
});

describe("formatMoneyCompact", () => {
  it.each([
    [42_500_000, "£42.5m"],
    [1_000_000_000, "£1.0bn"],
    [850_000, "£850k"],
    [420, "£420"],
  ])("renders %i as %s", (value, expected) => {
    expect(formatMoneyCompact(value)).toBe(expected);
  });

  it("keeps the sign on a negative figure", () => {
    expect(formatMoneyCompact(-2_400_000)).toBe("£-2.4m");
  });
});

describe("formatPct and formatMultiple", () => {
  it("treats the input as already being a percentage", () => {
    expect(formatPct(4.25)).toBe("4.25%");
    expect(formatPct(6, 1)).toBe("6.0%");
  });

  it("renders a multiple to two decimals", () => {
    expect(formatMultiple(1.8)).toBe("1.80x");
  });
});

describe("area", () => {
  it("uses British unit spellings", () => {
    expect(formatArea(24_500, "sqft")).toBe("24,500 sq ft");
    expect(formatArea(2_276, "sqm")).toBe("2,276 sq m");
  });

  it("computes price per unit area", () => {
    expect(formatPerArea(1_000_000, 1_000, "GBP", "sqft")).toBe("£1,000/sq ft");
  });
});
