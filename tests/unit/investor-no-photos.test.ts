// ============================================================================
// Asset photographs reach an investor ONLY if staff cleared that photo to
// `diligence` AND the investor's entitlement is at the diligence tier.
// ----------------------------------------------------------------------------
// Phase 1 (migration 0019) was staff-only and this file said "an investor reads
// zero photographs at every tier". Phase 2 (migration 0020) deliberately opens
// ONE narrow door, so the invariant is now the narrower, true one:
//
//   * internal photo, any investor ................ nothing
//   * diligence photo, standard-tier entitlement ... nothing
//   * diligence photo, diligence-tier entitlement .. that photo
//
// What this file pins, statically (the live proof against Postgres RLS is
// tests/investor-photos.test.ts):
//
//   1. Only a short allowlist of investor-facing files mentions a photograph at
//      all, and none of them can name the table, a storage path, the bucket or a
//      staff visibility. Every other investor file still mentions none.
//   2. The table is mentioned by migration 0019 and, inside three SECURITY
//      DEFINER functions, by 0020 - never in a policy, a grant or the view.
//   3. Each function re-checks everything itself, through the same
//      app.document_tier() comparison the location pin and documents use.
//   4. The delivery route and module hold no rule of their own: the database
//      decides, every refusal is one bare 404, and the staff route is untouched.
//   5. The application's own tier check (src/lib/portal/photos.ts) holds with the
//      database answer deliberately wrong.
//
// Widening any of it has to be a deliberate change HERE.
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { visiblePhotos, visibleHeadlinePhoto, PHOTO_TIER } from "@/lib/portal/photos";
import { PhotoGallery } from "@/components/portal/photo-gallery";
import { OpportunityCard } from "@/components/portal/opportunity-cards";
import type { PortalOpportunity } from "@/lib/data/portal-feed";

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

const ALLOWLIST = [
  "src/lib/data/portal-feed.ts",
  "src/lib/portal/photos.ts",
  "src/lib/photos/portal-delivery.ts",
  "src/components/portal/photo-gallery.tsx",
  "src/components/portal/opportunity-cards.tsx",
  "src/app/(portal)/portal/opportunities/[publicationId]/page.tsx",
  "src/app/(portal)/portal/photos/[photoId]/route.ts",
];

const investorFiles = [
  ...walk(join(ROOT, "src/app/(portal)")),
  ...walk(join(ROOT, "src/components/portal")),
  ...walk(join(ROOT, "src/lib/portal")),
  join(ROOT, "src/lib/data/portal-feed.ts"),
  join(ROOT, "src/lib/data/investor-portal.ts"),
  join(ROOT, "src/lib/photos/portal-delivery.ts"),
  join(ROOT, "src/app/actions/portal.ts"),
  join(ROOT, "src/app/actions/portal-access.ts"),
  join(ROOT, "src/lib/documents/secure-delivery.ts"),
].map((f) => f.replace(ROOT + "/", ""));

// Anything that says "a photograph" in investor code.
const PHOTO = /photo|headline_photo_id|headlinePhotoId|asset-photos|property-photos|PHOTO_BUCKET/i;
// What NO investor-facing file may ever mention, allowlisted or not: the table,
// a storage path, the bucket, the staff-side modules, or a staff visibility word.
const NEVER = /property_photos|object_path|objectPath|PHOTO_BUCKET|property-photos|@\/lib\/photos\/(storage|delivery|access|process|client)|@\/app\/actions\/photos|mayReadPhoto|is_headline|visibility/;

describe("1. only a short allowlist of investor files mentions a photograph", () => {
  it("covers real files, and the allowlist is a subset of them", () => {
    expect(investorFiles.length).toBeGreaterThan(10);
    for (const f of ALLOWLIST) expect(investorFiles, f).toContain(f);
  });

  it.each(investorFiles.filter((f) => !ALLOWLIST.includes(f)))("%s mentions no photograph at all", (file) => {
    expect(stripComments(read(file))).not.toMatch(PHOTO);
  });

  it.each(ALLOWLIST.filter((f) => f !== "src/lib/photos/portal-delivery.ts"))(
    "%s never names the table, a storage path, the bucket or a staff visibility", (file) => {
      expect(stripComments(read(file))).not.toMatch(NEVER);
    });

  it("the delivery module, which signs, may name a path and the signer, and nothing else on the list", () => {
    const code = stripComments(read("src/lib/photos/portal-delivery.ts"));
    expect(code).not.toMatch(/property_photos|PHOTO_BUCKET|property-photos|mayReadPhoto|is_headline|visibility|@\/app\/actions\/photos/);
    const imports = [...code.matchAll(/import \{([^}]*)\} from "@\/lib\/photos\/storage"/g)].map((m) => m[1].split(",").map((x) => x.trim()).sort());
    expect(imports).toEqual([["signPhotoObject", "thumbPathFor"]]);
  });

  it("the one place a path is selected is the delivery module, from the function, to sign it", () => {
    const delivery = stripComments(read("src/lib/photos/portal-delivery.ts"));
    expect(delivery).toContain("from app.investor_photo($1)");
    // (The NEVER check above allows this file only because it spells the column in SQL.)
    // The event insert names its columns and pins the caller through app.current_investor_*();
    // those are the only places a contact or organisation may appear, and never as a filter on a request value.
    const stripped = delivery
      .replace(/app\.current_investor_(org|contact)_id\(\)/g, "")
      .replace(/investor_contact_id, investor_org_id, event_type/, "")
      .replace(/e\.investor_contact_id = /, "");
    expect(stripped).not.toMatch(/property_photos|visibility|document_tier|investor_org_id|is_headline/);
  });
});

describe("2. the table is reached only through the three functions", () => {
  it("only migrations 0019 and 0020 mention it", () => {
    const dir = join(ROOT, "supabase/migrations");
    const mentions = readdirSync(dir).filter((f) => /property_photos/.test(stripSqlComments(read(`supabase/migrations/${f}`))));
    expect(mentions).toEqual(["0019_property_photos.sql", "0020_investor_photos.sql"]);
  });

  const sql = stripSqlComments(read("supabase/migrations/0020_investor_photos.sql"));
  const fnBody = (name: string) => {
    const start = sql.indexOf(`create or replace function app.${name}(`);
    return sql.slice(start, sql.indexOf("$fn$;", start));
  };

  it("0020 creates no policy, no table, no grant on the table and no change to its privileges", () => {
    expect(sql).not.toMatch(/create\s+policy|create\s+table|alter\s+table|grant[^;]*property_photos|revoke[^;]*property_photos/i);
  });

  it("the view mentions neither the table nor the staff-side joins; it only calls the function", () => {
    const view = sql.slice(sql.indexOf("create or replace view investor_feed"), sql.indexOf("revoke all on investor_feed"));
    expect(view).not.toMatch(/property_photos|\bproperties\b|\bopportunities\b|publication_sources|object_path/);
    expect(view).toContain("left join lateral app.investor_publication_headline_photo(p.publication_id) photo on true");
    expect(view).toMatch(/photo\.photo_id as headline_photo_id\s+from/);
    expect(view).toContain("security_invoker = true");
  });

  it("the view only APPENDS a column: the 0018 columns keep their order", () => {
    const strip = (v: string) => v.replace(/\s+/g, " ");
    const old = strip(stripSqlComments(read("supabase/migrations/0018_investor_location.sql")));
    const oldView = old.slice(old.indexOf("create or replace view investor_feed"), old.indexOf("from publication_entitlements e"));
    const now = strip(sql);
    const newView = now.slice(now.indexOf("create or replace view investor_feed"), now.indexOf("from publication_entitlements e"));
    expect(newView.startsWith(oldView.replace(/loc\.longitude\s*$/, "loc.longitude,"))).toBe(true);
  });

  it.each(["investor_photo", "investor_publication_photos"])("app.%s re-checks everything itself, at the diligence tier", (name) => {
    const fn = fnBody(name);
    expect(fn).toContain("app.document_tier('diligence') <= app.document_tier(e.document_access_level)");
    expect(fn).toContain("e.investor_org_id = app.current_investor_org_id()");
    expect(fn).toContain("e.is_visible");
    expect(fn).toContain("p.status = 'published'");
    expect(fn).toContain("p.active_version_id is not null");
    expect(fn).toContain("pp.visibility = 'diligence'");
  });

  it("app.investor_publication_headline_photo is built on the gallery function and reads no table of its own", () => {
    const fn = fnBody("investor_publication_headline_photo");
    expect(fn).toContain("from app.investor_publication_photos(p_publication_id)");
    expect(fn).not.toMatch(/public\.|property_photos/);
  });

  it("all three are SECURITY DEFINER with an empty search_path", () => {
    for (const n of ["investor_photo", "investor_publication_photos", "investor_publication_headline_photo"]) {
      const fn = fnBody(n);
      expect(fn, n).toMatch(/security definer/i);
      expect(fn, n).toMatch(/set search_path = ''/);
    }
  });

  it("the gallery returns an id, whether it is the headline, an order and a caption - nothing that identifies a record or a path", () => {
    expect(fnBody("investor_publication_photos")).toMatch(/returns table \(photo_id uuid, is_headline boolean, sort_order int, caption text\)/);
    expect(fnBody("investor_publication_headline_photo")).toMatch(/returns table \(photo_id uuid\)/);
    expect(fnBody("investor_publication_photos")).not.toMatch(/select[^;]*(object_path|property_id|org_id|uploaded_by)[^;]*\n?\s*from/is);
  });

  it("EXECUTE is revoked from public and anon and granted to authenticated only", () => {
    for (const sig of ["investor_photo(uuid)", "investor_publication_photos(uuid)", "investor_publication_headline_photo(uuid)"]) {
      const esc = sig.replace(/[()]/g, "\\$&");
      expect(sql).toMatch(new RegExp(`revoke execute on function app\\.${esc} from public, anon`));
      expect(sql).toMatch(new RegExp(`grant\\s+execute on function app\\.${esc} to authenticated`));
    }
    expect(sql).not.toMatch(/grant[^;]*investor_(photo|publication_photos|publication_headline_photo)[^;]*\b(anon|public)\b/i);
  });

  it("0019 is unchanged in the one respect that matters: still no investor policy, still internal by default", () => {
    const m = stripSqlComments(read("supabase/migrations/0019_property_photos.sql"));
    expect(m).not.toMatch(/current_investor|investor_feed|security\s+definer|create\s+(or\s+replace\s+)?function/i);
    expect(m).toMatch(/visibility\s+text not null default 'internal'/);
    expect(m).toMatch(/check \(visibility in \('internal', 'diligence'\)\)/);
  });
});

describe("3. delivery holds no rule of its own", () => {
  const route = stripComments(read("src/app/(portal)/portal/photos/[photoId]/route.ts"));
  const docRoute = stripComments(read("src/app/(portal)/portal/documents/[documentId]/route.ts"));

  it("the route has the same shape as the document route: investor session, one bare 404, 303 to a signed URL", () => {
    expect(route).toContain("getPortalSession()");
    expect(route).toMatch(/status: 404/);
    expect(route).toMatch(/status: 303/);
    for (const needle of ["no-store", "no-referrer", 'export const dynamic = "force-dynamic"', "reportError("]) {
      expect(route, needle).toContain(needle);
      expect(docRoute, needle).toContain(needle);
    }
    expect(route.match(/status: 404/g)).toHaveLength(1);
  });

  it("a fault and a refusal are the same 404 to the investor", () => {
    expect(route).toMatch(/catch \(e\) \{[\s\S]*reportError\([\s\S]*return refuse\(\);/);
  });

  it("the route never touches the staff session, and the staff route never serves an investor", () => {
    expect(route).not.toMatch(/getSession\(|toDbSession|mayReadPhoto/);
    const staff = stripComments(read("src/app/api/asset-photos/[photoId]/route.ts"));
    expect(staff).not.toMatch(/getPortalSession|withInvestorSession|issuePortalPhotoDownload/);
    expect(stripComments(read("src/lib/photos/access.ts"))).toContain('role === "reiwa_admin" || role === "org_user"');
  });

  it("the thumbnail variant is honoured only for an exact match, with the same authorisation", () => {
    expect(route).toContain('searchParams.get("variant") === "thumb"');
  });

  it("the browser is only ever given an id: the data layer's investor read selects no path", () => {
    const feed = stripComments(read("src/lib/data/portal-feed.ts"));
    expect(feed).toContain("from app.investor_publication_photos($1)");
    expect(feed).not.toMatch(/object_path/);
  });
});

describe("4. the application checks the tier too, so a wrong database answer shows nothing", () => {
  const photos = [{ photoId: "p1", caption: null }, { photoId: "p2", caption: "Front elevation" }];

  it("visiblePhotos passes a diligence row and nothing else", () => {
    expect(PHOTO_TIER).toBe("diligence");
    expect(visiblePhotos({ documentAccessLevel: "diligence", photos })).toEqual(photos);
    for (const tier of ["standard", "internal", "", "DILIGENCE", "diligence ", "public"]) {
      expect(visiblePhotos({ documentAccessLevel: tier, photos }), tier).toEqual([]);
    }
  });

  it("visibleHeadlinePhoto passes a diligence row's id and nothing else", () => {
    expect(visibleHeadlinePhoto({ documentAccessLevel: "diligence", headlinePhotoId: "p1" })).toBe("p1");
    expect(visibleHeadlinePhoto({ documentAccessLevel: "diligence", headlinePhotoId: null })).toBeNull();
    for (const tier of ["standard", "internal", ""]) {
      expect(visibleHeadlinePhoto({ documentAccessLevel: tier, headlinePhotoId: "p1" }), tier).toBeNull();
    }
  });

  it("the gallery renders nothing for a standard-tier row even when handed photographs", () => {
    expect(renderToStaticMarkup(createElement(PhotoGallery, { photos, tier: "standard", title: "T" }))).toBe("");
    expect(renderToStaticMarkup(createElement(PhotoGallery, { photos, tier: "internal", title: "T" }))).toBe("");
  });

  it("the gallery for a diligence row requests ids from /portal/photos only: full for the first, thumbnails after, no path", () => {
    const html = renderToStaticMarkup(createElement(PhotoGallery, { photos, tier: "diligence", title: "T" }));
    expect(html).toContain('src="/portal/photos/p1"');
    expect(html).toContain('src="/portal/photos/p2?variant=thumb"');
    expect(html).not.toMatch(/property-photos|object_path|supabase\.co|signed|\/api\/asset-photos/);
  });

  const card = (tier: string, headlinePhotoId: string | null) => ({
    publicationId: "pub", versionId: "v", placement: "featured", sortOrder: 0, investorNote: null,
    documentAccessLevel: tier, title: "Asset", headline: null, overview: null, market: null, submarket: null,
    city: "London", country: null, assetType: null, strategy: null, currency: "GBP", headlinePrice: null,
    targetNiy: null, targetIrr: null, targetEquityMultiple: null, holdPeriodYears: null, sizeSqft: null,
    sizeSqm: null, highlights: [], publishedAt: null, headlinePhotoId,
  }) as unknown as PortalOpportunity;

  it("a teaser thumbnail shows for a diligence row with a photo, and for no other combination", () => {
    const render = (o: PortalOpportunity) => renderToStaticMarkup(createElement(OpportunityCard, { opportunity: o, saved: false }));
    expect(render(card("diligence", "abc"))).toContain('src="/portal/photos/abc?variant=thumb"');
    expect(render(card("diligence", null))).not.toContain("<img");
    expect(render(card("standard", "abc"))).not.toContain("<img");   // a database that got it wrong
  });
});

describe("5. the data layer applies the same rule on the way out", () => {
  const state = vi.hoisted(() => ({ tier: "standard" }));
  vi.mock("@/lib/db/client", () => ({
    withInvestorSession: async (_u: string, fn: (tx: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => unknown) =>
      fn({ query: async (sql: string) => {
        if (/investor_publication_photos/.test(sql)) return { rows: [{ photo_id: "p1", caption: null }] };
        return { rows: [{
          publication_id: "11111111-1111-4111-8111-111111111111", version_id: "v", placement: "featured", sort_order: 0,
          investor_note: null, title: "T", headline: null, overview: null, market: null, submarket: null, city: null,
          country: null, asset_type: null, strategy: null, currency: "GBP", headline_price: null, target_niy: null,
          target_irr: null, target_equity_multiple: null, hold_period_years: null, size_sqft: null, size_sqm: null,
          highlights: [], published_at: null, document_access_level: state.tier, headline_photo_id: "p1",
        }] };
      } }),
  }));
  const PUB = "11111111-1111-4111-8111-111111111111";

  it("a standard-tier feed row carries no teaser photo and no gallery, whatever the database returned", async () => {
    state.tier = "standard";
    const { loadPortalOpportunity, loadPortalPhotos } = await import("@/lib/data/portal-feed");
    expect((await loadPortalOpportunity("u", PUB))!.headlinePhotoId).toBeNull();
    expect(await loadPortalPhotos("u", PUB)).toEqual([]);
  });

  it("a diligence-tier feed row carries both", async () => {
    state.tier = "diligence";
    const { loadPortalOpportunity, loadPortalPhotos } = await import("@/lib/data/portal-feed");
    expect((await loadPortalOpportunity("u", PUB))!.headlinePhotoId).toBe("p1");
    expect(await loadPortalPhotos("u", PUB)).toEqual([{ photoId: "p1", caption: null }]);
  });
});
