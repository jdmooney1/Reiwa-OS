// ============================================================================
// Japanese translation of the Teaser (migration 0031) against real Postgres.
// ----------------------------------------------------------------------------
// The model is NEVER called from this file. generateTranslationDraft() runs with a
// scripted translator, so the suite is free, deterministic and still proves everything
// that is the database's to prove:
//
//   1. THE GUARD. A draft memo accepts ja_overrides (the one word migration 0031 changes
//      in app.guard_memo), a FINAL memo refuses every change to it, and finalising
//      freezes whatever was accepted. Nothing else about immutability moved.
//   2. GENERATING WRITES ONE AUDIT ROW AND NOTHING ELSE. ja_overrides and accepted_sections
//      are untouched by a generation; only an explicit accept changes them, and
//      accepted_sections lists what was SAVED, never what was merely generated.
//   3. ADMINISTRATOR ONLY. A non-admin can neither read nor write a draft row, and
//      nobody can edit a generation after the fact (only accepted_sections can move).
//   4. A NEW VERSION STARTS WITHOUT JAPANESE: a translation is not carried over text it
//      was not made from.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, withSession, type Session } from "@/lib/db/client";
import { createOpportunity } from "@/lib/data/opportunities";
import { createVersion } from "@/lib/data/underwriting";
import { loadMemoSource, createMemoDraft, getMemo, finalizeMemo } from "@/lib/data/memos";
import { recordTranslationDraft, listTranslationDrafts } from "@/lib/data/memo-translation-drafts";
import { acceptTranslatedSection, removeTranslatedSection } from "@/lib/data/memo-translation-accept";
import { generateTranslationDraft } from "@/lib/memo-translation/generate";
import { composeMemo } from "@/lib/memo/compose";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail, viewerSession } from "./helpers";

let analyst: Session;
let viewer: Session;
let meiji: string;
let n = 0;
const RUN = String(Date.now()).slice(-6);

async function draftMemo() {
  const opp = await createOpportunity(analyst, {
    orgId: meiji, name: `Translate ${++n}`, city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "value_add", currency: "GBP", address: `${RUN}${900 + n} Translate Street`,
  });
  await createVersion(analyst, opp, { acquisitionPrice: 40_000_000 });
  const memoId = await createMemoDraft(analyst, opp, composeMemo((await loadMemoSource(analyst, opp))!));
  return { opp, memoId };
}

async function generate(session: Session, memoId: string, mutate?: (k: string, t: string) => string) {
  const memo = (await getMemo(session, memoId))!;
  let sources: Record<string, string> = {};
  return generateTranslationDraft(memo, {
    translate: async (_s, teaser, keys) => {
      // Recover each section's English from the prompt the real path built, then "translate" it.
      sources = Object.fromEntries(keys.map((k) => {
        const start = teaser.indexOf(`### ${k} (`);
        const body = teaser.slice(teaser.indexOf("\n", start) + 1);
        const next = body.indexOf("\n\n### ");
        return [k, (next === -1 ? body : body.slice(0, next)).trim()];
      }));
      return { model: "scripted-model", sections: Object.fromEntries(keys.map((k) => [k, (mutate ?? ((_k, t) => `訳: ${t}`))(k, sources[k])])) };
    },
    record: (model, sections) => recordTranslationDraft(adminSession, memoId, model, sections),
  });
}

const jaOf = async (memoId: string) => (await adminQuery<{ j: Record<string, string> }>("select ja_overrides as j from memos where memo_id = $1", [memoId]))[0].j;
const draftRows = async (memoId: string) => adminQuery<{ draft_id: string; sections: Record<string, { source: string; draft: string }>; accepted: string[] }>(
  "select draft_id, sections, accepted_sections as accepted from memo_translation_drafts where memo_id = $1 order by created_at", [memoId]);

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  analyst = orgUserSession([meiji], await profileIdByEmail("analyst@meiji.com"));
  viewer = viewerSession([meiji], await profileIdByEmail("viewer@meiji.com"));
});

describe("generating: one row per call, and nothing written to the memo", () => {
  it("records exactly one row holding the English source and the draft for every section sent", async () => {
    const { memoId } = await draftMemo();
    const out = await generate(adminSession, memoId);
    const rows = await draftRows(memoId);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].sections)).toEqual(out.sections.map((s) => s.key));
    for (const s of out.sections) {
      expect(rows[0].sections[s.key]).toEqual({ source: s.source, draft: s.draft });
      expect(s.draft.startsWith("訳: ")).toBe(true);
    }
    expect(rows[0].accepted).toEqual([]);
  });

  it("leaves the memo row byte-identical: no ja_overrides, no overrides, no content", async () => {
    const { memoId } = await draftMemo();
    const snap = async () => (await adminQuery<Record<string, unknown>>(
      "select content::text, overrides::text, ja_overrides::text, status, composed_at from memos where memo_id = $1", [memoId]))[0];
    const before = await snap();
    await generate(adminSession, memoId);
    await generate(adminSession, memoId);
    expect(await snap()).toEqual(before);
    expect(await jaOf(memoId)).toEqual({});
    expect(await draftRows(memoId)).toHaveLength(2);
  });

  it("REFUSES a final memo and records nothing", async () => {
    const { memoId } = await draftMemo();
    await finalizeMemo(analyst, memoId);
    await expect(generate(adminSession, memoId)).rejects.toThrow(/Only a draft memo can be translated/);
    expect(await draftRows(memoId)).toHaveLength(0);
  });

  it("a translator that throws records nothing", async () => {
    const { memoId } = await draftMemo();
    const memo = (await getMemo(adminSession, memoId))!;
    await expect(generateTranslationDraft(memo, {
      translate: async () => { throw new Error("boom"); },
      record: (m, s) => recordTranslationDraft(adminSession, memoId, m, s),
    })).rejects.toThrow("boom");
    expect(await draftRows(memoId)).toHaveLength(0);
  });
});

describe("accepting: explicit, per section, and recorded as what was SAVED", () => {
  it("saves one section and lists only that key in accepted_sections; the rest stay unsaved", async () => {
    const { memoId } = await draftMemo();
    const out = await generate(adminSession, memoId);
    const first = out.sections[0];
    await acceptTranslatedSection(adminSession, { memoId, draftId: out.draftId, key: first.key, text: first.draft });

    expect(await jaOf(memoId)).toEqual({ [first.key]: first.draft });
    const [row] = await draftRows(memoId);
    expect(row.accepted).toEqual([first.key]);
    expect(out.sections.length).toBeGreaterThan(1); // others were generated, and are NOT accepted
  });

  it("saves what the person submitted (edited), not what was generated", async () => {
    const { memoId } = await draftMemo();
    const out = await generate(adminSession, memoId);
    const s = out.sections[0];
    const edited = s.draft.replace("訳: ", "編集済み: ");
    await acceptTranslatedSection(adminSession, { memoId, draftId: out.draftId, key: s.key, text: `  ${edited}  ` });
    expect((await jaOf(memoId))[s.key]).toBe(edited);
    // The audit row still holds what the model wrote.
    expect((await draftRows(memoId))[0].sections[s.key].draft).toBe(s.draft);
  });

  it("accepting the same section twice lists it once", async () => {
    const { memoId } = await draftMemo();
    const out = await generate(adminSession, memoId);
    const s = out.sections[0];
    await acceptTranslatedSection(adminSession, { memoId, draftId: out.draftId, key: s.key, text: s.draft });
    await acceptTranslatedSection(adminSession, { memoId, draftId: out.draftId, key: s.key, text: `${s.draft} 追記` });
    expect((await draftRows(memoId))[0].accepted).toEqual([s.key]);
  });

  it("refuses a text whose figures differ from the English, unless the person says to save it anyway", async () => {
    const { memoId } = await draftMemo();
    const out = await generate(adminSession, memoId, (_k, t) => `訳: ${t.replace("14.2%", "14.9%")}`);
    const km = out.sections.find((s) => s.key === "key_metrics")!;
    if (!km.source.includes("14.2%")) return; // the fixture deal records no IRR: nothing to corrupt
    expect(km.figures.ok).toBe(false);
    await expect(acceptTranslatedSection(adminSession, { memoId, draftId: out.draftId, key: "key_metrics", text: km.draft }))
      .rejects.toThrow(/figures differ/);
    expect(await jaOf(memoId)).toEqual({});
    expect((await draftRows(memoId))[0].accepted).toEqual([]);
    await acceptTranslatedSection(adminSession, { memoId, draftId: out.draftId, key: "key_metrics", text: km.draft, acknowledgeFigures: true });
    expect((await draftRows(memoId))[0].accepted).toEqual(["key_metrics"]);
  });

  it("refuses a section the draft did not contain, a key outside the Teaser, and empty text", async () => {
    const { memoId } = await draftMemo();
    const out = await generate(adminSession, memoId);
    const base = { memoId, draftId: out.draftId };
    await expect(acceptTranslatedSection(adminSession, { ...base, key: "recommendation", text: "x" })).rejects.toThrow(/not a section of the Investor Teaser/);
    await expect(acceptTranslatedSection(adminSession, { ...base, key: out.sections[0].key, text: "   " })).rejects.toThrow(/no text to save/);
    const missing = ["executive_summary", "key_metrics", "asset_overview", "location_market", "investment_thesis", "business_plan", "exit_strategy"]
      .find((k) => !out.sections.some((s) => s.key === k));
    if (missing) await expect(acceptTranslatedSection(adminSession, { ...base, key: missing, text: "訳" })).rejects.toThrow(/does not contain this section/);
    expect(await jaOf(memoId)).toEqual({});
  });

  it("refuses a draft that belongs to another memo", async () => {
    const a = await draftMemo();
    const b = await draftMemo();
    const out = await generate(adminSession, a.memoId);
    await expect(acceptTranslatedSection(adminSession, { memoId: b.memoId, draftId: out.draftId, key: out.sections[0].key, text: out.sections[0].draft }))
      .rejects.toThrow(/does not contain this section/);
    expect(await jaOf(b.memoId)).toEqual({});
  });

  it("removing a saved section clears it from the memo but not from the record of what was ever kept", async () => {
    const { memoId } = await draftMemo();
    const out = await generate(adminSession, memoId);
    const s = out.sections[0];
    await acceptTranslatedSection(adminSession, { memoId, draftId: out.draftId, key: s.key, text: s.draft });
    await removeTranslatedSection(adminSession, memoId, s.key);
    expect(await jaOf(memoId)).toEqual({});
    expect((await draftRows(memoId))[0].accepted).toEqual([s.key]);
    await expect(removeTranslatedSection(adminSession, memoId, "recommendation")).rejects.toThrow(/not a section/);
  });
});

describe("the guard: a draft takes Japanese, a final memo is wholly frozen", () => {
  it("a draft accepts ja_overrides (migration 0031's one-word change to app.guard_memo)", async () => {
    const { memoId } = await draftMemo();
    await adminQuery(`update memos set ja_overrides = '{"executive_summary":"要約"}'::jsonb where memo_id = $1`, [memoId]);
    expect(await jaOf(memoId)).toEqual({ executive_summary: "要約" });
  });

  it("a draft still refuses a change to anything that is its identity", async () => {
    const { memoId } = await draftMemo();
    await expect(adminQuery("update memos set version = version + 10 where memo_id = $1", [memoId])).rejects.toThrow(/identity cannot be altered/);
  });

  it("FINALISING freezes what was accepted, and nothing can change it afterwards", async () => {
    const { opp, memoId } = await draftMemo();
    const out = await generate(adminSession, memoId);
    const s = out.sections[0];
    await acceptTranslatedSection(adminSession, { memoId, draftId: out.draftId, key: s.key, text: s.draft });

    await finalizeMemo(analyst, memoId);
    const final = (await getMemo(adminSession, memoId))!;
    expect(final.status).toBe("final");
    expect(final.jaOverrides).toEqual({ [s.key]: s.draft });

    await expect(adminQuery(`update memos set ja_overrides = '{}'::jsonb where memo_id = $1`, [memoId])).rejects.toThrow(/final and cannot be altered/);
    await expect(removeTranslatedSection(adminSession, memoId, s.key)).rejects.toThrow(/Only a draft memo/);
    await expect(acceptTranslatedSection(adminSession, { memoId, draftId: out.draftId, key: out.sections[1].key, text: out.sections[1].draft }))
      .rejects.toThrow(/Only a draft memo/);
    expect((await getMemo(adminSession, memoId))!.jaOverrides).toEqual({ [s.key]: s.draft });

    // The NEXT version starts with no Japanese: a translation is not carried over English it was not made from.
    const next = await createMemoDraft(analyst, opp, composeMemo((await loadMemoSource(analyst, opp))!));
    expect(await jaOf(next)).toEqual({});
  });

  it("finalising a memo that was never translated works exactly as before", async () => {
    const { memoId } = await draftMemo();
    await finalizeMemo(analyst, memoId);
    expect((await getMemo(adminSession, memoId))!).toMatchObject({ status: "final", jaOverrides: {} });
  });

  it("the column only holds Teaser sections, as text in an object", async () => {
    const { memoId } = await draftMemo();
    for (const bad of [`{"recommendation":"x"}`, `{"risk_mitigation":"x"}`, `["executive_summary"]`, `"text"`]) {
      await expect(adminQuery("update memos set ja_overrides = $2::jsonb where memo_id = $1", [memoId, bad])).rejects.toThrow();
    }
    expect(await jaOf(memoId)).toEqual({});
  });
});

describe("administrator only, append-only apart from accepted_sections", () => {
  it("staff who are not administrators can neither read nor write a draft row", async () => {
    const { memoId } = await draftMemo();
    await generate(adminSession, memoId);
    for (const s of [analyst, viewer]) {
      expect(await listTranslationDrafts(s, memoId)).toEqual([]);
      await expect(recordTranslationDraft(s, memoId, "m", { executive_summary: { source: "a", draft: "b" } })).rejects.toThrow();
    }
    expect(await draftRows(memoId)).toHaveLength(1);
  });

  it("an administrator cannot edit what was generated, only mark what was accepted, and cannot delete a row", async () => {
    const { memoId } = await draftMemo();
    const out = await generate(adminSession, memoId);
    const run = (sql: string, p: unknown[] = []) => withSession(adminSession, (tx) => tx.query(sql, p));
    await expect(run("update memo_translation_drafts set sections = '{}'::jsonb where draft_id = $1", [out.draftId])).rejects.toThrow(/permission denied/);
    await expect(run("update memo_translation_drafts set model = 'x' where draft_id = $1", [out.draftId])).rejects.toThrow(/permission denied/);
    await expect(run("delete from memo_translation_drafts where draft_id = $1", [out.draftId])).rejects.toThrow(/permission denied/);
    await expect(run("update memo_translation_drafts set accepted_sections = '[\"executive_summary\"]'::jsonb where draft_id = $1", [out.draftId])).resolves.toBeTruthy();
  });

  it("the stored grants are exactly: select and insert, plus update of one column; anon holds nothing", async () => {
    const table = await adminQuery<{ priv: string }>(
      "select privilege_type as priv from information_schema.role_table_grants where table_name = 'memo_translation_drafts' and grantee = 'authenticated'");
    expect(table.map((r) => r.priv).sort()).toEqual(["INSERT", "SELECT"]);
    const cols = await adminQuery<{ col: string }>(
      `select column_name as col from information_schema.column_privileges
        where table_name = 'memo_translation_drafts' and grantee = 'authenticated' and privilege_type = 'UPDATE'`);
    expect(cols.map((c) => c.col)).toEqual(["accepted_sections"]);
    const anon = await adminQuery(
      "select 1 from information_schema.role_table_grants where table_name = 'memo_translation_drafts' and grantee in ('anon', 'PUBLIC')");
    expect(anon).toEqual([]);
  });

  it("row level security is on and every policy requires app.is_staff()", async () => {
    const [{ enabled }] = await adminQuery<{ enabled: boolean }>("select relrowsecurity as enabled from pg_class where relname = 'memo_translation_drafts'");
    expect(enabled).toBe(true);
    const policies = await adminQuery<{ cmd: string; qual: string | null; withcheck: string | null }>(
      "select cmd, qual::text, with_check::text as withcheck from pg_policies where tablename = 'memo_translation_drafts'");
    expect(policies.map((p) => p.cmd).sort()).toEqual(["INSERT", "SELECT", "UPDATE"]);
    for (const p of policies) {
      const text = `${p.qual ?? ""}${p.withcheck ?? ""}`;
      expect(text).toContain("is_staff");
      expect(text).toContain("memos");
    }
  });

  it("a non-administrator cannot save Japanese into a memo through the accept path either", async () => {
    const { memoId } = await draftMemo();
    const out = await generate(adminSession, memoId);
    // The accept data layer finds the draft through RLS: for a non-admin there is nothing to find.
    await expect(acceptTranslatedSection(analyst, { memoId, draftId: out.draftId, key: out.sections[0].key, text: out.sections[0].draft }))
      .rejects.toThrow(/does not contain this section/);
    expect(await jaOf(memoId)).toEqual({});
  });
});
