// ============================================================================
// Street View imagery is never stored.
// ----------------------------------------------------------------------------
// Google's terms forbid storing Street View images; only the panorama ID may be
// kept. This is the tripwire: it fails if any code on the Street View path starts
// to write image bytes anywhere - Supabase Storage, the filesystem, the database -
// or a migration adds a place to put them. Widening it has to be a deliberate
// change to this file, made after re-reading the terms.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const STREET_VIEW_FILES = [
  "src/lib/geo/street-view.ts",
  "src/lib/geo/property-photo.ts",
  "src/app/api/property-photo/[propertyId]/route.ts",
  "scripts/resolve-street-view.ts",
];
const STORES = /documents\/storage|putDocumentObject|deleteDocumentObject|signDocumentObject|\.storage\b|createSupabaseAdminClient|writeFile|createWriteStream|appendFile|s3\b|\bbytea\b|base64|next\/cache|unstable_cache/i;

describe("Street View code stores no imagery", () => {
  it.each(STREET_VIEW_FILES)("%s writes and caches nothing", (file) => {
    // Comments explain what is NOT done, so they are excluded from the search.
    const code = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(STORES);
  });

  it("the route sends `no-store` and streams the bytes on", () => {
    const route = readFileSync(join(ROOT, STREET_VIEW_FILES[2]), "utf8");
    expect(route).toContain("no-store");
    expect(route).toContain("private");
  });

  it("the route serves staff only and refuses investors", () => {
    const route = readFileSync(join(ROOT, STREET_VIEW_FILES[2]), "utf8");
    expect(route).toContain("getSession");
    expect(route).toContain('"investor_viewer"');
  });

  it("no migration adds a column or table for image data", () => {
    const dir = join(ROOT, "supabase/migrations");
    for (const f of readdirSync(dir)) {
      const sql = readFileSync(join(dir, f), "utf8").replace(/--.*$/gm, "");
      expect(sql, f).not.toMatch(/street_?view[a-z_]*\s+bytea/i);
      // `property_photos` (0019) is the register of photographs STAFF upload, and
      // is the one table allowed to carry that name. It must hold no Street View
      // data of any kind; the file-level guard below and the import guard in the
      // next test keep the two stores apart.
      if (f === "0019_property_photos.sql") {
        expect(sql, f).not.toMatch(/street_?view|pano/i);
        continue;
      }
      expect(sql, f).not.toMatch(/create\s+table[^;]*(street_?view|property_photos)/i);
    }
  });

  it("no Street View file can reach the uploaded-photo store", () => {
    for (const f of STREET_VIEW_FILES) {
      const code = readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/@\/lib\/photos|property_photos|PHOTO_BUCKET|putPhotoObject/);
    }
  });

  it("the only Street View column kept is the panorama id and a timestamp", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/0017_street_view_pano.sql"), "utf8").replace(/--.*$/gm, "");
    const added = [...sql.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
    expect(added).toEqual(["street_view_pano_id", "street_view_checked_at"]);
  });

  it("the browser is never handed a Google URL carrying the server key", () => {
    const summary = readFileSync(join(ROOT, "src/components/workspace/summary-section.tsx"), "utf8");
    expect(summary).toContain("/api/property-photo/");
    expect(summary).not.toMatch(/maps\.googleapis\.com\/maps\/api\/streetview/);
  });
});
