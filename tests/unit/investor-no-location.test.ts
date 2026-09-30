// ============================================================================
// A property's location must not reach an investor.
// ----------------------------------------------------------------------------
// investor_feed withholds the address on purpose (off-market deals, broker
// sensitivity), and a map pin is the address to the metre. Whether an investor
// should ever see a location is an OPEN DECISION for the firm, not a default the
// engineering reached by building the feature. This test is the tripwire: it
// fails if any investor-facing code or the investor_feed view starts to touch
// location, so widening it has to be a deliberate change to this file.
//
// It walks the tree, as the P5 activity test does. No database.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LOCATION = /latitude|longitude|formatted_address|formattedAddress|geocode|GOOGLE_MAPS|maps\.googleapis|street.?view/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("nothing investor-facing touches location", () => {
  const investorFiles = [
    ...walk(join(ROOT, "src/app/(portal)")),
    ...walk(join(ROOT, "src/components/portal")),
    ...walk(join(ROOT, "src/lib/portal")),
    join(ROOT, "src/lib/data/portal-feed.ts"),
    join(ROOT, "src/lib/data/investor-portal.ts"),
    join(ROOT, "src/app/actions/portal.ts"),
    join(ROOT, "src/app/actions/portal-access.ts"),
  ];

  it("covers real files", () => {
    expect(investorFiles.length).toBeGreaterThan(10);
  });

  it.each(investorFiles.map((f) => [f.replace(ROOT + "/", ""), f]))("%s", (_name, file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(LOCATION);
  });

  it("the investor_feed view exposes no location column", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/0005_investor_portal.sql"), "utf8");
    const view = sql.slice(sql.indexOf("create view investor_feed"), sql.indexOf("revoke all on investor_feed"));
    expect(view.length).toBeGreaterThan(200);
    expect(view).not.toMatch(LOCATION);
    expect(view).not.toMatch(/\baddress\b/i);
  });

  it("no later migration redefines investor_feed", () => {
    const dir = join(ROOT, "supabase/migrations");
    const redefining = readdirSync(dir).filter((f) => {
      if (f.slice(0, 4) <= "0005") return false; // 0005 defines it; only LATER ones matter
      return /create\s+(or\s+replace\s+)?view\s+investor_feed/i.test(readFileSync(join(dir, f), "utf8"));
    });
    expect(redefining).toEqual([]);
  });

  it("publication_versions carries no location, so nothing can project one", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/0005_investor_portal.sql"), "utf8");
    const table = sql.slice(sql.indexOf("create table if not exists publication_versions"), sql.indexOf("create table if not exists publication_version_sources"));
    expect(table).not.toMatch(LOCATION);
  });
});
