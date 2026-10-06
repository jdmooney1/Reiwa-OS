// ============================================================================
// Where the prospect surface is NOT allowed to reach, and what it must carry.
// ----------------------------------------------------------------------------
// The prospect page has no session and runs on the privileged connection, so the CODE is
// the boundary. These hold it in the same allow-list style as memo-boundaries.test.ts:
// the surface reads deal_shares and memos, writes one row into deal_share_views, imports
// from a short list of modules, calls no session or request API, and never logs a token.
// ============================================================================
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { composeMemo } from "@/lib/memo/compose";
import { prospectSnapshot, prospectTeaser } from "@/lib/deal-share/document";
import { ProspectDocument } from "@/components/deal-share/prospect-document";
import { snapshotSource } from "./memo-source.fixture";

const ROOT = process.cwd();
// Repo-relative on either platform. The old idiom here stripped the prefix with
// a string replace of ROOT plus a forward slash, which matches nothing on
// Windows, where the separator is a backslash. Every path therefore stayed
// absolute, join(ROOT, <absolute>) then produced nonsense, and these boundary
// assertions stopped reading the files they name.
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const sql = (rel: string) => read(rel).replace(/--.*$/gm, "");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(rel(p));
  }
  return out;
}

const ROUTE_FILES = [
  "src/app/(prospect)/layout.tsx", "src/app/(prospect)/not-found.tsx",
  "src/app/(prospect)/deal/[token]/page.tsx", "src/app/(prospect)/deal/[token]/image/[slot]/route.ts",
];
const ACCESS = "src/lib/data/deal-share-access.ts";
const PURE = walk(join(ROOT, "src/lib/deal-share"));
const COMPONENT = "src/components/deal-share/prospect-document.tsx";
const SURFACE = [...ROUTE_FILES, ACCESS, ...PURE, COMPONENT];
const ADMIN = ["src/lib/data/deal-shares.ts", "src/app/actions/deal-shares.ts"];

const importsOf = (rel: string) => [...code(rel).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

describe("the prospect route reaches deal_shares and memos, and nothing else", () => {
  // Only the SQL: the template-literal strings handed to the database.
  const q = [...code(ACCESS).matchAll(/`([^`]*)`/g)].map((m) => m[1]).join("\n");
  const tables = (re: RegExp) => [...new Set([...q.matchAll(re)].map((m) => m[1]))].sort();

  it("READS exactly deal_shares and memos (the memo is joined once per document)", () => {
    expect(tables(/\b(?:from|join)\s+([a-z_][a-z_.]*)/gi).filter((t) => !["s", "sm", "tm"].includes(t))).toEqual(["deal_shares", "memos"]);
  });

  it("WRITES one table, by one insert, and updates and deletes nothing", () => {
    expect(tables(/\binsert\s+into\s+([a-z_]+)/gi)).toEqual(["deal_share_views"]);
    expect(q).not.toMatch(/\b(update|delete)\s+(from\s+)?[a-z_]+\s/i);
    expect(q.match(/insert\s+into/gi)).toHaveLength(1);
  });

  it("names no live table, photograph, location or investor table anywhere in its SQL", () => {
    expect(q).not.toMatch(/\bopportunities\b|investment_cases|property_photos|\bproperties\b|\bassets\b|investor_|publication|profiles|fx_rates|ic_decisions|opportunity_(risks|dd_items|documents)/i);
  });

  it("imports only an allow-list of modules, none of them an investor, photo, geo, session or live-data module", () => {
    const allowed = new Set([
      "@/lib/db/client", "@/lib/deal-share/token", "@/lib/deal-share/document", "@/lib/memo/assets",
      "@/lib/memo/assets-store", "@/lib/memo/snapshot-images",
    ]);
    for (const spec of importsOf(ACCESS)) expect(allowed.has(spec), spec).toBe(true);
  });
});

describe("the whole prospect surface", () => {
  it.each(SURFACE)("%s has no session, no cookies, no request headers and no investor, photo, geo or live-data import", (f) => {
    expect(code(f)).not.toMatch(/getSession|requireAuth|requireAdmin|requireDbSession|toDbSession|from "next\/headers"|cookies\(|headers\(\)/);
    for (const spec of importsOf(f)) {
      expect(spec, f).not.toMatch(/investor|portal|@\/lib\/photos|@\/lib\/geo|property-photos|snapshot-source|@\/lib\/(auth|supabase)|@\/lib\/data\/(?!deal-share-access)/i);
    }
    // The old identifiers too: nothing here may even name an investor table or the investor address.
    expect(code(f)).not.toMatch(/investor_|INVESTOR_PORTAL_URL|withInvestorSession/);
  });

  it.each(SURFACE)("%s makes no outside call and imports no language model", (f) => {
    expect(code(f)).not.toMatch(/\bfetch\(|XMLHttpRequest|axios|anthropic|openai/i);
  });

  it("the page and the picture route import the access layer and nothing else of ours that reads data", () => {
    for (const f of ["src/app/(prospect)/deal/[token]/page.tsx", "src/app/(prospect)/deal/[token]/image/[slot]/route.ts"]) {
      const own = importsOf(f).filter((s) => s.startsWith("@/lib/") || s.startsWith("@/components/"));
      for (const s of own) expect(["@/lib/data/deal-share-access", "@/components/deal-share/prospect-document", "@/lib/errors"], s).toContain(s);
    }
  });

  it("is a fourth route group: nothing under (app), (portal) or (print) is imported by it", () => {
    for (const f of SURFACE) expect(code(f)).not.toMatch(/@\/app\/\((app|portal|print)\)/);
  });
});

describe("nothing else reaches the prospect surface, and the investor surfaces never mention it", () => {
  it("only the page, the picture route and the admin layer use the prospect modules", () => {
    const importers = walk(join(ROOT, "src")).filter((f) => !SURFACE.includes(f) && /@\/lib\/data\/deal-share-access|@\/components\/deal-share\//.test(code(f)));
    expect(importers).toEqual([]);
  });

  const investorFiles = [
    ...walk(join(ROOT, "src/app/(portal)")), ...walk(join(ROOT, "src/components/portal")), ...walk(join(ROOT, "src/lib/portal")),
    "src/lib/data/portal-feed.ts", "src/lib/data/investor-portal.ts", "src/lib/data/investor-invites.ts",
    "src/app/actions/portal.ts", "src/app/actions/portal-access.ts", "src/app/actions/admin-invites.ts",
  ];
  it.each(investorFiles)("%s never mentions a deal share", (f) => {
    expect(code(f)).not.toMatch(/deal[-_]?share|prospect/i);
  });

  it("migration 0029 adds no investor reference, no view, no function and no grant to anon", () => {
    const m = sql("supabase/migrations/0029_deal_shares.sql");
    expect(m).not.toMatch(/investor_|create\s+(or\s+replace\s+)?(view|function)|security\s+definer/i);
    expect(m).toMatch(/revoke all on deal_shares, deal_share_views from anon, public/);
    for (const p of [...m.matchAll(/create policy (\w+) on (\w+) for (\w+) to (\w+)\s+using \(([^;]*)\)/gi)]) {
      expect(p[4]).toBe("authenticated");
      expect(p[5]).toContain("app.is_admin()");
    }
  });
});

describe("the raw token is never stored and never logged", () => {
  it("the migration has a hash column and no column that could hold the token", () => {
    const m = sql("supabase/migrations/0029_deal_shares.sql");
    expect(m).toMatch(/token_hash\s+text not null unique/);
    expect(m).not.toMatch(/\braw_token\b|\btoken\s+text|\bsecret\b/i);
  });

  it("no file of the feature logs, prints or reports a token", () => {
    for (const f of [...SURFACE, ...ADMIN, "src/components/admin/deal-share-form.tsx", "src/components/admin/deal-share-revoke.tsx"]) {
      const c = code(f);
      expect(c, f).not.toMatch(/console\.\w+\(/);
      // Every reportError(...) call: its argument list never mentions a token.
      for (const m of c.matchAll(/reportError\(([^;]*)\);/g)) expect(m[1], f).not.toMatch(/token/i);
      for (const m of c.matchAll(/runAction\(([^{]*)\{([^}]*)\}/g)) expect(m[2], f).not.toMatch(/token/i);
    }
  });

  it("the insert of a share binds the HASH, and the raw token is only minted and returned", () => {
    const c = code("src/lib/data/deal-shares.ts");
    const insert = c.slice(c.indexOf("insert into deal_shares"), c.indexOf("returning share_id"));
    expect(insert).not.toMatch(/rawToken/);
    expect(c.slice(c.indexOf("insert into deal_shares"), c.indexOf("return { shareId")).match(/tokenHash/g)?.length).toBeGreaterThanOrEqual(1);
    expect(c.match(/rawToken/g)?.length).toBe(3); // minted, returned in the record, and the interface that names it
  });

  it("it is compared in constant time, shaped like the cron secret check", () => {
    const t = code("src/lib/deal-share/token.ts");
    expect(t).toContain("timingSafeEqual");
    expect(code(ACCESS)).toContain("verifyShareToken(");
    expect(code("src/lib/cron-auth.ts")).toContain("timingSafeEqual");
  });
});

describe("headers and indexing", () => {
  it("next.config sets no-store, noindex and no-referrer for everything under /deal", () => {
    const c = code("next.config.mjs");
    const block = c.slice(c.indexOf('source: "/deal/:path*"'));
    expect(block).toMatch(/Cache-Control", value: "private, no-store/);
    expect(block).toMatch(/X-Robots-Tag", value: "noindex, nofollow"/);
    expect(block).toMatch(/Referrer-Policy", value: "no-referrer"/);
  });

  it("the picture route sends the same three on its own responses", () => {
    const c = code("src/app/(prospect)/deal/[token]/image/[slot]/route.ts");
    expect(c).toMatch(/"cache-control": "private, no-store/);
    expect(c).toContain('"x-robots-tag": "noindex, nofollow"');
    expect(c).toContain('"referrer-policy": "no-referrer"');
  });

  it("the group's metadata says noindex and carries no product name", () => {
    const c = read("src/app/(prospect)/layout.tsx");
    expect(c).toMatch(/robots: \{ index: false, follow: false/);
    expect(c).toMatch(/title: "Reiwa Capital"/);
    expect(c).not.toMatch(/title: "[^"]*Reiwa OS/);
  });

  it("every refusal is notFound(), and the not-found page names no reason", () => {
    const page = code("src/app/(prospect)/deal/[token]/page.tsx");
    expect(page.match(/notFound\(\)/g)).toHaveLength(1);
    expect(code("src/app/(prospect)/not-found.tsx")).not.toMatch(/expired|revoked|invalid|wrong|token|incorrect/i);
  });
});

describe("what a prospect is shown", () => {
  const memo = composeMemo(snapshotSource());
  // Put recognisable text in sections a prospect is never entitled to, as if a person had written it.
  const spiked = JSON.parse(JSON.stringify(memo));
  for (const key of ["recommendation", "risk_mitigation", "tax_structuring", "further_dd", "japan_rationale", "financial_analysis"]) {
    spiked.sections[key] = {
      status: "composed", flags: [], emptyReason: null,
      blocks: [{ kind: "text", audience: "external", source: "Test", text: `INTERNAL-${key}` }],
    };
  }
  const overrides = { executive_summary: "A short written summary.", recommendation: "INTERNAL-override" };

  it("the Teaser carries the seven teaser sections and not one other", () => {
    const t = prospectTeaser(spiked, overrides, "2026-09-01T00:00:00Z")!;
    expect(t.sections.map((s) => s.key)).toEqual(
      ["executive_summary", "key_metrics", "asset_overview", "location_market", "investment_thesis", "business_plan", "exit_strategy"]);
    expect(JSON.stringify(t)).not.toMatch(/INTERNAL-/);
  });

  const view = (token = "TOKEN") => renderToStaticMarkup(createElement(ProspectDocument, {
    token,
    view: {
      prospectName: "Hanako Sato",
      snapshot: prospectSnapshot(spiked), teaser: prospectTeaser(spiked, overrides, "2026-09-01T00:00:00Z"),
    },
  }));

  it("the page shows both documents, the prospect's name, and no internal section", () => {
    const html = view();
    expect(html).toContain('data-document="snapshot"');
    expect(html).toContain('data-document="teaser"');
    expect(html).toContain("A short written summary.");
    expect(html).toContain("Prepared for Hanako Sato");
    expect(html).not.toMatch(/INTERNAL-/);
    for (const label of ["Recommendation", "Risk and Mitigation", "Tax and Structuring", "Further DD Required", "Financial Analysis"]) {
      expect(html).not.toContain(label);
    }
  });

  it("shows no way out: no link, no form, no button, no script, and no workspace affordance", () => {
    const html = view();
    expect(html).not.toMatch(/<a\s|<form|<button|<input|<textarea|<select|<script|href=/i);
    expect(html).not.toMatch(/Not yet captured|Reiwa OS|Draft/);
  });

  it("a LIVE picture reference is dropped, and a frozen one is served by this link's own route", () => {
    const live = JSON.parse(JSON.stringify(memo));
    live.snapshot.photo = { source: "live", photoId: "11111111-1111-4111-8111-111111111111" };
    live.snapshot.map = null;
    expect(prospectSnapshot(live)!.pictures).toEqual({ photo: false, map: false });
    const liveHtml = renderToStaticMarkup(createElement(ProspectDocument, { token: "TOKEN", view: { prospectName: "H", snapshot: prospectSnapshot(live), teaser: null } }));
    expect(liveHtml).not.toMatch(/image\/(photo|map)|alt="Map of|\/api\/asset-photos|property_photos/);
    expect(liveHtml.match(/<img/g)!.length).toBe(2); // the two Reiwa logos, and no picture

    const frozen = JSON.parse(JSON.stringify(memo));
    frozen.snapshot.photo = { source: "frozen", path: "memos/m1/photo-0123456789abcdef.jpg" };
    frozen.snapshot.map = { source: "frozen", path: "memos/m1/map-0123456789abcdef.jpg" };
    const html = renderToStaticMarkup(createElement(ProspectDocument, { token: "TOKEN", view: { prospectName: "H", snapshot: prospectSnapshot(frozen), teaser: null } }));
    expect(html).toContain('src="/deal/TOKEN/image/photo"');
    expect(html).toContain('src="/deal/TOKEN/image/map"');
    expect(html).not.toMatch(/\/api\/|memos\/m1|object_path/);
  });

  it("a memo with no snapshot is no snapshot, never an empty one", () => {
    const old = JSON.parse(JSON.stringify(memo));
    delete old.snapshot;
    expect(prospectSnapshot(old)).toBeNull();
    expect(prospectSnapshot({ nonsense: true })).toBeNull();
    expect(prospectTeaser("nonsense", {}, null)).toBeNull();
  });

  it("the Snapshot's workspace-only gap notes are dropped", () => {
    const withGaps = JSON.parse(JSON.stringify(memo));
    withGaps.snapshot.gaps = ["Build year", "WAULT"];
    expect(prospectSnapshot(withGaps)!.data.gaps).toEqual([]);
  });
});
