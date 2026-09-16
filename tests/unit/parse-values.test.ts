import { describe, it, expect } from "vitest";
import {
  parseMoney, parsePercent, parseArea, parseDate, parseText,
  normaliseDecimal, detectCurrency, detectAreaUnit, isBlank,
} from "@/lib/ingestion/parse-values";

describe("isBlank", () => {
  it("treats broker non-answers as absent, never as zero", () => {
    for (const v of ["", "-", "—", "N/A", "TBC", "POA", "Price on application", "undisclosed"]) {
      expect(isBlank(v), v).toBe(true);
    }
    expect(isBlank("0")).toBe(false);
    expect(isBlank("£0")).toBe(false);
  });
});

describe("normaliseDecimal", () => {
  it("reads UK grouping", () => {
    expect(normaliseDecimal("12,500,000")).toBe(12_500_000);
    expect(normaliseDecimal("1,234.56")).toBe(1234.56);
  });
  it("reads European grouping", () => {
    expect(normaliseDecimal("1.234.567,89")).toBe(1_234_567.89);
    expect(normaliseDecimal("12.500,00")).toBe(12_500);
  });
  it("reads space grouping", () => {
    expect(normaliseDecimal("12 500 000")).toBe(12_500_000);
  });
  it("refuses genuinely ambiguous separators rather than guessing", () => {
    // "1.234" is either 1234 (European grouping) or 1.234 (UK decimal).
    expect(normaliseDecimal("1.234")).toBeNull();
  });
  it("reads a bare comma group as grouping", () => {
    expect(normaliseDecimal("1,234")).toBe(1234);
  });
  it("resolves repeated separators as grouping, not ambiguity", () => {
    // A number has at most one decimal separator, so a repeated one can only be
    // grouping - whichever convention it is.
    expect(normaliseDecimal("85.000.000")).toBe(85_000_000);
    expect(normaliseDecimal("12,500,000")).toBe(12_500_000);
    expect(normaliseDecimal("12,500,000.75")).toBe(12_500_000.75);
    expect(normaliseDecimal("1.234.567,89")).toBe(1_234_567.89);
  });
  it("reads a lone comma as a decimal when it is not a thousands group", () => {
    expect(normaliseDecimal("4,12")).toBe(4.12);
    expect(normaliseDecimal("4,5")).toBe(4.5);
  });
  it("rejects malformed mixtures", () => {
    expect(normaliseDecimal("1.2.3,4,5")).toBeNull();
    expect(normaliseDecimal("abc")).toBeNull();
    expect(normaliseDecimal("")).toBeNull();
  });
});

describe("parseMoney", () => {
  it("parses full figures with a currency symbol", () => {
    const r = parseMoney("£12,500,000");
    expect(r.value).toBe(12_500_000);
    expect(r.currency).toBe("GBP");
    expect(r.confidence).toBe(1);
  });
  it("expands multipliers", () => {
    expect(parseMoney("12.5m").value).toBe(12_500_000);
    expect(parseMoney("£8.0m").value).toBe(8_000_000);
    expect(parseMoney("EUR 3.4 million").value).toBe(3_400_000);
    expect(parseMoney("540k").value).toBe(540_000);
    expect(parseMoney("£1.2bn").value).toBe(1_200_000_000);
  });
  it("detects currency from code or symbol, and never assumes one", () => {
    expect(parseMoney("€85,000,000").currency).toBe("EUR");
    expect(parseMoney("EUR 3.4m").currency).toBe("EUR");
    expect(parseMoney("12,500,000").currency).toBeNull();
  });
  it("flags approximations without discarding the number", () => {
    const r = parseMoney("c. £8.0m");
    expect(r.value).toBe(8_000_000);
    expect(r.notes).toContain("approximate_value");
    expect(r.confidence).toBeLessThan(1);
  });
  it("strips broker prefixes", () => {
    expect(parseMoney("Offers over £2,750,000").value).toBe(2_750_000);
    expect(parseMoney("Guide £7.4m").value).toBe(7_400_000);
  });
  it("flags a unit rate that has been put in a price column", () => {
    const r = parseMoney("£850 per sq ft");
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.notes).toContain("looks_like_unit_rate");
  });
  it("returns null for non-answers", () => {
    expect(parseMoney("POA").value).toBeNull();
    expect(parseMoney("").value).toBeNull();
  });
});

describe("parsePercent", () => {
  it("keeps percent numbers as written, matching the stored convention", () => {
    expect(parsePercent("4.12%").value).toBe(4.12);
    expect(parsePercent("5.25 %").value).toBe(5.25);
    expect(parsePercent("4.2").value).toBe(4.2);
  });
  it("flags a bare decimal that may be a fraction instead of converting it", () => {
    const r = parsePercent("0.0412");
    expect(r.value).toBe(0.0412);
    expect(r.notes).toContain("possible_fraction_not_percent");
    expect(r.confidence).toBeLessThan(0.5);
  });
  it("flags an implausible percentage", () => {
    expect(parsePercent("412%").notes).toContain("above_100_percent");
  });
  it("reads European decimals", () => {
    expect(parsePercent("4,12%").value).toBe(4.12);
  });
});

describe("parseArea", () => {
  it("parses with an explicit unit", () => {
    expect(parseArea("24,500 sq ft")).toMatchObject({ value: 24_500, unit: "sqft" });
    expect(parseArea("2 300 sqm")).toMatchObject({ value: 2300, unit: "sqm" });
    expect(parseArea("1,250 m²")).toMatchObject({ value: 1250, unit: "sqm" });
  });
  it("flags a missing unit rather than assuming one from magnitude", () => {
    const r = parseArea("24,500");
    expect(r.value).toBe(24_500);
    expect(r.unit).toBeNull();
    expect(r.notes).toContain("unit_not_stated");
  });
  it("detects units independently", () => {
    expect(detectAreaUnit("sq.ft")).toBe("sqft");
    expect(detectAreaUnit("plain text")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads ISO dates", () => {
    expect(parseDate("2026-09-16").value).toBe("2026-09-16");
  });
  it("reads named months", () => {
    expect(parseDate("16 Sep 2026").value).toBe("2026-09-16");
    expect(parseDate("16 September 2026").value).toBe("2026-09-16");
  });
  it("flags a month-year with no day", () => {
    const r = parseDate("September 2026");
    expect(r.value).toBe("2026-09-01");
    expect(r.notes).toContain("day_not_stated_assumed_first");
  });
  it("reads unambiguous numeric dates day-first", () => {
    expect(parseDate("16/09/2026").value).toBe("2026-09-16");
    expect(parseDate("16.09.2026").value).toBe("2026-09-16");
  });
  it("flags an ambiguous numeric date instead of silently choosing", () => {
    const r = parseDate("03/04/2026");
    expect(r.value).toBe("2026-04-03");
    expect(r.notes).toContain("day_month_ambiguous_assumed_day_first");
    expect(r.confidence).toBeLessThan(0.7);
  });
  it("infers month-first when day-first is impossible", () => {
    const r = parseDate("09/16/2026");
    expect(r.value).toBe("2026-09-16");
    expect(r.notes).toContain("month_first_inferred");
  });
  it("accepts a Date instance from a spreadsheet cell", () => {
    expect(parseDate(new Date(Date.UTC(2026, 8, 16))).value).toBe("2026-09-16");
  });
  it("rejects nonsense rather than coercing it", () => {
    expect(parseDate("banana").value).toBeNull();
    expect(parseDate("32/13/2026").value).toBeNull();
  });
});

describe("parseText / detectCurrency", () => {
  it("collapses whitespace", () => {
    expect(parseText("  16   Conduit   Street \n").value).toBe("16 Conduit Street");
  });
  it("finds a currency code in free text", () => {
    expect(detectCurrency("Guide price EUR 3.4m")).toBe("EUR");
    expect(detectCurrency("no currency here")).toBeNull();
  });
});
