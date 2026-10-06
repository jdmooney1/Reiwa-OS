// What the translator is handed, what it may answer, and how the Japanese reads.
import { describe, it, expect } from "vitest";
import { composeMemo, type ComposedMemo } from "@/lib/memo/compose";
import { snapshotSource } from "./memo-source.fixture";
import { buildTranslationSource } from "@/lib/memo-translation/source";
import { buildTranslationPrompt, TRANSLATION_SYSTEM_PROMPT } from "@/lib/memo-translation/prompt";
import { TranslationSchema, validateTranslation } from "@/lib/memo-translation/schema";
import { TEASER_KEYS, parseJaOverrides, JA_SECTION_LABEL, isTeaserKey } from "@/lib/memo-translation/sections";
import { japaneseView } from "@/lib/memo-translation/japanese";
import { translationRefusalReason } from "@/lib/memo-translation/eligibility";

const memo = composeMemo(snapshotSource());
const clone = (): ComposedMemo => JSON.parse(JSON.stringify(memo));

describe("the English source: the Teaser's own sections, as an English reader sees them", () => {
  const src = buildTranslationSource(memo, {});

  it("covers only Teaser sections, in Teaser order", () => {
    const keys = src.sections.map((s) => s.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => TEASER_KEYS.includes(k))).toBe(true);
    expect(keys).toEqual(TEASER_KEYS.filter((k) => keys.includes(k)));
  });

  it("carries figures exactly as the English page displays them", () => {
    const km = src.sections.find((s) => s.key === "key_metrics")!.text;
    expect(km).toContain("£64,000,000");
    expect(km).toContain("14.2%");
    expect(km).toContain("1.90x");
    expect(km).not.toMatch(/Not recorded/);
  });

  it("never carries an internal section, the Snapshot, or anything outside the Teaser", () => {
    const spiked = clone();
    for (const key of ["recommendation", "risk_mitigation", "tax_structuring", "further_dd", "financial_analysis", "japan_rationale"]) {
      (spiked.sections as any)[key] = { status: "composed", flags: [], emptyReason: null, blocks: [{ kind: "text", audience: "external", source: "t", text: `INTERNAL-${key}` }] };
    }
    const all = JSON.stringify(buildTranslationSource(spiked, { recommendation: "INTERNAL-override", japanese_summary: "手書き要約" } as any));
    expect(all).not.toMatch(/INTERNAL-|手書き要約/);
    expect(all).not.toContain("58 Queens Gate, London, SW7 5JW"); // the Snapshot's address
  });

  it("withholds an internal BLOCK inside a Teaser section, as print does", () => {
    const m = clone();
    m.sections.location_market.blocks.push({ kind: "text", audience: "internal", source: "t", text: "INTERNAL-block" });
    expect(JSON.stringify(buildTranslationSource(m, {}))).not.toContain("INTERNAL-block");
  });

  it("sends a hand-written override as written, and does not send an empty section at all", () => {
    const withOverride = buildTranslationSource(memo, { executive_summary: "  A short summary. 5 units.  " });
    expect(withOverride.sections.find((s) => s.key === "executive_summary")!.text).toBe("A short summary. 5 units.");
    const empty = clone();
    empty.sections.exit_strategy = { status: "empty", blocks: [], flags: [], emptyReason: "x" };
    expect(buildTranslationSource(empty, {}).sections.some((s) => s.key === "exit_strategy")).toBe(false);
  });

  it("reads the composed memo object only: the module imports no data, database or session code", () => {
    // Held structurally in memo-translation-boundaries.test.ts; here, the behaviour: it is a pure function of its arguments.
    expect(buildTranslationSource(memo, {})).toEqual(buildTranslationSource(clone(), {}));
  });
});

describe("the prompt", () => {
  const prompt = buildTranslationPrompt(buildTranslationSource(memo, {}));
  it("puts the whole Teaser in one message, each section under its key", () => {
    for (const s of buildTranslationSource(memo, {}).sections) expect(prompt).toContain(`### ${s.key} (`);
    expect(prompt).toContain("58 Queens Gate");
  });
  it("states the rules that matter: figures unchanged, nothing added, consistent terms, proper names kept", () => {
    expect(TRANSLATION_SYSTEM_PROMPT).toMatch(/NEVER change a figure/);
    expect(TRANSLATION_SYSTEM_PROMPT).toMatch(/Do not add anything/);
    expect(TRANSLATION_SYSTEM_PROMPT).toMatch(/consistent across the WHOLE document/);
    expect(TRANSLATION_SYSTEM_PROMPT).toMatch(/Keep proper names/);
    expect(TRANSLATION_SYSTEM_PROMPT).toMatch(/純初期利回り/);
  });
});

describe("the output schema is closed", () => {
  const full = Object.fromEntries(TEASER_KEYS.map((k) => [k, "訳"]));
  it("accepts one string per Teaser section", () => {
    expect(TranslationSchema.safeParse(full).success).toBe(true);
  });
  it("REJECTS a response naming a section key outside the Teaser's own set", () => {
    for (const bad of ["recommendation", "risk_mitigation", "tax_structuring", "further_dd", "snapshot", "japanese_summary", "made_up"]) {
      expect(TranslationSchema.safeParse({ ...full, [bad]: "x" }).success, bad).toBe(false);
    }
  });
  it("rejects a missing key, a non-string, and an over-long section", () => {
    const { executive_summary: _drop, ...rest } = full;
    void _drop;
    expect(TranslationSchema.safeParse(rest).success).toBe(false);
    expect(TranslationSchema.safeParse({ ...full, key_metrics: 5 }).success).toBe(false);
    expect(TranslationSchema.safeParse({ ...full, key_metrics: "あ".repeat(20_001) }).success).toBe(false);
  });
  it("validateTranslation requires text for every section sent and discards a section never asked for", () => {
    const raw = TranslationSchema.parse({ ...full, business_plan: "" , exit_strategy: "" });
    expect(() => validateTranslation(["executive_summary", "business_plan"], raw)).toThrow(/without text for every section/);
    const out = validateTranslation(["executive_summary", "key_metrics"], TranslationSchema.parse({ ...full, business_plan: "余分" }));
    expect(Object.keys(out)).toEqual(["executive_summary", "key_metrics"]);
  });
});

describe("sections and Japanese view", () => {
  it("knows the Teaser's seven sections, each with a fixed Japanese heading", () => {
    expect(TEASER_KEYS).toHaveLength(7);
    for (const k of TEASER_KEYS) expect(JA_SECTION_LABEL[k]).toBeTruthy();
    expect(isTeaserKey("recommendation")).toBe(false);
    expect(isTeaserKey("executive_summary")).toBe(true);
  });
  it("parseJaOverrides drops a foreign key and a non-text value instead of rendering it", () => {
    expect(parseJaOverrides({ executive_summary: "要約", recommendation: "x", key_metrics: 5, business_plan: "  " })).toEqual({ executive_summary: "要約" });
    expect(parseJaOverrides(null)).toEqual({});
    expect(parseJaOverrides([1])).toEqual({});
  });
  it("with nothing accepted, the view is the earlier hand-written summary, unchanged", () => {
    expect(japaneseView({}, "手書きの要約")).toEqual({ mode: "summary", text: "手書きの要約" });
    expect(japaneseView({}, undefined)).toEqual({ mode: "summary", text: "" });
  });
  it("with any section accepted, it is the Teaser view; the hand-written summary stands in for the executive summary only until one is accepted", () => {
    const standIn = japaneseView({ key_metrics: "指標" }, "手書き");
    expect(standIn.mode).toBe("teaser");
    if (standIn.mode !== "teaser") throw new Error();
    const es = standIn.sections.find((s) => s.key === "executive_summary")!;
    expect(es).toMatchObject({ text: "手書き", fromHandWrittenSummary: true });
    expect(standIn.sections.find((s) => s.key === "key_metrics")).toMatchObject({ text: "指標", fromHandWrittenSummary: false });
    expect(standIn.sections.find((s) => s.key === "business_plan")!.text).toBeNull();

    const own = japaneseView({ executive_summary: "新しい要約" }, "手書き");
    if (own.mode !== "teaser") throw new Error();
    expect(own.sections[0]).toMatchObject({ key: "executive_summary", text: "新しい要約", fromHandWrittenSummary: false });
  });
});

describe("eligibility", () => {
  it("refuses a final memo and allows a draft", () => {
    expect(translationRefusalReason("final")).toMatch(/Only a draft memo can be translated/);
    expect(translationRefusalReason("draft")).toBeNull();
  });
});
