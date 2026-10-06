// The call and the orchestration, with the network and the database replaced by fakes.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import Anthropic from "@anthropic-ai/sdk";
import { runTranslation, TRANSLATION_MODEL, type TranslationClient } from "@/lib/memo-translation/translate";
import { generateTranslationDraft, type GenerateDeps } from "@/lib/memo-translation/generate";
import { composeMemo } from "@/lib/memo/compose";
import { TEASER_KEYS } from "@/lib/memo-translation/sections";
import { buildTranslationSource } from "@/lib/memo-translation/source";
import { snapshotSource } from "./memo-source.fixture";

const memo = composeMemo(snapshotSource());
const sent = buildTranslationSource(memo, {}).sections.map((s) => s.key);
const all = (text: string) => Object.fromEntries(TEASER_KEYS.map((k) => [k, text]));
const fake = (response: unknown): TranslationClient => ({ messages: { parse: (async () => response) as never } });
const throwing = (e: unknown): TranslationClient => ({ messages: { parse: (async () => { throw e; }) as never } });

afterEach(() => { vi.unstubAllEnvs(); });

describe("runTranslation: every way it can fail is an error, never an empty or partial translation", () => {
  it("a missing key is an error", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(runTranslation("s", "t", sent)).rejects.toThrow(/not configured/);
    vi.stubEnv("ANTHROPIC_API_KEY", "   ");
    await expect(runTranslation("s", "t", sent)).rejects.toThrow(/not configured/);
  });

  it("a refusal, a truncated answer and an unparseable answer are each an error", async () => {
    await expect(runTranslation("s", "t", sent, { client: fake({ stop_reason: "refusal", parsed_output: null }) })).rejects.toThrow(/declined/);
    await expect(runTranslation("s", "t", sent, { client: fake({ stop_reason: "max_tokens", parsed_output: null }) })).rejects.toThrow(/did not finish/);
    await expect(runTranslation("s", "t", sent, { client: fake({ stop_reason: "end_turn", parsed_output: null }) })).rejects.toThrow(/could not read/);
  });

  it("a response that fails the schema is an error even if the SDK let it through", async () => {
    const bad = { stop_reason: "end_turn", model: "m", parsed_output: { ...all("訳"), recommendation: "x" } };
    await expect(runTranslation("s", "t", sent, { client: fake(bad) })).rejects.toThrow(/could not read/);
  });

  it("a section that was sent but came back empty is an error", async () => {
    const r = { stop_reason: "end_turn", model: "m", parsed_output: { ...all("訳"), [sent[0]]: "  " } };
    await expect(runTranslation("s", "t", sent, { client: fake(r) })).rejects.toThrow(/without text for every section/);
  });

  it("the service's own errors become sentences written for a person, with no detail from the service", async () => {
    const h = new Headers();
    await expect(runTranslation("s", "t", sent, { client: throwing(new Anthropic.AuthenticationError(401, { secret: "sk-leak" }, "bad key sk-leak", h)) })).rejects.toThrow(/rejected this server's credentials/);
    await expect(runTranslation("s", "t", sent, { client: throwing(new Anthropic.RateLimitError(429, {}, "slow down", h)) })).rejects.toThrow(/busy/);
    const e = await runTranslation("s", "t", sent, { client: throwing(new Anthropic.InternalServerError(500, {}, "stack at db.internal", h)) }).catch((x) => x);
    expect(String(e.message)).toMatch(/could not be reached/);
    expect(String(e.message)).not.toMatch(/db\.internal|sk-leak/);
  });

  it("a good response returns exactly the sections that were sent, with the model that answered", async () => {
    const r = { stop_reason: "end_turn", model: "the-model", parsed_output: all("  訳  ") };
    const out = await runTranslation("s", "t", sent, { client: fake(r) });
    expect(out.model).toBe("the-model");
    expect(Object.keys(out.sections)).toEqual(sent);
    expect(Object.values(out.sections).every((v) => v === "訳")).toBe(true);
  });

  it("asks for ONE call carrying the schema, the pinned model and the whole Teaser", async () => {
    const parse = vi.fn(async () => ({ stop_reason: "end_turn", model: TRANSLATION_MODEL, parsed_output: all("訳") }));
    await runTranslation("SYSTEM", "TEASER", sent, { client: { messages: { parse } as never } });
    expect(parse).toHaveBeenCalledTimes(1);
    const arg = (parse.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(arg.model).toBe(TRANSLATION_MODEL);
    expect(arg.system).toBe("SYSTEM");
    expect(arg.messages).toEqual([{ role: "user", content: "TEASER" }]);
    expect(arg.output_config.format).toBeTruthy();
  });
});

describe("generateTranslationDraft", () => {
  function deps(over: Partial<GenerateDeps> = {}): GenerateDeps & { recorded: unknown[] } {
    const recorded: unknown[] = [];
    return {
      recorded,
      translate: async (_s, _t, keys) => ({ model: "m", sections: Object.fromEntries(keys.map((k) => [k, `${k}の訳`])) }),
      record: async (model, sections) => { recorded.push({ model, sections }); return { draftId: "d1", createdAt: "2026-10-06T00:00:00.000Z", createdByName: "A" }; },
      ...over,
    };
  }

  it("REFUSES a final memo, before any model call or any recording", async () => {
    const d = deps({ translate: vi.fn() as never });
    await expect(generateTranslationDraft({ status: "final", content: memo, overrides: {} }, d)).rejects.toThrow(/Only a draft memo can be translated/);
    expect(d.translate).not.toHaveBeenCalled();
    expect(d.recorded).toHaveLength(0);
  });

  it("records ONE row per call with the English source and the draft for every section sent, and returns the same", async () => {
    const d = deps();
    const out = await generateTranslationDraft({ status: "draft", content: memo, overrides: {} }, d);
    expect(d.recorded).toHaveLength(1);
    const rec = d.recorded[0] as { model: string; sections: Record<string, { source: string; draft: string }> };
    expect(Object.keys(rec.sections)).toEqual(sent);
    expect(out.sections.map((s) => s.key)).toEqual(sent);
    for (const s of out.sections) {
      expect(rec.sections[s.key]).toEqual({ source: s.source, draft: s.draft });
    }
    expect(out.draftId).toBe("d1");
  });

  it("checks every section's figures against its English, and a corrupted draft is flagged, not silently accepted", async () => {
    const d = deps({
      translate: async (_s, _t, keys) => ({
        model: "m",
        sections: Object.fromEntries(keys.map((k) => [k, buildTranslationSource(memo, {}).sections.find((s) => s.key === k)!.text.replace("14.2%", "14.9%")])),
      }),
    });
    const out = await generateTranslationDraft({ status: "draft", content: memo, overrides: {} }, d);
    const km = out.sections.find((s) => s.key === "key_metrics")!;
    expect(km.figures.ok).toBe(false);
    expect(km.figures.missing).toContain("14.2");
    expect(out.sections.find((s) => s.key === "location_market")!.figures.ok).toBe(true);
  });

  it("a translator failure records nothing", async () => {
    const d = deps({ translate: async () => { throw new Error("boom"); } });
    await expect(generateTranslationDraft({ status: "draft", content: memo, overrides: {} }, d)).rejects.toThrow("boom");
    expect(d.recorded).toHaveLength(0);
  });

  it("a Teaser with nothing to translate is an error, not an empty draft", async () => {
    const empty = JSON.parse(JSON.stringify(memo));
    for (const k of TEASER_KEYS) empty.sections[k] = { status: "empty", blocks: [], flags: [], emptyReason: "x" };
    const d = deps();
    await expect(generateTranslationDraft({ status: "draft", content: empty, overrides: {} }, d)).rejects.toThrow(/nothing recorded to translate/);
    expect(d.recorded).toHaveLength(0);
  });
});
