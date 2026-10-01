// ============================================================================
// Asset photographs are NOT investor-visible. This is the tripwire.
// ----------------------------------------------------------------------------
// Phase 1 is staff only. `property_photos.visibility` records an intended
// audience, but nothing investor-facing reads it: no policy, no view, no helper,
// no route, no portal file. An investor session can therefore read no photograph
// at any tier, which is stricter than "nothing above their entitlement".
//
// Phase 2 (investor portal photos) is a deliberate decision about confidentiality
// and has to arrive as one reviewed change that edits THIS file. Until then:
//
//   1. No investor-facing source file mentions a photograph, its table, its
//      route or its bucket.
//   2. Migration 0019 is the only migration that mentions the table; a later one
//      that exposes it to investors fails here, on purpose.
//   3. In that migration the only select policy is the staff one, there is no
//      investor_feed change and no function, and `anon` has nothing.
//   4. The delivery route and rule refuse everyone but internal staff, and the
//      browser is only ever given an id.
//
// The live proof against Postgres RLS is tests/property-photos.test.ts.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

const PHOTO = /property_photos|propertyPhotos|asset-photos|photos\/(storage|delivery|access|constraints|client)|property-photos|PHOTO_BUCKET|PropertyPhoto\b|headlinePhoto|issuePhotoDownload|mayReadPhoto/;

const investorFiles = [
  ...walk(join(ROOT, "src/app/(portal)")),
  ...walk(join(ROOT, "src/components/portal")),
  ...walk(join(ROOT, "src/lib/portal")),
  join(ROOT, "src/lib/data/portal-feed.ts"),
  join(ROOT, "src/lib/data/investor-portal.ts"),
  join(ROOT, "src/app/actions/portal.ts"),
  join(ROOT, "src/app/actions/portal-access.ts"),
  join(ROOT, "src/lib/documents/secure-delivery.ts"),
].map((f) => f.replace(ROOT + "/", ""));

describe("1. nothing investor-facing mentions a photograph", () => {
  it("covers real files", () => {
    expect(investorFiles.length).toBeGreaterThan(10);
  });

  it.each(investorFiles)("%s", (file) => {
    expect(stripComments(read(file))).not.toMatch(PHOTO);
  });
});

describe("2. only migration 0019 touches the table", () => {
  it("no other migration mentions it, so an investor read path cannot arrive unnoticed", () => {
    const dir = join(ROOT, "supabase/migrations");
    const mentions = readdirSync(dir).filter((f) => /property_photos/.test(stripSqlComments(read(`supabase/migrations/${f}`))));
    expect(mentions).toEqual(["0019_property_photos.sql"]);
  });
});

describe("3. what migration 0019 grants", () => {
  const sql = stripSqlComments(read("supabase/migrations/0019_property_photos.sql"));

  it("defines no view, no function and no investor helper", () => {
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?(view|function|materialized)/i);
    expect(sql).not.toMatch(/investor_feed|current_investor|security\s+definer/i);
  });

  it("every policy is the staff organisation rule, and the select is has_org only", () => {
    const policies = [...sql.matchAll(/create policy (\w+) on property_photos for (\w+) to (\w+)\s+(using|with check)\s*\(([^;]*)\);/gi)];
    expect(policies.map((m) => m[2]).sort()).toEqual(["delete", "insert", "select", "update"]);
    for (const m of policies) {
      expect(m[3]).toBe("authenticated");
      expect(m[5]).toContain("app.has_org(org_id)");
    }
    const select = policies.find((m) => m[2] === "select")!;
    expect(select[5].trim()).toBe("app.has_org(org_id)");
    for (const m of policies.filter((p) => p[2] !== "select")) expect(m[5]).toContain("app.can_write()");
  });

  it("anon and public have nothing", () => {
    expect(sql).toMatch(/revoke all on property_photos from anon, public/);
    expect(sql).not.toMatch(/grant[^;]*property_photos[^;]*\b(anon|public)\b/i);
  });

  it("a photograph is internal by default, only the three tiers are valid, and one headline per property", () => {
    expect(sql).toMatch(/visibility\s+text not null default 'internal'/);
    expect(sql).toMatch(/check \(visibility in \('internal', 'standard', 'diligence'\)\)/);
    expect(sql).toMatch(/create unique index if not exists property_photos_one_headline\s+on property_photos\(property_id\) where is_headline/);
  });

  it("stores only image types the application accepts, and no SVG", () => {
    expect(sql).toMatch(/mime_type in \('image\/jpeg', 'image\/png', 'image\/webp'\)/);
    expect(sql).not.toMatch(/svg/i);
  });
});

describe("4. delivery refuses everyone but internal staff, every time", () => {
  const route = stripComments(read("src/app/api/asset-photos/[photoId]/route.ts"));
  const delivery = stripComments(read("src/lib/photos/delivery.ts"));
  const storage = stripComments(read("src/lib/photos/storage.ts"));

  it("the route resolves the session itself, answers 303 to a signed URL, and refuses with one bare 404", () => {
    expect(route).toContain("getSession()");
    expect(route).toMatch(/status: 303/);
    expect(route).toMatch(/status: 404/);
    expect(route).toContain("no-store");
    expect(route).toContain("no-referrer");
    // nothing is cached or kept between requests
    expect(route).toContain('export const dynamic = "force-dynamic"');
    expect(route).not.toMatch(/revalidate|unstable_cache|Map\(|cache\(/);
  });

  it("the role and visibility rule runs before the signed URL is minted, and again after the row is read", () => {
    expect(delivery.match(/mayReadPhoto\(/g)).toHaveLength(2);
    expect(delivery.indexOf("mayReadPhoto(session.role, row.visibility)"))
      .toBeLessThan(delivery.indexOf("signPhotoObject(row.object_path)"));
    expect(delivery.indexOf('mayReadPhoto(session.role, "internal")'))
      .toBeLessThan(delivery.indexOf("withSession("));
  });

  it("the bucket is created private, never public, and no public URL is ever requested", () => {
    expect(storage).toMatch(/public: false/);
    expect(storage).not.toMatch(/getPublicUrl|public: true/);
    expect(storage).toContain("createSignedUrl");
  });

  it("the browser is handed ids, never paths: the data layer returns no object path", () => {
    const data = stripComments(read("src/lib/data/property-photos.ts"));
    const list = data.slice(data.indexOf("export interface PropertyPhoto"), data.indexOf("export async function propertyOrgFor"));
    expect(list).not.toMatch(/object_path|objectPath/);
    const pipeline = stripComments(read("src/lib/data/opportunity-file.ts"));
    expect(pipeline).toContain("select property_id, photo_id from property_photos where is_headline");
    expect(pipeline).not.toMatch(/object_path/);
  });

  it("the client components never import the server-only storage module", () => {
    for (const f of ["src/components/workspace/photos-section.tsx", "src/components/opportunities/opportunity-pipeline.tsx"]) {
      expect(stripComments(read(f)), f).not.toMatch(/photos\/storage|photos\/delivery|supabase\/admin/);
    }
  });
});
