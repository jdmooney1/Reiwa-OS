import { describe, it, expect } from "vitest";
import {
  diffVersions, confirmationPhrase, phraseMatches, normalisePhrase,
  type ReviewVersion, type ReviewDocument,
} from "@/lib/publication/review";

const base: ReviewVersion = {
  title: "11 Gate Street", headline: "Secure income", overview: "Written for investors.",
  highlights: ["12-year lease", "Reversion in 2029"], market: "London", submarket: null,
  city: "London", country: "United Kingdom", assetType: "office", strategy: "core",
  currency: "GBP", holdPeriodYears: 5, headlinePrice: 8400000, targetNiy: 6.25,
  targetIrr: 13.5, targetEquityMultiple: 1.9, sizeSqft: 21500, sizeSqm: null,
};
const doc = (p: string, over: Partial<ReviewDocument> = {}): ReviewDocument => ({
  lineageId: p, title: p, category: "teaser", accessLevel: "standard", fileName: `${p}.pdf`, sizeBytes: 10, ...over,
});

describe("diffVersions", () => {
  it("reports no change for identical versions", () => {
    const d = diffVersions(base, { ...base }, [doc("a")], [doc("a")]);
    expect(d.changeCount).toBe(0);
    expect(d.fields).toEqual([]);
    expect(d.documents).toEqual([]);
    expect(d.firstPublication).toBe(false);
  });

  it("treats everything populated as new on a first publication", () => {
    const d = diffVersions(null, base, [], [doc("a")]);
    expect(d.firstPublication).toBe(true);
    const keys = d.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["title", "overview", "headlinePrice", "highlights", "sizeSqft"]));
    expect(keys).not.toContain("submarket"); // empty on both sides is not a change
    expect(d.documents).toEqual([{ type: "added", title: "a", detail: "standard tier" }]);
  });

  it("shows figures at stored precision, so 6.25 -> 6.3 is visible", () => {
    const d = diffVersions(base, { ...base, targetNiy: 6.3, headlinePrice: 8450000 }, [], []);
    const by = Object.fromEntries(d.fields.map((f) => [f.key, [f.before, f.after]]));
    expect(by.targetNiy).toEqual(["6.25%", "6.3%"]);
    expect(by.headlinePrice).toEqual(["£8,400,000", "£8,450,000"]);
  });

  it("reports text removed as 'after: null' and a blanked overview as a change", () => {
    const d = diffVersions(base, { ...base, overview: "   ", headline: null }, [], []);
    const by = Object.fromEntries(d.fields.map((f) => [f.key, [f.before, f.after]]));
    expect(by.overview).toEqual(["Written for investors.", null]);
    expect(by.headline).toEqual(["Secure income", null]);
  });

  it("diffs highlights as a block", () => {
    const d = diffVersions(base, { ...base, highlights: ["12-year lease"] }, [], []);
    expect(d.fields.map((f) => f.key)).toEqual(["highlights"]);
    expect(d.fields[0].before).toContain("Reversion in 2029");
    expect(d.fields[0].after).not.toContain("Reversion in 2029");
  });

  it("reports documents added, removed and changed, keyed by the document's lineage, not its file path", () => {
    const live = [doc("keep"), doc("drop", { accessLevel: "diligence" }), doc("retier")];
    const next = [doc("keep"), doc("new"), doc("retier", { accessLevel: "diligence" })];
    const d = diffVersions(base, base, live, next);
    expect(d.documents.map((x) => `${x.type}:${x.title}`).sort())
      .toEqual(["added:new", "changed:retier", "removed:drop"]);
    expect(d.documents.find((x) => x.type === "changed")!.detail).toContain("tier standard to diligence");
    expect(d.changeCount).toBe(3);
  });

  it("does not mistake a re-titled copy of the same file for a new document", () => {
    const d = diffVersions(base, base, [doc("f", { title: "Old" })], [doc("f", { title: "New" })]);
    expect(d.documents.map((x) => x.type)).toEqual(["changed"]);
  });
});

describe("the confirmation sentence", () => {
  it("quotes the version, the number of changes and the audience", () => {
    expect(confirmationPhrase(2, 5, 3)).toBe("publish v2 with 5 changes to 3 organisations");
    expect(confirmationPhrase(1, 1, 1)).toBe("publish v1 with 1 change to 1 organisation");
    expect(confirmationPhrase(4, 0, 0)).toBe("publish v4 with 0 changes to 0 organisations");
  });

  it("names the problem when the Overview is the internal summary", () => {
    expect(confirmationPhrase(2, 5, 3, { echoesInternalSummary: true }))
      .toBe("publish v2 with 5 changes to 3 organisations with the internal summary as the overview");
    expect(confirmationPhrase(2, 5, 3, { echoesInternalSummary: false })).toBe(confirmationPhrase(2, 5, 3));
    // The ordinary sentence is not enough once the flag is set.
    expect(phraseMatches(confirmationPhrase(2, 5, 3), confirmationPhrase(2, 5, 3, { echoesInternalSummary: true }))).toBe(false);
  });

  it("ignores case and spacing, and nothing else", () => {
    const p = confirmationPhrase(2, 5, 3);
    expect(phraseMatches("  PUBLISH   v2 with 5 changes   to 3 organisations ", p)).toBe(true);
    expect(phraseMatches("publish v2 with 4 changes to 3 organisations", p)).toBe(false);
    expect(phraseMatches("publish v2 with 5 changes to 2 organisations", p)).toBe(false);
    expect(phraseMatches("publish v3 with 5 changes to 3 organisations", p)).toBe(false);
    expect(phraseMatches("", p)).toBe(false);
    expect(normalisePhrase("A  B\n C")).toBe("a b c");
  });
});
