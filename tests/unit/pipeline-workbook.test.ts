// ============================================================================
// The interpretation rules the pipeline load applies.
// ----------------------------------------------------------------------------
// These are the rules that decide what a spreadsheet cell MEANS, which is where
// a bulk load does its damage if it is wrong. They run without a database or a
// file: the rule is a property of the mapping, not of the workbook.
// ============================================================================
import { describe, it, expect } from "vitest";
import { entryYieldPct, isNotABuilding, NOT_A_BUILDING } from "@/lib/ingestion/pipeline-workbook";

describe("entryYieldPct - missing stays missing", () => {
  it("computes the yield when both figures are present", () => {
    // LON-001 in the first load: 101,000 on 1,900,000.
    expect(entryYieldPct(1_900_000, 101_000)).toBe(5.3158);
    // LON-009, after the Saint fix.
    expect(entryYieldPct(7_000_000, 167_940)).toBe(2.3991);
  });

  it("refuses to invent a yield when income is unknown", () => {
    // 38 rows in the first load have no income. A yield derived for them would
    // be indistinguishable from one a broker quoted.
    expect(entryYieldPct(8_500_000, null)).toBeNull();
    expect(entryYieldPct(null, 500_000)).toBeNull();
    expect(entryYieldPct(null, null)).toBeNull();
  });

  it("treats a missing income as unknown, never as zero", () => {
    // Zero income is a real, different claim: it would yield 0%, which reads as
    // a fact about the asset rather than a gap in the sheet.
    expect(entryYieldPct(1_000_000, null)).toBeNull();
    expect(entryYieldPct(1_000_000, 0)).toBe(0);
  });

  it("refuses a division that cannot mean anything", () => {
    expect(entryYieldPct(0, 100_000)).toBeNull();
    expect(entryYieldPct(-1, 100_000)).toBeNull();
  });
});

describe("Things that are not a single building", () => {
  it("excludes the portfolio from property identity, with a reason", () => {
    // LON-109 is a portfolio. Letting it fall into the unkeyable bucket would
    // file it beside "York House" as though the address were merely missing,
    // when the question does not apply to it at all.
    const reason = isNotABuilding("LON-109");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/portfolio/i);
  });

  it("says nothing about an ordinary reference", () => {
    expect(isNotABuilding("LON-001")).toBeNull();
    expect(isNotABuilding("AMS-004")).toBeNull();
  });

  it("names every exclusion explicitly rather than inferring a rule", () => {
    // A heuristic on the word "portfolio" would also catch a building called
    // "The Portfolio Building". Exclusions are listed, one at a time.
    expect(Object.keys(NOT_A_BUILDING)).toEqual(["LON-109"]);
  });
});
