// ============================================================================
// Numbers from a form: plain numbers inside bounds, or a refusal.
// No database: the parser is a property of the string.
// ============================================================================
import { describe, it, expect } from "vitest";
import { parseNumber, PERCENT, NON_NEGATIVE, ANY_AMOUNT } from "@/lib/validation/numeric";

describe("parseNumber", () => {
  it("returns null for blank - unknown is never imputed as zero", () => {
    expect(parseNumber("", "X")).toBeNull();
    expect(parseNumber("   ", "X")).toBeNull();
    expect(parseNumber(null, "X")).toBeNull();
  });

  it("accepts plain numbers", () => {
    expect(parseNumber("12.5", "X")).toBe(12.5);
    expect(parseNumber(" 25000000 ", "X", NON_NEGATIVE)).toBe(25_000_000);
    expect(parseNumber("0", "X", PERCENT)).toBe(0);
    expect(parseNumber("100", "X", PERCENT)).toBe(100);
    expect(parseNumber("-4.2", "NOI", ANY_AMOUNT)).toBe(-4.2);
  });

  it.each(["12e3", "1E5", "0x10", "Infinity", "NaN", "1,5", "1 000", "+5", ".5", "5.", "--1", "12abc", "£5"])(
    "refuses %s as not a plain number", (raw) => {
      expect(() => parseNumber(raw, "Price")).toThrow(/plain number/);
    });

  it("enforces percentage bounds on both sides", () => {
    expect(() => parseNumber("150", "NIY", PERCENT)).toThrow(/above 100/);
    expect(() => parseNumber("999", "Probability", PERCENT)).toThrow(/above 100/);
    expect(() => parseNumber("-15", "Target IRR", PERCENT)).toThrow(/below 0/);
  });

  it("refuses a negative price but allows a negative NOI", () => {
    expect(() => parseNumber("-1", "Price", NON_NEGATIVE)).toThrow(/below 0/);
    expect(parseNumber("-250000", "NOI", ANY_AMOUNT)).toBe(-250_000);
  });

  it("refuses a value too large to be a real amount", () => {
    expect(() => parseNumber("9".repeat(20), "Price", NON_NEGATIVE)).toThrow(/out of range/);
  });

  it("names the field in the message", () => {
    expect(() => parseNumber("abc", "Target price")).toThrow(/Target price/);
  });
});
