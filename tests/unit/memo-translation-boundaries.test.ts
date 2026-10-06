// ============================================================================
// Where the Teaser translator is not allowed to reach, and what it must never do.
// ----------------------------------------------------------------------------
// Same shape as memo-review-boundaries.test.ts, for the same reasons. Five lines to hold:
//   1. it lives OUTSIDE the memo module tree, so "nothing under src/lib/memo imports a
//      language model" stays literally true;
//   2. what the model is shown is built from the COMPOSED Teaser only: no table, no session;
//   3. generating can write only its own audit row. memos.ja_overrides has exactly ONE
//      writer, the accept module, which generation cannot reach;
//   4. administrator-only, and no investor, prospect or finalisation path knows it exists;
//   5. the database change is exactly as small as it says it is.
// Helpers use path.relative, so they read the files they name on Windows as well.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const read = (r: string) => readFileSync(join(ROOT, r), "utf8");
const code = (r: string) => read(r).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const sql = (r: string) => read(r).replace(/--.*$/gm, "");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(rel(p));
  }
  return out;
}
const importsOf = (r: string) => [...code(r).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

const LIB = walk(join(ROOT, "src/lib/memo-translation"));
const UI = walk(join(ROOT, "src/components/memo-translation"));
const GENERATE_ACTION = "src/app/actions/memo-translation.ts";
const ACCEPT_ACTION = "src/app/actions/memo-translation-accept.ts";
const DRAFTS = "src/lib/data/memo-translation-drafts.ts";
const ACCEPT = "src/lib/data/memo-translation-accept.ts";
const MIGRATION = "supabase/migrations/0031_memo_ja_translation.sql";
const ALL = [...LIB, ...UI, GENERATE_ACTION, ACCEPT_ACTION, DRAFTS, ACCEPT];

/** The modules that only turn text into text: nothing in them may reach data, a session or a model. */
const PURE = ["sections", "numbers", "eligibility", "source", "prompt", "schema", "generate", "japanese"].map((n) => `src/lib/memo-translation/${n}.ts`);

describe("it sits outside the memo module tree, so the no-model boundary there is untouched", () => {
  it("adds no file under src/lib/memo or src/components/memo", () => {
    for (const f of ALL) {
      expect(f.startsWith("src/lib/memo/"), f).toBe(false);
      expect(f.startsWith("src/components/memo/"), f).toBe(false);
    }
  });

  it("the memo tree still imports no language model; it may import only the pure Japanese view helper", () => {
    const tree = [...walk(join(ROOT, "src/lib/memo")), ...walk(join(ROOT, "src/components/memo"))];
    for (const f of tree) expect(code(f), f).not.toMatch(/anthropic|openai|@ai-sdk|langchain|gemini|\bfetch\(|XMLHttpRequest|axios/i);
    const print = "src/app/(print)/opportunities/[opportunityId]/memo/print/page.tsx";
    const touching = (f: string) => importsOf(f).filter((s) => s.includes("memo-translation"));
    expect(touching(print)).toEqual(["@/lib/memo-translation/japanese"]);
    const ws = touching("src/components/memo/memo-workspace.tsx");
    expect(ws.sort()).toEqual(["@/components/memo-translation/translation-panel", "@/lib/memo-translation/japanese"]);
    expect(code("src/lib/memo/compose.ts")).not.toMatch(/memo-translation|memo_translation|ja_overrides|translateMemoAction/i);
  });
});

describe("what the model is shown is built from the composed Teaser alone", () => {
  it.each(PURE)("%s imports no database, data, session, auth or model code", (f) => {
    for (const spec of importsOf(f)) {
      expect(spec, f).not.toMatch(/@\/lib\/(db|data|auth|supabase)\/|^pg$|anthropic|server-only|zod\/.*client/i);
    }
    expect(code(f), f).not.toMatch(/withSession|adminQuery|\bfetch\(|XMLHttpRequest|axios|process\.env/);
  });

  it("the source builder contains no SQL and takes its facts from the composed memo and the sections list", () => {
    const src = code("src/lib/memo-translation/source.ts");
    expect(src).not.toMatch(/\bselect\s+[\w*]|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i);
    expect(importsOf("src/lib/memo-translation/source.ts").sort()).toEqual([
      "@/lib/memo-translation/sections", "@/lib/memo/compose", "@/lib/memo/render", "@/lib/memo/sections",
    ]);
  });

  it("names no field a memo was never allowed to carry, and no section outside the Teaser", () => {
    for (const f of ["source", "prompt"].map((n) => `src/lib/memo-translation/${n}.ts`)) {
      expect(code(f), f).not.toMatch(/latitude|longitude|geocode|street_view|broker|vendor|source_contact|triage|referral|investor_|snapshot|recommendation|risk_mitigation|tax_structuring|further_dd/i);
    }
  });

  it("only translate.ts touches the SDK, and only server-side", () => {
    const withSdk = LIB.filter((f) => /@anthropic-ai\/sdk/.test(code(f)));
    expect(withSdk).toEqual(["src/lib/memo-translation/translate.ts"]);
    expect(code("src/lib/memo-translation/translate.ts")).toContain('import "server-only"');
  });
});

describe("generating writes its own audit row and nothing else", () => {
  it("the generate action reaches no writer of a memo, and not the accept module", () => {
    const a = code(GENERATE_ACTION);
    expect(a).not.toMatch(/setOverride|recomposeDraft|createMemoDraft|finalizeMemo|finaliseMemoFreezingAssets|composeLive/);
    expect(a).not.toMatch(/memo-translation-accept|acceptTranslat|removeTranslat/);
    expect(a).not.toMatch(/update\s+memos\b|insert\s+into\s+memos\b|delete\s+from\s+memos\b|ja_overrides|jaOverrides/i);
    expect(a).not.toMatch(/revalidatePath/);
  });

  it("the generation data layer touches memo_translation_drafts and no other table, and never updates or deletes", () => {
    const d = code(DRAFTS);
    const tables = [...d.matchAll(/\b(?:from|into|update|join)\s+([a-z_]+)\b/gi)].map((m) => m[1].toLowerCase()).filter((t) => t !== "import");
    expect([...new Set(tables)]).toEqual(["memo_translation_drafts"]);
    expect(d).not.toMatch(/\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i);
    expect(d).not.toMatch(/ja_overrides|\bmemos\b/);
  });

  it("memos.ja_overrides has exactly ONE writer in the whole source tree: the accept module", () => {
    const mentions = walk(join(ROOT, "src")).filter((f) => /ja_overrides/.test(code(f)));
    expect(mentions.sort()).toEqual(["src/lib/data/memo-translation-accept.ts", "src/lib/data/memos.ts"]);
    // memos.ts only READS it (select * then parse); the insert that starts a new version does not carry it.
    const memos = code("src/lib/data/memos.ts");
    expect(memos).not.toMatch(/set\s+ja_overrides|ja_overrides\s*=|ja_overrides\s*\|\||ja_overrides\s*-/i);
    const create = memos.slice(memos.indexOf("export async function createMemoDraft"), memos.indexOf("export async function recomposeDraft"));
    expect(create).not.toMatch(/ja_overrides|jaOverrides/);
  });

  it("the accept module writes only on an explicit call: one section, a draft memo only, never a model", () => {
    const a = code(ACCEPT);
    expect(importsOf(ACCEPT).some((s) => /anthropic|translate|generate/.test(s))).toBe(false);
    expect(a).toMatch(/status = 'draft'/);
    expect(a).toMatch(/isTeaserKey\(/);
    // It is handed the text the person submitted; it never reads a draft back as the thing to save.
    expect(a).not.toMatch(/sections\?*\.\[input\.key\]\??\.draft/);
  });

  it("the accept action imports no model and no generator", () => {
    expect(importsOf(ACCEPT_ACTION).some((s) => /anthropic|memo-translation\/(translate|generate)|actions\/memo-translation$/.test(s))).toBe(false);
  });

  it("the panel never saves by itself: no effect, no accept-all, accept only from a button press", () => {
    const p = code("src/components/memo-translation/translation-panel.tsx");
    expect(p).not.toMatch(/useEffect|acceptAll|saveAll|autoAccept/i);
    expect(p.match(/acceptTranslationAction\(/g)).toHaveLength(1);
    expect(p).toMatch(/async function accept\(\)/);
    expect(p).toMatch(/onClick=\{accept\}/);
    // The figures acknowledgement is derived from the live check, never hard-coded true.
    expect(p).toMatch(/acceptTranslationAction\(opportunityId, memoId, draftId, section\.key, text, problem !== null\)/);
  });

  it("the panel never names the service or a key", () => {
    expect(code("src/components/memo-translation/translation-panel.tsx")).not.toMatch(/ANTHROPIC|anthropic|api[_-]?key/i);
  });
});

describe("administrator-only, and nothing outward-facing or finalising can reach it", () => {
  it("both actions are gated by requireAdminSession before anything else", () => {
    for (const f of [GENERATE_ACTION, ACCEPT_ACTION]) {
      const a = code(f);
      expect(a, f).toContain("requireAdminSession()");
      for (const m of a.matchAll(/export async function \w+\([^)]*\)[^{]*\{\s*const \{ db \} = await requireAdminSession\(\);/g)) expect(m[0]).toBeTruthy();
      expect((a.match(/export async function/g) ?? []).length, f).toBe((a.match(/await requireAdminSession\(\)/g) ?? []).length);
    }
  });

  it("the generate action refuses a final memo through the shared rule", () => {
    expect(code("src/lib/memo-translation/generate.ts")).toContain("translationRefusalReason(memo.status)");
    expect(code("src/lib/memo-translation/generate.ts")).toContain("if (refusal) throw new AppError(refusal);");
  });

  it("the page offers it to a Reiwa administrator only", () => {
    expect(code("src/app/(app)/opportunities/[opportunityId]/memo/page.tsx")).toMatch(/canTranslate=\{auth\.role === "reiwa_admin"\}/);
  });

  it("the panel is shown on a draft's Teaser view and nowhere else", () => {
    expect(code("src/components/memo/memo-workspace.tsx")).toMatch(/editable && canTranslate && format === "teaser" && memo/);
  });

  it("no investor, portal, prospect or deal-share file mentions translation or Japanese drafts", () => {
    const outward = [
      ...walk(join(ROOT, "src/app/(portal)")), ...walk(join(ROOT, "src/components/portal")), ...walk(join(ROOT, "src/lib/portal")),
      ...walk(join(ROOT, "src/app/(prospect)")), ...walk(join(ROOT, "src/components/deal-share")), ...walk(join(ROOT, "src/lib/deal-share")),
      "src/lib/data/portal-feed.ts", "src/lib/data/investor-portal.ts", "src/lib/data/deal-share-access.ts", "src/lib/data/deal-shares.ts",
      "src/app/actions/portal.ts", "src/app/actions/portal-access.ts", "src/app/actions/deal-shares.ts",
      "src/lib/documents/secure-delivery.ts",
    ];
    for (const f of outward) expect(code(f), f).not.toMatch(/memo-translation|memo_translation|ja_overrides|jaOverrides|translateMemoAction|TranslationPanel/i);
  });

  it("finalising neither calls a translation nor reads one: it works the same with or without", () => {
    for (const f of ["src/app/actions/memo.ts", "src/components/memo/memo-controls.tsx", "src/lib/data/memo-assets.ts"]) {
      expect(code(f), f).not.toMatch(/memo-translation|memo_translation|ja_overrides|jaOverrides|translateMemoAction|TranslationPanel/i);
    }
  });

  it("the only thing the print view takes from it is the pure reading helper", () => {
    expect(code("src/app/(print)/opportunities/[opportunityId]/memo/print/page.tsx")).not.toMatch(/translateMemoAction|TranslationPanel|memo_translation_drafts|acceptTranslat/);
  });
});

describe("the key is server-side and a failure is never an empty translation", () => {
  const t = code("src/lib/memo-translation/translate.ts");
  it("ANTHROPIC_API_KEY is read on the server and never given a NEXT_PUBLIC_ prefix", () => {
    expect(t).toMatch(/process\.env\.ANTHROPIC_API_KEY/);
    expect(read("src/lib/memo-translation/translate.ts")).not.toMatch(/NEXT_PUBLIC_ANTHROPIC/);
  });
  it("a missing key is an error", () => {
    expect(t).toMatch(/if \(!apiKey\)[\s\S]{0,200}throw new AppError/);
  });
  it("the answer is schema-constrained, and a refusal, truncation or unparseable answer each throw", () => {
    expect(t).toMatch(/output_config:\s*\{\s*format:\s*zodOutputFormat\(TranslationSchema\)/);
    expect(t).toMatch(/stop_reason === "refusal"[\s\S]{0,160}throw new AppError/);
    expect(t).toMatch(/stop_reason === "max_tokens"[\s\S]{0,160}throw new AppError/);
    expect(t).toMatch(/!response\.parsed_output[\s\S]{0,160}throw new AppError/);
  });
  it("it is one call for the whole Teaser, not one per section", () => {
    expect(t.match(/\.parse\(/g)).toHaveLength(1);
    expect(t).not.toMatch(/for \(const[^)]*\)[^{]*\{[\s\S]{0,200}\.parse\(/);
  });
});

describe("the database change is as small as claimed", () => {
  const m = sql(MIGRATION);

  it("guard_memo is 0023's, with ja_overrides added to the draft-editable list and NOTHING else changed", () => {
    const body = (text: string) => {
      const start = text.indexOf("create or replace function app.guard_memo()");
      const end = text.indexOf("$fn$;", text.indexOf("$fn$", start) + 4);
      return text.slice(start, end).split("\n").map((l) => l.trim()).filter(Boolean);
    };
    const before = body(sql("supabase/migrations/0023_memos.sql"));
    const after = body(m);
    expect(after.length).toBe(before.length);
    const changed = after.map((l, i) => [before[i], l]).filter(([b, a]) => b !== a);
    expect(changed).toEqual([[
      "editable  text[] := array['content', 'overrides', 'composed_at'];",
      "editable  text[] := array['content', 'overrides', 'ja_overrides', 'composed_at'];",
    ]]);
  });

  it("the finalised and delete branches are untouched, so a final memo is still wholly immutable", () => {
    expect(m).toContain("raise exception 'Memo % is final and cannot be altered; create a new version instead', old.memo_id;");
    expect(m).toContain("raise exception 'Memo % is final and cannot be deleted', old.memo_id;");
    expect(m).toContain("(to_jsonb(old) - finalising) <> (to_jsonb(new) - finalising)");
    expect(m).toMatch(/revoke execute on function app\.guard_memo\(\) from public, anon, authenticated;/);
    expect(m).not.toMatch(/drop trigger|create trigger/i);
  });

  it("the column holds Teaser keys only, as an object, with a default of {}", () => {
    expect(m).toMatch(/add column if not exists ja_overrides jsonb not null default '\{\}'::jsonb/);
    expect(m).toMatch(/jsonb_typeof\(ja_overrides\) = 'object'/);
    for (const k of ["executive_summary", "key_metrics", "asset_overview", "location_market", "investment_thesis", "business_plan", "exit_strategy"]) {
      expect(m).toContain(`'${k}'`);
    }
    for (const k of ["recommendation", "risk_mitigation", "tax_structuring", "further_dd", "financial_analysis", "japan_rationale", "capex_plan"]) {
      expect(m).not.toContain(`'${k}'`);
    }
  });

  it("the audit table is administrator-only, with no delete and one updatable column", () => {
    expect(m).toMatch(/revoke all on memo_translation_drafts from anon, public;/);
    expect(m).toMatch(/grant select, insert on memo_translation_drafts to authenticated;/);
    expect(m).toMatch(/grant update \(accepted_sections\) on memo_translation_drafts to authenticated;/);
    expect(m).not.toMatch(/grant[^;]*\bdelete\b[^;]*on memo_translation_drafts/i);
    expect(m).not.toMatch(/create policy[^;]*for delete/i);
    // ("Investor Teaser" is the document's name; what must be absent is any investor TABLE or prospect route.)
    expect(m).not.toMatch(/investor_|prospect|deal_share|create\s+(or\s+replace\s+)?view|security\s+definer/i);
    const policies = [...m.matchAll(/create policy (\w+) on memo_translation_drafts for (\w+) to (\w+)\s+(?:using|with check)\s*\(([^;]*)\)/gi)];
    expect(policies.length).toBe(3);
    for (const p of policies) {
      expect(p[3]).toBe("authenticated");
      expect(p[4]).toContain("app.is_admin()");
    }
  });
});
