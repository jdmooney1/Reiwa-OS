// ============================================================================
// A property's location reaches an investor ONLY at the diligence tier.
// ----------------------------------------------------------------------------
// investor_feed withholds the address on purpose (off-market deals, broker
// sensitivity), and a map pin is the address to the metre. The firm decided
// (Phase C2) that a pin may be shown to an investor whose entitlement to that
// publication is at the DILIGENCE tier, and to no one else. This file is the
// tripwire for that decision. It used to say "location appears nowhere
// investor-facing"; it now says exactly where it may appear and how:
//
//   1. NOTHING investor-facing touches location except a four-file allowlist,
//      and even those never touch an address, a formatted address, a geocode or
//      the SERVER key. Every other investor file is held to the original rule.
//   2. In the database, the pin reaches investor_feed through ONE helper whose
//      gate is app.document_tier() - the same comparison documents use - plus
//      the caller's own visible entitlement, and only for a confirmed geocode
//      under 30 days old. The helper returns two numbers and no identifier.
//   3. In the application, a second lock turns a row into a location only if it
//      is diligence-tier, so a loosened view would still not show a standard
//      investor a pin.
//   4. The same holds when the DATABASE answer is wrong: a standard-tier row that
//      somehow carries coordinates comes out as null.
//
// Widening any of it has to be a deliberate change HERE. Tiers are also
// exercised against real Postgres in tests/investor-location.test.ts.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GEOCODE_TTL_DAYS } from "@/lib/geo/freshness";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// What an investor file may NEVER mention, allowlisted or not.
// `streetViewControl: false` is allowed: it is the option that HIDES Street View
// from the map, so an investor cannot open the building's street view.
const NEVER = /formatted_address|formattedAddress|geocode|GOOGLE_MAPS_SERVER_KEY|street.?view(?!Control: false)|maps\.googleapis|\bplace_?id\b/i;
// What only the allowlist may mention.
const COORDINATES = /latitude|longitude/i;

const ALLOWLIST = [
  "src/lib/data/portal-feed.ts",
  "src/lib/portal/location.ts",
  "src/components/portal/location-map.tsx",
  "src/app/(portal)/portal/opportunities/[publicationId]/page.tsx",
];

const investorFiles = [
  ...walk(join(ROOT, "src/app/(portal)")),
  ...walk(join(ROOT, "src/components/portal")),
  ...walk(join(ROOT, "src/lib/portal")),
  join(ROOT, "src/lib/data/portal-feed.ts"),
  join(ROOT, "src/lib/data/investor-portal.ts"),
  join(ROOT, "src/app/actions/portal.ts"),
  join(ROOT, "src/app/actions/portal-access.ts"),
].map((f) => f.replace(ROOT + "/", ""));

describe("1. only an explicit allowlist of investor files may touch coordinates", () => {
  it("covers real files, and the allowlist is a subset of them", () => {
    expect(investorFiles.length).toBeGreaterThan(10);
    for (const f of ALLOWLIST) expect(investorFiles, f).toContain(f);
  });

  it.each(investorFiles.filter((f) => !ALLOWLIST.includes(f)))("%s mentions no location at all", (file) => {
    const code = stripComments(read(file));
    expect(code).not.toMatch(NEVER);
    expect(code).not.toMatch(COORDINATES);
    expect(code).not.toMatch(/GOOGLE_MAPS/);
  });

  it.each(ALLOWLIST)("%s never mentions an address, a geocode, Street View or the server key", (file) => {
    expect(stripComments(read(file))).not.toMatch(NEVER);
  });
});

describe("2. the database gives coordinates to a diligence-tier entitlement only", () => {
  const sql = stripSqlComments(read("supabase/migrations/0018_investor_location.sql"));
  const fn = sql.slice(sql.indexOf("create or replace function app.investor_publication_location"), sql.indexOf("revoke execute on function"));
  const view = sql.slice(sql.indexOf("create or replace view investor_feed"), sql.indexOf("revoke all on investor_feed"));

  it("only 0018 and 0020 define investor_feed after 0005, and 0020 (photos) leaves the location columns exactly as they were", () => {
    const dir = join(ROOT, "supabase/migrations");
    const definers = readdirSync(dir).filter((f) => f.slice(0, 4) > "0005"
      && /create\s+(or\s+replace\s+)?view\s+investor_feed/i.test(read(`supabase/migrations/${f}`)));
    expect(definers).toEqual(["0018_investor_location.sql", "0020_investor_photos.sql"]);
    // 0020 re-states the view to append ONE column; the location gate must survive it untouched.
    const later = stripSqlComments(read("supabase/migrations/0020_investor_photos.sql"));
    const laterView = later.slice(later.indexOf("create or replace view investor_feed"), later.indexOf("revoke all on investor_feed"));
    expect(laterView).toMatch(/loc\.latitude,\s*loc\.longitude,/);
    expect(laterView).toContain("left join lateral app.investor_publication_location(p.publication_id) loc on true");
    expect(laterView).toContain("security_invoker = true");
  });

  it("the gate is app.document_tier(), the same comparison documents use, at the diligence tier", () => {
    expect(fn).toContain("app.document_tier('diligence') <= app.document_tier(e.document_access_level)");
    // documents: app.document_tier(p_access_level) <= app.document_tier(e.document_access_level)
    expect(read("supabase/migrations/0005_investor_portal.sql"))
      .toContain("app.document_tier(p_access_level) <= app.document_tier(e.document_access_level)");
  });

  it("the helper re-checks the caller's own visible entitlement and a published publication", () => {
    expect(fn).toContain("e.investor_org_id = app.current_investor_org_id()");
    expect(fn).toContain("e.is_visible");
    expect(fn).toContain("p.status = 'published'");
    expect(fn).toContain("p.active_version_id is not null");
  });

  it("only a confirmed geocode inside the 30-day limit is returned", () => {
    expect(fn).toContain("pr.geocode_status = 'ok'");
    expect(fn).toContain(`interval '${GEOCODE_TTL_DAYS} days'`);
    expect(fn).toContain("pr.geocoded_at >=");
  });

  it("the helper is SECURITY DEFINER with an empty search_path, and returns two numbers only", () => {
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = ''/);
    expect(fn).toMatch(/returns table \(latitude numeric, longitude numeric\)/);
    // What it SELECTS is two coordinates and nothing else. (It necessarily joins
    // on property_id and opportunity_id inside; none of that is returned.)
    const selected = fn.slice(fn.toLowerCase().indexOf("select "), fn.toLowerCase().indexOf(" from "));
    expect(selected.replace(/\s+/g, " ").trim()).toBe("select pr.latitude, pr.longitude");
  });

  it("EXECUTE is revoked from public and anon and granted to authenticated only", () => {
    expect(sql).toMatch(/revoke execute on function app\.investor_publication_location\(uuid\) from public, anon/);
    expect(sql).toMatch(/grant\s+execute on function app\.investor_publication_location\(uuid\) to authenticated/);
    expect(sql).not.toMatch(/grant[^;]*investor_publication_location[^;]*\b(anon|public)\b/i);
  });

  it("the view gains exactly two columns, from the helper, and joins no internal table itself", () => {
    expect(view).toMatch(/loc\.latitude,\s*loc\.longitude\s+from/);
    expect(view).toContain("left join lateral app.investor_publication_location(p.publication_id) loc on true");
    expect(view).not.toMatch(/publication_sources|\bopportunities\b|\bproperties\b|formatted|\baddress\b|\bplace_?id\b|geocode/i);
    expect(view).toContain("security_invoker = true");
  });

  it("the original 0005 view and the published snapshot still carry no location", () => {
    const s5 = read("supabase/migrations/0005_investor_portal.sql");
    const oldView = s5.slice(s5.indexOf("create view investor_feed"), s5.indexOf("revoke all on investor_feed"));
    expect(oldView).not.toMatch(/latitude|longitude|geocode|\baddress\b/i);
    const table = s5.slice(s5.indexOf("create table if not exists publication_versions"), s5.indexOf("create table if not exists publication_version_sources"));
    expect(table).not.toMatch(/latitude|longitude|geocode|\baddress\b/i);
  });

  it("the 30 days in SQL is the same 30 as the application's limit", () => {
    expect(GEOCODE_TTL_DAYS).toBe(30);
  });
});

describe("portal-feed.ts reads location through one function, and only that one", () => {
  const code = stripComments(read("src/lib/data/portal-feed.ts"));

  it("FEED_COLUMNS, used by the feed, compare and saved lists, carries no coordinate", () => {
    const cols = code.slice(code.indexOf("const FEED_COLUMNS"), code.indexOf("interface FeedRow"));
    expect(cols).not.toMatch(COORDINATES);
  });

  it("coordinates are selected in exactly one place: loadPortalLocation", () => {
    const selects = code.split("from investor_feed").filter((chunk) => COORDINATES.test(chunk.split("select").pop() ?? ""));
    expect(selects).toHaveLength(1);
    expect(code.slice(code.indexOf("export async function loadPortalLocation"))).toMatch(/select document_access_level, latitude, longitude/);
  });

  it("references no internal table, properties included", () => {
    expect(code).not.toMatch(/\b(from|join)\s+(properties|opportunities|publication_sources|investment_cases|assets)\b/i);
  });

  it("the opportunity page is the only caller of loadPortalLocation", () => {
    const callers = investorFiles.filter((f) => f !== "src/lib/data/portal-feed.ts"
      && /loadPortalLocation/.test(read(f)));
    expect(callers).toEqual(["src/app/(portal)/portal/opportunities/[publicationId]/page.tsx"]);
  });
});

describe("3. visibleLocation: the application's own lock", () => {
  // Imported lazily so the rest of this file reads without it.
  it("shows a diligence-tier investor their coordinates", async () => {
    const { visibleLocation } = await import("@/lib/portal/location");
    expect(visibleLocation({ documentAccessLevel: "diligence", latitude: 51.5158, longitude: -0.1755 }))
      .toEqual({ lat: 51.5158, lng: -0.1755 });
  });

  it("NEVER shows a standard-tier investor a location, even if the row carries one", async () => {
    const { visibleLocation } = await import("@/lib/portal/location");
    expect(visibleLocation({ documentAccessLevel: "standard", latitude: 51.5158, longitude: -0.1755 })).toBeNull();
  });

  it.each(["internal", "", "Diligence", "diligence ", "admin"])("refuses the level %j", async (level) => {
    const { visibleLocation } = await import("@/lib/portal/location");
    expect(visibleLocation({ documentAccessLevel: level, latitude: 1, longitude: 2 })).toBeNull();
  });

  it("refuses missing, non-finite and out-of-range coordinates even at diligence", async () => {
    const { visibleLocation } = await import("@/lib/portal/location");
    const d = "diligence";
    expect(visibleLocation({ documentAccessLevel: d, latitude: null, longitude: 2 })).toBeNull();
    expect(visibleLocation({ documentAccessLevel: d, latitude: 1, longitude: null })).toBeNull();
    expect(visibleLocation({ documentAccessLevel: d, latitude: NaN, longitude: 2 })).toBeNull();
    expect(visibleLocation({ documentAccessLevel: d, latitude: 91, longitude: 2 })).toBeNull();
    expect(visibleLocation({ documentAccessLevel: d, latitude: 1, longitude: 181 })).toBeNull();
  });
});

describe("4. loadPortalLocation with a database that answers wrongly", () => {
  const rowsFor = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], queries: 0 }));
  vi.mock("@/lib/db/client", () => ({
    withInvestorSession: async (_uid: string, fn: (tx: { query: () => Promise<{ rows: unknown[] }> }) => unknown) =>
      fn({ query: async () => { rowsFor.queries += 1; return { rows: rowsFor.rows }; } }),
  }));
  const PUB = "cccccccc-0000-0000-0000-000000000001";
  beforeEach(() => { rowsFor.rows = []; rowsFor.queries = 0; });

  it("returns the pin for a diligence-tier row", async () => {
    const { loadPortalLocation } = await import("@/lib/data/portal-feed");
    rowsFor.rows = [{ document_access_level: "diligence", latitude: "51.515800", longitude: "-0.175500" }];
    expect(await loadPortalLocation("uid", PUB)).toEqual({ lat: 51.5158, lng: -0.1755 });
  });

  it("returns null for a standard-tier row, even if the view were loosened and sent coordinates", async () => {
    const { loadPortalLocation } = await import("@/lib/data/portal-feed");
    rowsFor.rows = [{ document_access_level: "standard", latitude: "51.515800", longitude: "-0.175500" }];
    expect(await loadPortalLocation("uid", PUB)).toBeNull();
  });

  it("returns null when the database sends NULL coordinates, and when there is no row", async () => {
    const { loadPortalLocation } = await import("@/lib/data/portal-feed");
    rowsFor.rows = [{ document_access_level: "diligence", latitude: null, longitude: null }];
    expect(await loadPortalLocation("uid", PUB)).toBeNull();
    rowsFor.rows = [];
    expect(await loadPortalLocation("uid", PUB)).toBeNull();
  });

  it("does not query at all for something that is not a publication id", async () => {
    const { loadPortalLocation } = await import("@/lib/data/portal-feed");
    expect(await loadPortalLocation("uid", "not-a-uuid")).toBeNull();
    expect(rowsFor.queries).toBe(0);
  });
});
