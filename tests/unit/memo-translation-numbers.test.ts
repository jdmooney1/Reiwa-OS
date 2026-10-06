// The figure check: it must pass a faithful translation, and it must NOT be vacuous.
import { describe, it, expect } from "vitest";
import { figuresIn, checkFigures, figureProblem } from "@/lib/memo-translation/numbers";

const EN = [
  "Target acquisition value: £64,000,000",
  "Target IRR: 14.2%",
  "Entry yield: 2.97%",
  "Target equity multiple: 1.90x",
  "Indicative hold period: 5 years",
  "Approximate size: 42,000 sq ft",
].join("\n");

const JA = [
  "目標取得価格: £64,000,000",
  "目標IRR: 14.2%",
  "エントリー利回り: 2.97%",
  "目標エクイティマルチプル: 1.90x",
  "想定保有期間: 5年",
  "概算面積: 42,000 sq ft",
].join("\n");

describe("figuresIn", () => {
  it("reads figures as spelled, commas and decimals kept", () => {
    expect(figuresIn(EN)).toEqual(["64,000,000", "14.2", "2.97", "1.90", "5", "42,000"]);
    expect(figuresIn("no numbers here")).toEqual([]);
    expect(figuresIn("2026 and 01 Sept")).toEqual(["2026", "01"]);
  });
});

describe("checkFigures", () => {
  it("passes a faithful translation", () => {
    expect(checkFigures(EN, JA)).toEqual({ ok: true, missing: [], unexpected: [] });
    expect(figureProblem(checkFigures(EN, JA))).toBeNull();
  });

  it("passes when the words change but the figures do not, and when their order does", () => {
    expect(checkFigures("Yield 4.5% in 5 years", "5年で利回り4.5%").ok).toBe(true);
  });

  // The non-vacuity proofs: each one is a deliberately corrupted fixture, and each must be caught.
  it("CATCHES a changed figure", () => {
    const bad = JA.replace("14.2%", "14.5%");
    const c = checkFigures(EN, bad);
    expect(c.ok).toBe(false);
    expect(c.missing).toEqual(["14.2"]);
    expect(c.unexpected).toEqual(["14.5"]);
    expect(figureProblem(c)).toMatch(/missing from the Japanese: 14\.2.*14\.5/);
  });

  it("CATCHES a dropped figure", () => {
    const c = checkFigures(EN, JA.replace("2.97%", "低い"));
    expect(c).toMatchObject({ ok: false, missing: ["2.97"], unexpected: [] });
  });

  it("CATCHES an invented figure", () => {
    const c = checkFigures(EN, `${JA}\n築年数: 12年`);
    expect(c).toMatchObject({ ok: false, missing: [], unexpected: ["12"] });
  });

  it("CATCHES a reformatting a reader would not recognise: 万, dropped commas, full-width digits", () => {
    expect(checkFigures(EN, JA.replace("£64,000,000", "6,400万ポンド")).ok).toBe(false);
    expect(checkFigures(EN, JA.replace("64,000,000", "64000000")).ok).toBe(false);
    expect(checkFigures(EN, JA.replace("14.2", "１４．２")).ok).toBe(false);
  });

  it("is a multiset: a figure that appears twice must appear twice, and one cannot cover for another", () => {
    expect(checkFigures("5 years, then 5 years", "5年、その後5年").ok).toBe(true);
    expect(checkFigures("5 years, then 5 years", "5年").ok).toBe(false);
    expect(checkFigures("5 and 6", "5 and 5")).toMatchObject({ ok: false, missing: ["6"], unexpected: ["5"] });
  });

  it("an empty draft against a source with figures fails; two figure-free texts pass", () => {
    expect(checkFigures(EN, "").ok).toBe(false);
    expect(checkFigures("Prime office in Mayfair.", "メイフェアの一等地オフィス。").ok).toBe(true);
  });
});
