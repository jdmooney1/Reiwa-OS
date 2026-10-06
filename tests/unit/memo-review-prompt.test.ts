// ============================================================================
// What the reviewer is shown, and what it is allowed to say back.
// ----------------------------------------------------------------------------
// Two halves. The prompt half proves the model sees the whole memo as recorded -
// every section, overrides applied, figures untouched - and nothing the memo was
// never allowed to carry. The schema half proves the answer cannot be anything
// but a closed list of pointers: no verdict, no prose, no corrected number.
// ============================================================================
import { describe, it, expect } from "vitest";
import { composeMemo } from "@/lib/memo/compose";
import { MEMO_SECTIONS, SECTION_LABEL } from "@/lib/memo/sections";
import { buildReviewPrompt, REVIEW_SYSTEM_PROMPT } from "@/lib/memo-review/prompt";
import { ReviewSchema, parseFindings, MAX_REASON_CHARS } from "@/lib/memo-review/findings";
import { snapshotSource, SNAP_CASE } from "./memo-source.fixture";

const memo = composeMemo(snapshotSource());

describe("the reviewer is shown the whole memo", () => {
  it("every one of the seventeen sections appears, whatever format is open", () => {
    for (const fmt of ["ic", "teaser", "snapshot", "japanese"] as const) {
      const text = buildReviewPrompt(memo, {}, fmt);
      for (const s of MEMO_SECTIONS) expect(text, `${s.key} in ${fmt}`).toContain(`## ${SECTION_LABEL[s.key]}`);
    }
  });

  it("the internal-only sections are shown even when an external format is open", () => {
    // These three are exactly the sections an external format withholds, and
    // exactly the ones most worth a second look before finalising.
    const teaser = buildReviewPrompt(memo, {}, "teaser");
    expect(teaser).toContain(`## ${SECTION_LABEL.recommendation}`);
    expect(teaser).toContain(`## ${SECTION_LABEL.risk_mitigation}`);
    expect(teaser).toContain(`## ${SECTION_LABEL.tax_structuring}`);
    expect(teaser).toMatch(/\[internal\]/);
  });

  it("it says which format the person is finalising in", () => {
    expect(buildReviewPrompt(memo, {}, "teaser")).toContain("Investor Teaser");
    expect(buildReviewPrompt(memo, {}, "ic")).toContain("Internal IC Memo");
  });

  it("a hand-written override replaces the composed content for that section, and is marked as hand-written", () => {
    const text = buildReviewPrompt(memo, { investment_thesis: "My own words about this deal." }, "ic");
    expect(text).toContain("My own words about this deal.");
    expect(text).toContain("[written by hand, replaces the composed content]");
    // The thesis the composer carried is superseded, exactly as the workspace renders it.
    expect(text).not.toContain("Core-plus office.");
  });

  it("an empty section says it is empty and why, so a gap cannot read as a figure", () => {
    const thin = composeMemo(snapshotSource({ basis: { kind: "none", case: null } }));
    expect(buildReviewPrompt(thin, {}, "ic")).toMatch(/\(empty\)/);
  });

  it("a Japanese summary written by hand is included", () => {
    const text = buildReviewPrompt(memo, { japanese_summary: "日本語のまとめ。" }, "japanese");
    expect(text).toContain("日本語のまとめ。");
  });
});

describe("figures reach the reviewer exactly as recorded", () => {
  const text = buildReviewPrompt(memo, {}, "ic");

  it("money is passed through unrounded and unformatted, with the currency named", () => {
    expect(text).toContain("Currency of all money figures unless stated: GBP");
    // 64,000,000 from the fixture - not "64m", not "£64,000,000", not rounded.
    expect(text).toContain("64000000");
    expect(text).not.toMatch(/£64|64\.0m|64m\b/);
  });

  it("an awkward percentage keeps all of its digits", () => {
    // 45.73 and 2.97 would both be lost to a one-decimal presentation rule.
    expect(text).toContain("45.73");
    expect(text).toContain("2.97");
  });

  it("a figure the record does not hold is named as not recorded, never as zero", () => {
    const thin = composeMemo(snapshotSource({
      basis: { kind: "approved", case: { ...SNAP_CASE, targetIrr: null, targetEquityMultiple: null } },
    }));
    const text2 = buildReviewPrompt(thin, {}, "ic");
    expect(text2).toContain("(not recorded)");
    expect(text2).not.toMatch(/: 0 GBP/);
  });

  it("the basis is stated, so an unapproved working version cannot read as approved", () => {
    expect(text).toContain("underwriting v3 (approved)");
    const working = composeMemo(snapshotSource({
      basis: { kind: "working", case: { ...snapshotSource().basis.case!, status: "draft" } },
    }));
    expect(buildReviewPrompt(working, {}, "ic")).toContain("not approved");
  });
});

describe("the prompt carries nothing the memo was not allowed to carry", () => {
  const text = buildReviewPrompt(memo, {}, "ic");

  it("no street address, even though the Snapshot object holds one", () => {
    // The fixture's asset DOES carry an address line; the reviewer is not shown
    // it. A reviewer has no use for the street, and the narrowest input wins.
    expect(snapshotSource().asset.addressLine).toContain("58 Queens Gate, London");
    expect(text).not.toContain("SW7 5JW");
    expect(text).not.toContain("58 Queens Gate, London,");
  });

  it("no photograph or map reference, no coordinates, no broker and no vendor", () => {
    expect(text).not.toMatch(/11111111-1111|22222222-2222/);
    expect(text).not.toMatch(/latitude|longitude|geocode|street.?view|broker|vendor|source contact|triage/i);
  });
});

describe("the reviewer is told to point, never to correct or to approve", () => {
  it("it is forbidden from stating a corrected figure or rewriting a section", () => {
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/Never state a corrected figure/);
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/Never rewrite, draft or suggest replacement wording/);
  });

  it("it is forbidden from giving a verdict, and told an empty list is a normal answer", () => {
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/Never give a verdict/);
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/empty list of findings - that is a normal and expected answer/);
  });

  it("all four categories the brief asks for are described to it", () => {
    const text = buildReviewPrompt(memo, {}, "ic");
    for (const k of ["numeric_inconsistency", "outlier_metric", "unresolved_gap", "internal_contradiction"]) {
      expect(text).toContain(k);
    }
  });
});

describe("the answer schema is closed", () => {
  const ok = {
    category: "numeric_inconsistency",
    label: "Net initial yield differs between sections",
    sections: ["key_metrics", "financial_analysis"],
    reason: "Key Metrics and Financial Analysis state different net initial yields for the same case.",
  };

  it("accepts a well-formed finding", () => {
    expect(ReviewSchema.safeParse({ findings: [ok] }).success).toBe(true);
  });

  it("accepts an empty list: nothing raised is a valid answer, not a failure", () => {
    const parsed = ReviewSchema.safeParse({ findings: [] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.findings).toEqual([]);
  });

  it("rejects a category outside the four", () => {
    expect(ReviewSchema.safeParse({ findings: [{ ...ok, category: "overall_verdict" }] }).success).toBe(false);
  });

  it("rejects a section that is not a section of the memo", () => {
    expect(ReviewSchema.safeParse({ findings: [{ ...ok, sections: ["the_whole_memo"] }] }).success).toBe(false);
  });

  it("rejects a finding that names no section: a pointer has to point somewhere", () => {
    expect(ReviewSchema.safeParse({ findings: [{ ...ok, sections: [] }] }).success).toBe(false);
  });

  it("rejects a reason long enough to be a rewritten section", () => {
    expect(ReviewSchema.safeParse({ findings: [{ ...ok, reason: "x".repeat(MAX_REASON_CHARS + 1) }] }).success).toBe(false);
  });

  it("has no field a replacement figure or replacement wording could travel in", () => {
    const parsed = ReviewSchema.parse({ findings: [{ ...ok, suggestion: "Change it to 5.1%", corrected_value: 5.1 }] });
    expect(Object.keys(parsed.findings[0]).sort()).toEqual(["category", "label", "reason", "sections"]);
  });
});

describe("reading a stored review back", () => {
  it("returns the findings a row holds", () => {
    const rows = [{
      category: "unresolved_gap", label: "Gap marker left in", sections: ["further_dd"], reason: "Still says not yet captured.",
    }];
    expect(parseFindings(rows)).toHaveLength(1);
  });

  it("a row written in some other shape reads as no findings, never as a crash on the memo screen", () => {
    expect(parseFindings([{ category: "nonsense" }])).toEqual([]);
    expect(parseFindings(null)).toEqual([]);
    expect(parseFindings("findings")).toEqual([]);
  });
});
