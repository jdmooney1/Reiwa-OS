// ============================================================================
// Where the pre-finalisation reviewer is not allowed to reach.
// ----------------------------------------------------------------------------
// The memo generator's own boundary test (memo-boundaries.test.ts) says that
// nothing under src/lib/memo or src/components/memo imports a language model.
// That line does not move. This feature is a READER sitting outside it: it is
// handed the composed memo object and returns a list of things for a person to
// look at, and it can write nothing but its own audit row.
//
// So there are four lines to hold, and each has a section below:
//   1. the reviewer lives OUTSIDE the memo module tree, so the existing
//      no-model boundary stays literally true;
//   2. the prompt is built from the COMPOSED MEMO ONLY - no table, no session;
//   3. no path from a review reaches memos.content or memos.overrides, and
//      nothing about finalisation knows this feature exists;
//   4. it is administrator-only, and no investor, prospect or print surface can
//      reach the action, the panel or the table.
//
// NOTE ON THE HELPERS. These deliberately do not reuse the walk()/code() pair
// from the older boundary tests: that pair builds its relative paths with
// `p.replace(ROOT + "/", "")`, which does not match a Windows separator, so on
// Windows it yields absolute paths that join() then mangles and the assertions
// silently stop reading the files they name. The versions here use
// path.relative and normalise the separator, so they hold on either platform.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { reviewRefusalReason } from "@/lib/memo-review/eligibility";

const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const read = (r: string) => readFileSync(join(ROOT, r), "utf8");
/** File contents with comments stripped: a comment naming a forbidden thing is not a use of it. */
const code = (r: string) => read(r).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const sql = (r: string) => read(r).replace(/--.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(rel(p));
  }
  return out;
}

const REVIEW_LIB = walk(join(ROOT, "src/lib/memo-review"));
const REVIEW_UI = walk(join(ROOT, "src/components/memo-review"));
const ACTION = "src/app/actions/memo-review.ts";
const DATA = "src/lib/data/memo-reviews.ts";
const MIGRATION = "supabase/migrations/0030_memo_ai_reviews.sql";
/** Every file this feature added or touches on the server side. */
const ALL_REVIEW_FILES = [...REVIEW_LIB, ...REVIEW_UI, ACTION, DATA];

// ---------------------------------------------------------------------------

describe("the reviewer sits outside the memo module tree, so the no-model boundary there is untouched", () => {
  it("adds no file under src/lib/memo or src/components/memo", () => {
    for (const f of ALL_REVIEW_FILES) {
      expect(f.startsWith("src/lib/memo/"), f).toBe(false);
      expect(f.startsWith("src/components/memo/"), f).toBe(false);
    }
  });

  it("the memo module tree still imports no language model and makes no outside call", () => {
    const memoTree = [...walk(join(ROOT, "src/lib/memo")), ...walk(join(ROOT, "src/components/memo"))];
    for (const f of memoTree) {
      expect(code(f), f).not.toMatch(/anthropic|openai|@ai-sdk|langchain|gemini|\bfetch\(|XMLHttpRequest|axios/i);
    }
  });

  it("compose.ts is still the only thing that decides what a memo says", () => {
    // The workspace may render the panel; the composer may not know it exists.
    expect(code("src/lib/memo/compose.ts")).not.toMatch(/memo-review|memo_ai_reviews|reviewMemoAction|ReviewPanel/i);
  });
});

describe("the prompt is built from the composed memo and nothing else", () => {
  const prompt = code("src/lib/memo-review/prompt.ts");

  it("imports no database, data-layer, session or auth module", () => {
    expect(prompt).not.toMatch(/from "@\/lib\/(db|data|auth|supabase)\//);
    expect(prompt).not.toMatch(/from "pg"|withSession|adminQuery|createClient/);
  });

  it("contains no SQL of any kind", () => {
    expect(prompt).not.toMatch(/\bselect\s+[\w*]|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i);
  });

  it("makes no outside call and loads no model itself: it only returns text", () => {
    expect(prompt).not.toMatch(/\bfetch\(|XMLHttpRequest|axios|anthropic|openai/i);
  });

  it("takes its facts from the ComposedMemo object alone", () => {
    const imports = [...prompt.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["@/lib/memo-review/findings", "@/lib/memo/compose", "@/lib/memo/sections"]);
  });

  it("names no field a memo was never allowed to carry", () => {
    expect(prompt).not.toMatch(/latitude|longitude|geocode|formatted_address|street_view|broker|vendor|source_contact|triage|referral|investor_/i);
  });
});

describe("a review cannot change the memo it reviewed", () => {
  it("the action writes to no memo column by any statement", () => {
    expect(code(ACTION)).not.toMatch(/update\s+memos\b|insert\s+into\s+memos\b|delete\s+from\s+memos\b/i);
  });

  it("the action imports no function that writes a memo", () => {
    expect(code(ACTION)).not.toMatch(/setOverride|recomposeDraft|createMemoDraft|finalizeMemo|finaliseMemoFreezingAssets|composeLive/);
  });

  it("nothing in the feature assigns to content or overrides", () => {
    for (const f of ALL_REVIEW_FILES) {
      expect(code(f), f).not.toMatch(/\.content\s*=[^=]|\.overrides\s*=[^=]|overrides\[[^\]]*\]\s*=[^=]/);
    }
  });

  it("the data layer touches memo_ai_reviews and no other table", () => {
    const tables = [...code(DATA).matchAll(/\b(?:from|into|update|join)\s+([a-z_]+)\b/gi)].map((m) => m[1].toLowerCase());
    expect([...new Set(tables)]).toEqual(["memo_ai_reviews"]);
  });

  it("the data layer offers no update and no delete", () => {
    expect(code(DATA)).not.toMatch(/\bupdate\b|\bdelete\b/i);
  });

  it("the migration grants insert and select only: a review cannot be edited or tidied away", () => {
    const m = sql(MIGRATION);
    expect(m).toMatch(/grant select, insert on memo_ai_reviews to authenticated;/);
    expect(m).not.toMatch(/grant[^;]*\b(update|delete|truncate)\b[^;]*on memo_ai_reviews/i);
    expect(m).not.toMatch(/create policy[^;]*for (update|delete)/i);
  });
});

describe("the reviewer is not a gate: finalising does not know it exists", () => {
  it("the finalise action neither calls a review nor reads one", () => {
    expect(code("src/app/actions/memo.ts")).not.toMatch(/memo-review|memo_ai_reviews|reviewMemoAction|ReviewPanel/i);
  });

  it("the finalise control is unchanged by it", () => {
    expect(code("src/components/memo/memo-controls.tsx")).not.toMatch(/memo-review|memo_ai_reviews|reviewMemoAction|ReviewPanel/i);
  });

  it("the panel cannot disable, hide or guard anything: it renders only its own two controls", () => {
    const panel = code("src/components/memo-review/review-panel.tsx");
    expect(panel).not.toMatch(/FinalizeForm|finalizeMemoAction|disableFinalise|canFinalise|blockFinal/i);
  });

  it("the migration touches neither the memos table nor its guard", () => {
    const m = sql(MIGRATION);
    expect(m).not.toMatch(/alter table memos\b|guard_memo|drop trigger|create trigger/i);
  });
});

describe("administrator-only, and nothing investor-facing or printed can reach it", () => {
  it("the action is gated by requireAdminSession and refuses a memo that is not a draft", () => {
    const a = code(ACTION);
    expect(a).toContain("requireAdminSession()");
    expect(a).toContain("reviewRefusalReason(memo.status)");
    expect(a).toContain("if (refusal) throw new AppError(refusal);");
    // And the rule itself refuses, rather than merely being called.
    expect(reviewRefusalReason("final")).toBeTruthy();
    expect(reviewRefusalReason("draft")).toBeNull();
  });

  it("the page offers it to a Reiwa administrator only", () => {
    expect(code("src/app/(app)/opportunities/[opportunityId]/memo/page.tsx"))
      .toMatch(/canReview=\{auth\.role === "reiwa_admin"\}/);
  });

  it("no investor, portal or prospect file mentions the reviewer in any form", () => {
    const outward = [
      ...walk(join(ROOT, "src/app/(portal)")), ...walk(join(ROOT, "src/components/portal")),
      ...walk(join(ROOT, "src/lib/portal")),
      "src/lib/data/portal-feed.ts", "src/lib/data/investor-portal.ts",
      "src/app/actions/portal.ts", "src/app/actions/portal-access.ts",
      "src/lib/documents/secure-delivery.ts",
    ];
    for (const f of outward) {
      expect(code(f), f).not.toMatch(/memo-review|memo_ai_reviews|reviewMemoAction|ReviewPanel/i);
    }
  });

  it("the print view carries no finding: a review is never part of the document", () => {
    const print = code("src/app/(print)/opportunities/[opportunityId]/memo/print/page.tsx");
    expect(print).not.toMatch(/memo-review|memo_ai_reviews|reviewMemoAction|ReviewPanel/i);
  });

  it("the migration is administrator-only, with no investor route, no view and no definer", () => {
    const m = sql(MIGRATION);
    expect(m).not.toMatch(/investor|prospect|create\s+(or\s+replace\s+)?view|security\s+definer/i);
    expect(m).toMatch(/revoke all on memo_ai_reviews from anon, public;/);
    const policies = [...m.matchAll(/create policy (\w+) on memo_ai_reviews for (\w+) to (\w+)\s+(?:using|with check)\s*\(([^;]*)\);/gi)];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      expect(p[3]).toBe("authenticated");
      expect(p[4]).toContain("app.is_admin()");
    }
  });
});

describe("the key is server-side and the findings schema is closed", () => {
  it("the API key is read on the server only and never given a NEXT_PUBLIC_ prefix", () => {
    const client = code("src/lib/memo-review/review.ts");
    expect(client).toContain('import "server-only"');
    expect(client).toMatch(/process\.env\.ANTHROPIC_API_KEY/);
    expect(read("src/lib/memo-review/review.ts")).not.toMatch(/NEXT_PUBLIC_ANTHROPIC/);
    // The panel runs in the browser: it must not so much as name the key or the service.
    expect(code("src/components/memo-review/review-panel.tsx")).not.toMatch(/ANTHROPIC|anthropic|api[_-]?key/i);
  });

  it("a missing key is an error, never an empty review read as 'nothing found'", () => {
    expect(code("src/lib/memo-review/review.ts")).toMatch(/if \(!apiKey\)[\s\S]{0,160}throw new AppError/);
  });

  it("the response is schema-constrained, so a finding cannot come back as free prose", () => {
    expect(code("src/lib/memo-review/review.ts")).toMatch(/output_config:\s*\{\s*format:\s*zodOutputFormat\(ReviewSchema\)/);
  });

  it("a refusal and an unparseable answer both fail loudly rather than record an empty review", () => {
    const client = code("src/lib/memo-review/review.ts");
    expect(client).toMatch(/stop_reason === "refusal"[\s\S]{0,160}throw new AppError/);
    expect(client).toMatch(/!response\.parsed_output[\s\S]{0,160}throw new AppError/);
  });
});
