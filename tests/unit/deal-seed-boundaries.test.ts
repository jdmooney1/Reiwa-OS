// ============================================================================
// Where the deal seed is not allowed to reach, and what it must leave alone.
// ----------------------------------------------------------------------------
// A seeded deal is a DRAFT that only staff can see. These hold the lines that keep it so:
// the new columns appear in the loader and the migration and nowhere an investor could read
// them, the loader writes no publication of any kind, and the migration adds no policy,
// grant, function or view (so the investor-facing surface is, by construction, unchanged).
// Helpers use path.relative so they read the files they name on Windows as well.
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
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|sql)$/.test(n)) out.push(rel(p));
  }
  return out;
}

const MIGRATION = "supabase/migrations/0032_deal_intake_fields.sql";
const LOADER = "src/lib/data/deal-seed.ts";
const SCRIPT = "scripts/load-deal-seed.ts";

const PROPERTY_COLUMNS = ["heritage_status", "tenure", "unexpired_term_years", "ground_rent_pa", "ground_rent_note",
  "wault_to_expiry_years", "wault_to_breaks_years", "covenant_rating", "rent_review_mechanism", "epc_rating", "transport_connectivity"];
const OPPORTUNITY_COLUMNS = ["deal_stage", "photo_reference_type", "photo_url", "source_attachments", "data_completeness", "source_facts"];
const ALL = [...PROPERTY_COLUMNS, ...OPPORTUNITY_COLUMNS];

// The deal assessment (docs/28) is the first internal screen to READ these facts:
// its data layer selects them and its pure modules carry them as fields. All
// three are staff-only and imported by nothing investor- or prospect-facing,
// which tests/unit/deal-assessment-boundaries.test.ts holds.
const INTERNAL_READERS = [
  "src/lib/data/deal-assessments.ts", "src/lib/underwrite/inputs.ts", "src/lib/underwrite/prompt.ts",
];

describe("the new columns are named only where they are written", () => {
  it("no other application file, and no other migration, mentions one", () => {
    // `tenure` and `photo_url` are common words: match them only as a column in SQL (snake_case, quoted by a SQL keyword or comma).
    const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase/migrations")), ...walk(join(ROOT, "scripts"))]
      // The diligence checklist names "tenure" as a thing to check: a word in a template, not a column.
      .filter((f) => ![MIGRATION, LOADER, SCRIPT, "src/lib/dd/templates.ts", ...INTERNAL_READERS].includes(f));
    const hits: string[] = [];
    for (const f of files) {
      const text = f.endsWith(".sql") ? sql(f) : code(f);
      for (const c of ALL) if (new RegExp(`\\b${c}\\b`).test(text)) hits.push(`${f}: ${c}`);
    }
    // The only tolerated mention is the pure parser's own camelCase/doc words, which are not column names.
    expect(hits.filter((h) => !h.startsWith("src/lib/ingestion/deal-seed.ts"))).toEqual([]);
  });
});

describe("the migration adds data, not access", () => {
  const m = sql(MIGRATION);
  it("creates no policy, grant, function, view or trigger", () => {
    expect(m).not.toMatch(/create\s+(or\s+replace\s+)?(policy|function|view|trigger|table|role)\b|\bgrant\b|\brevoke\b|security\s+definer/i);
  });
  it("every column is nullable or defaulted: no existing row is touched or invented", () => {
    for (const stmt of m.split(";").filter((s) => /add column/i.test(s))) {
      for (const col of stmt.split(",").filter((c) => /add column/i.test(c))) {
        expect(col, col.trim()).not.toMatch(/not null(?!\s+default)/i);
      }
    }
    expect(m).not.toMatch(/\bupdate\s+\w+\s+set\b|\binsert\s+into\b|\bdelete\s+from\b/i);
  });
  it("is re-runnable: constraints are dropped before they are added, columns added if absent", () => {
    expect((m.match(/add column if not exists/gi) ?? []).length).toBeGreaterThanOrEqual(ALL.length / 6);
    expect((m.match(/drop constraint if exists/gi) ?? []).length).toBe((m.match(/add constraint/gi) ?? []).length);
  });
});

describe("the loader creates a draft and publishes nothing", () => {
  const l = code(LOADER);
  it("writes to no publication, entitlement or investor table", () => {
    expect(l).not.toMatch(/investor_|publication_|entitlement|memos?\b|property_photos|deal_shares/i);
  });
  it("sets the opportunity to stage new, status active, and leaves triage and owner alone", () => {
    const insert = l.slice(l.indexOf("insert into opportunities"), l.indexOf("returning opportunity_id"));
    expect(insert).toContain("'new','active'");
    expect(insert).not.toMatch(/triage_status|triage_priority|priority|stage\s*=\s*'(live|approved|ic)'|published/i);
    expect(insert).toMatch(/owner_user_id\)/);
    expect(l).toContain("'new','active',$19,null");
  });
  it("writes money to the investment case, never onto the opportunity row", () => {
    const insert = l.slice(l.indexOf("insert into opportunities"), l.indexOf("returning opportunity_id"));
    expect(insert).not.toMatch(/target_price|\bniy\b|passing_rent|erv\b/);
    expect(l).toMatch(/insert into investment_cases/);
  });
  it("only ever fills an empty field on an existing row", () => {
    const upd = l.slice(l.indexOf("update opportunities set"), l.indexOf("where org_id = $1 and reference = $2"));
    for (const line of upd.split("\n").filter((x) => /=/.test(x) && !/^\s*update/.test(x))) {
      expect(line, line.trim()).toMatch(/coalesce\(|case when .* is null|\|\| source_facts/);
    }
    const props = l.slice(l.indexOf("update properties set"), l.indexOf("where property_id = $1"));
    for (const line of props.split("\n").filter((x) => /=/.test(x) && !/^\s*update/.test(x))) expect(line, line.trim()).toMatch(/coalesce\(/);
  });
  it("resolves properties only through resolveProperty and never builds an identity key", () => {
    expect(l).toContain("resolveProperty(");
    expect(l).not.toMatch(/identity_key\s*=|propertyIdentityKey|normaliseAddress/);
  });
});

describe("the script is dry by default and says what an investor can see", () => {
  const s = code(SCRIPT);
  it("rolls back unless --write is given", () => {
    expect(s).toMatch(/if \(!args\.write\)[\s\S]{0,200}throw new RollBack\(\)/);
    expect(s).toContain('argv.includes("--write")');
  });
  it("parses and validates the whole file before it opens a transaction", () => {
    expect(s.indexOf("parseDealSeed(")).toBeGreaterThan(-1);
    expect(s.indexOf("parseDealSeed(")).toBeLessThan(s.indexOf("withSessionOn("));
  });
  it("only reads publications (a count), never writes one", () => {
    expect(s).not.toMatch(/insert into (investor_publications|publication_|publication_entitlements)|update (investor_publications|publication)/i);
    expect(s).toMatch(/select count\(\*\)::text as n from publication_sources/);
  });
  it("stops the run on a deal it cannot load rather than leaving some written", () => {
    expect(s).toMatch(/FAILED[\s\S]{0,160}throw e;/);
  });
});

describe("no outward-facing file knows these fields exist", () => {
  it("investor, portal and prospect surfaces never mention them", () => {
    const outward = [
      ...walk(join(ROOT, "src/app/(portal)")), ...walk(join(ROOT, "src/components/portal")), ...walk(join(ROOT, "src/lib/portal")),
      ...walk(join(ROOT, "src/app/(prospect)")), ...walk(join(ROOT, "src/components/deal-share")),
      "src/lib/data/portal-feed.ts", "src/lib/data/investor-portal.ts", "src/lib/data/deal-share-access.ts",
    ];
    for (const f of outward) for (const c of ALL) expect(code(f), `${f}: ${c}`).not.toMatch(new RegExp(`\\b${c}\\b`));
  });
});
