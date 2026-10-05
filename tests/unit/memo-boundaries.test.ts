// ============================================================================
// Where the memo generator is not allowed to reach, and how it renders states.
// ----------------------------------------------------------------------------
// A memo is a document that gets forwarded. These hold the lines that keep it
// honest and contained: nothing investor-facing reads it, nothing in it is written
// by a model, nothing location- or photo-shaped can get into it, and an empty
// section can never be mistaken for a populated or an edited one.
// ============================================================================
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { composeMemo, resolveSection, type MemoSource } from "@/lib/memo/compose";
import { SectionBody } from "@/components/memo/memo-blocks";
import { NO_PROJECTION, NO_ASSET } from "./memo-source.fixture";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const sql = (rel: string) => read(rel).replace(/--.*$/gm, "");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p.replace(ROOT + "/", ""));
  }
  return out;
}

const MEMO_FILES = [
  ...walk(join(ROOT, "src/lib/memo")), ...walk(join(ROOT, "src/components/memo")),
  "src/lib/data/memos.ts", "src/app/actions/memo.ts",
  "src/app/(app)/opportunities/[opportunityId]/memo/page.tsx",
  "src/app/(print)/opportunities/[opportunityId]/memo/print/page.tsx",
];

describe("no model, no network, no invented prose", () => {
  it.each(MEMO_FILES)("%s imports no language model and makes no outside call", (f) => {
    expect(code(f)).not.toMatch(/anthropic|openai|@ai-sdk|langchain|gemini|\bfetch\(|XMLHttpRequest|axios/i);
  });
});

describe("nothing investor-facing can reach a memo", () => {
  const investorFiles = [
    ...walk(join(ROOT, "src/app/(portal)")), ...walk(join(ROOT, "src/components/portal")), ...walk(join(ROOT, "src/lib/portal")),
    "src/lib/data/portal-feed.ts", "src/lib/data/investor-portal.ts", "src/app/actions/portal.ts", "src/app/actions/portal-access.ts",
    "src/lib/documents/secure-delivery.ts",
  ];
  it.each(investorFiles)("%s never mentions a memo", (f) => {
    expect(code(f)).not.toMatch(/\bmemos?\b|lib\/memo|MemoSource|composeMemo/i);
  });

  it("migration 0023 has staff policies only: no investor helper, no view, no function but the guard, no grant to anon", () => {
    const m = sql("supabase/migrations/0023_memos.sql");
    expect(m).not.toMatch(/investor|create\s+(or\s+replace\s+)?view|security\s+definer/i);
    expect([...m.matchAll(/create or replace function (app\.\w+)/g)].map((x) => x[1])).toEqual(["app.guard_memo"]);
    expect(m).toMatch(/revoke all on memos from anon, public/);
    for (const p of [...m.matchAll(/create policy (\w+) on memos for (\w+) to (\w+)\s+(?:using|with check)\s*\(([^;]*)\);/gi)]) {
      expect(p[3]).toBe("authenticated");
      expect(p[4]).toContain("app.has_org(org_id)");
    }
  });
});

describe("what a memo can read from the opportunity", () => {
  const data = code("src/lib/data/memos.ts");
  const load = data.slice(data.indexOf("export async function loadMemoSource"), data.indexOf("// ---- Stored memos"));

  it("loadMemoSource copies named fields; it never spreads a record and never names a location field", () => {
    expect(load).not.toMatch(/\.\.\.\s*opp\b|\.\.\.\s*o\b|Object\.assign|JSON\.parse\(JSON\.stringify\(opp/);
    expect(load).not.toMatch(/address|latitude|longitude|geocode|formatted|streetView|hasStreetView|broker|vendor|sourceContact|triage|referral|photo/i);
  });

  it("the memo modules import no geocoding, photograph or map code", () => {
    for (const f of MEMO_FILES) expect(code(f), f).not.toMatch(/@\/lib\/geo|@\/lib\/photos|property-photos|maps-loader|google/i);
  });
});

describe("the Asset Snapshot is the one place a memo may carry an address or a photograph", () => {
  const src = code("src/lib/data/snapshot-source.ts");

  it("the two reads live in one dedicated file, which only the memo loader imports", () => {
    const importers = walk(join(ROOT, "src")).filter((f) => /@\/lib\/data\/snapshot-source/.test(code(f)));
    expect(importers).toEqual(["src/lib/data/memos.ts"]);
  });

  it("a photograph is chosen only from those staff cleared for investors, in the investor card's order", () => {
    expect(src).toMatch(/pp\.visibility = 'diligence'/);
    expect(src).toMatch(/order by pp\.is_headline desc, pp\.sort_order, pp\.created_at, pp\.photo_id/);
    expect(src).not.toMatch(/visibility\s*(=|in|<>|!=)\s*'internal'|object_path/);
  });

  it("it reads no coordinates, geocode, broker, vendor, source contact or triage note", () => {
    expect(src).not.toMatch(/latitude|longitude|geocode|formatted_address|street_view|broker|vendor|source_contact|triage|referral/i);
  });

  it("the component makes no outside call and reaches photographs only through the staff-only delivery route", () => {
    const c = code("src/components/memo/asset-snapshot.tsx");
    expect(c).not.toMatch(/\bfetch\(|XMLHttpRequest|axios|@\/lib\/(db|data|photos|geo)/);
    expect([...c.matchAll(/\/api\/[\w-]+/g)].map((m) => m[0])).toEqual(["/api/asset-photos"]);
  });

  it("no investor-facing file reads the snapshot source or renders the snapshot", () => {
    const investorFiles = [
      ...walk(join(ROOT, "src/app/(portal)")), ...walk(join(ROOT, "src/components/portal")), ...walk(join(ROOT, "src/lib/portal")),
      "src/lib/data/portal-feed.ts", "src/lib/data/investor-portal.ts",
    ];
    for (const f of investorFiles) expect(code(f), f).not.toMatch(/snapshot-source|asset-snapshot|AssetSnapshot|composeSnapshot/);
  });
});

describe("the print view", () => {
  it("is behind the same session check as the application, and reads the stored memo, not today's rows", () => {
    expect(code("src/app/(print)/layout.tsx")).toContain("redirect(\"/sign-in\")");
    const page = code("src/app/(print)/opportunities/[opportunityId]/memo/print/page.tsx");
    expect(page).toContain("requireAuth()");
    expect(page).toContain("listMemos(");
    expect(page).not.toMatch(/composeLive|loadMemoSource|composeMemo\(/);
  });

  it("uses the browser's own print, and adds no PDF library", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /pdf|puppeteer|playwright-core|jspdf|html2canvas|react-to-print/i.test(d))).toEqual([]);
  });
});

describe("empty, composed and edited never look alike", () => {
  const src: MemoSource = {
    opportunity: { name: "A", market: "London", submarket: null, city: "London", country: "UK", assetType: "office", strategy: null, currency: "GBP", sizeSqft: null, sizeSqm: null, summary: null, projected: NO_PROJECTION },
    basis: { kind: "none", case: null }, risks: [], ddItems: [], decision: null, score: null, fx: null, fxLock: null, today: "2026-09-01", fxJpy: null, asset: NO_ASSET,
  };
  const memo = composeMemo(src);
  const html = (key: "executive_summary" | "location_market", override: string | null, format: "ic" | "teaser" = "teaser", surface: "workspace" | "print" = "workspace") =>
    renderToStaticMarkup(createElement(SectionBody, { resolved: resolveSection(memo.sections[key], override, format), currency: "GBP", format, surface }));

  it("an empty section is a dashed 'No data recorded' box and says why in the workspace; nothing else", () => {
    const h = html("executive_summary", null);
    expect(h).toContain("No data recorded");
    expect(h).toContain("border-dashed");
    expect(h).toContain("written by hand");
    expect(h).not.toContain("Source:");
  });

  it("in print the reason is left off and the box remains", () => {
    const h = html("executive_summary", null, "teaser", "print");
    expect(h).toContain("No data recorded");
    expect(h).not.toContain("written by hand");
  });

  it("a composed section names its source and never says 'No data recorded'", () => {
    const h = html("location_market", null);
    expect(h).toContain("Source: Opportunity record");
    expect(h).toContain("Market");
    expect(h).not.toContain("No data recorded");
    expect(h).not.toContain("border-dashed");
  });

  it("an edited section is the person's own text, verbatim, with no composed content beside it", () => {
    const h = html("location_market", "Written by me.");
    expect(h).toContain("Written by me.");
    expect(h).not.toContain("Source:");
    expect(h).not.toContain("Market");
    expect(h).not.toContain("No data recorded");
  });

  it("override text is rendered as text, never as markup", () => {
    const h = html("executive_summary", "<script>alert(1)</script><b>x</b>");
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });

  it("the three renderings are pairwise different", () => {
    const e = html("executive_summary", null), c = html("location_market", null), x = html("executive_summary", "Mine");
    expect(new Set([e, c, x]).size).toBe(3);
  });
});

describe("the print footer states the targets disclaimer for every external format and for none of the internal one", () => {
  const page = code("src/app/(print)/opportunities/[opportunityId]/memo/print/page.tsx");
  it("is chosen by format, from the same wording the investor portal carries", () => {
    expect(page).toContain("TARGETS_DISCLAIMER");
    expect(page).toContain("isExternalFormat(format)");
    expect(code("src/lib/memo/render.ts")).toContain("not forecasts or guarantees, and capital is at risk");
    expect(code("src/components/portal/opportunity-cards.tsx") + code("src/app/(portal)/portal/opportunities/[publicationId]/page.tsx")).toContain("not forecasts or guarantees");
  });
});
