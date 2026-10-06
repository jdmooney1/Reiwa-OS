// ============================================================================
// photo_viewed: written only when a photograph has actually been delivered.
// ----------------------------------------------------------------------------
// The twin of what tests/document-delivery.test.ts proves for document_downloaded.
// No database here: the investor session and the signer are mocked, so what is
// asserted is the ORDER and the CONDITIONS under which the event is written. The
// same rules are exercised against Postgres in tests/photo-delivery.test.ts.
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  photoRows: [] as unknown[],
  queries: [] as { sql: string; params: unknown[] }[],
  signed: [] as string[],
  signResult: (path: string): string | null => `https://store.example/${path}?sig=1`,
  insertThrows: false,
  order: [] as string[],
}));

vi.mock("@/lib/db/client", () => ({
  withInvestorSession: async (_uid: string, fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => unknown) =>
    fn({ query: async (sql: string, params: unknown[] = []) => {
      state.queries.push({ sql, params });
      if (/investor_activity_events/.test(sql)) {
        state.order.push("event");
        if (state.insertThrows) throw new Error("activity write failed");
        return { rows: [] };
      }
      state.order.push("lookup");
      return { rows: state.photoRows };
    } }),
}));
vi.mock("@/lib/photos/storage", () => ({
  signPhotoObject: async (path: string) => { state.order.push("sign"); state.signed.push(path); return state.signResult(path); },
  thumbPathFor: (p: string) => p.replace(/(\.[a-z0-9]+)$/i, "-thumb$1"),
}));

const PHOTO = "11111111-1111-4111-8111-111111111111";
const PUB = "22222222-2222-4222-8222-222222222222";
const granted = [{ object_path: "properties/p/abc.jpg", mime_type: "image/jpeg", publication_id: PUB }];
const events = () => state.queries.filter((q) => /investor_activity_events/.test(q.sql));

beforeEach(() => {
  state.photoRows = granted; state.queries = []; state.signed = []; state.order = [];
  state.signResult = (p) => `https://store.example/${p}?sig=1`; state.insertThrows = false;
});

async function deliver(id = PHOTO, variant?: "full" | "thumb") {
  const { issuePortalPhotoDownload } = await import("@/lib/photos/portal-delivery");
  return issuePortalPhotoDownload("auth-user", id, variant);
}

describe("a successful delivery records one photo_viewed event", () => {
  it("after the lookup and after the signed URL, with the publication and photo", async () => {
    const url = await deliver(PHOTO, "full");
    expect(url).toContain("properties/p/abc.jpg");
    expect(state.order).toEqual(["lookup", "sign", "event"]);
    expect(events()).toHaveLength(1);
    const [e] = events();
    expect(e.sql).toContain("'photo_viewed'");
    expect(e.params.slice(0, 3)).toEqual([PUB, PHOTO, JSON.stringify({ variant: "full" })]);
  });

  it("records which rendition was viewed", async () => {
    await deliver(PHOTO, "thumb");
    expect(events()[0].params[2]).toBe(JSON.stringify({ variant: "thumb" }));
  });

  it("is de-duplicated in the insert itself: one per photo and rendition per window", async () => {
    await deliver(PHOTO, "full");
    const sql = events()[0].sql;
    expect(sql).toMatch(/where not exists/i);
    expect(sql).toContain("e.photo_id = $2::uuid");
    expect(sql).toContain("e.context ->> 'variant'");
    expect(sql).toContain("e.occurred_at > now() - make_interval(mins =>");
    expect(events()[0].params[3]).toBe(30);
  });
});

describe("a refusal writes nothing", () => {
  it("no row from app.investor_photo (internal photo, standard tier, other org, withdrawn, unknown): no signing, no event", async () => {
    state.photoRows = [];
    expect(await deliver()).toBeNull();
    expect(state.signed).toEqual([]);
    expect(events()).toEqual([]);
  });

  it("a malformed id never reaches the database", async () => {
    expect(await deliver("not-a-uuid")).toBeNull();
    expect(state.queries).toEqual([]);
  });

  it("a photograph that was authorised but could not be signed is not a delivery, so nothing is recorded", async () => {
    state.signResult = () => null;
    expect(await deliver(PHOTO, "full")).toBeNull();
    expect(events()).toEqual([]);
  });

  it("a thumbnail that is missing falls back to the full image, and that delivery is recorded once", async () => {
    state.signResult = (p) => (p.includes("-thumb") ? null : `https://store.example/${p}?sig=1`);
    expect(await deliver(PHOTO, "thumb")).toContain("properties/p/abc.jpg");
    expect(state.signed).toEqual(["properties/p/abc-thumb.jpg", "properties/p/abc.jpg"]);
    expect(events()).toHaveLength(1);
  });
});

describe("the activity write can never fail a view", () => {
  it("a failing insert is swallowed and the signed URL is still returned", async () => {
    state.insertThrows = true;
    await expect(deliver(PHOTO, "full")).resolves.toContain("properties/p/abc.jpg");
  });
});

describe("the event can only be emitted from where bytes were just delivered", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const delivery = read("src/lib/photos/portal-delivery.ts");

  it("the writer is private, called once, and only after a signed URL exists", () => {
    expect(delivery).not.toMatch(/export (async )?function recordPhotoViewed/);
    expect(delivery.match(/recordPhotoViewed\(/g)).toHaveLength(2); // definition and the one call
    expect(delivery.indexOf("if (!signedUrl) return null;")).toBeLessThan(delivery.indexOf("await recordPhotoViewed("));
    expect(delivery).toMatch(/try \{[\s\S]*withInvestorSession[\s\S]*\} catch \{/);
  });

  it("'photo_viewed' is written from this one module and nowhere else in the application", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const hits = execSync("grep -rl \"'photo_viewed'\" src || true", { cwd: process.cwd() }).toString().trim().split("\n").filter(Boolean);
    expect(hits).toEqual(["src/lib/photos/portal-delivery.ts"]);
  });

  it("the vocabulary, labels and migration agree", () => {
    const events = read("src/lib/activity-events.ts");
    expect(events).toContain('"photo_viewed"');
    expect(read("src/lib/activity-labels.ts")).toContain('photo_viewed: "Viewed photograph"');
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0021_investor_photo_events.sql"), "utf8").replace(/\r\n/g, "\n").replace(/--.*$/gm, "");
    expect(sql).toContain("'document_downloaded', 'information_requested',\n    'photo_viewed'");
    expect(sql).toMatch(/add column if not exists photo_id uuid;/);
    // not a foreign key: an investor-writable table must not be able to probe the internal photo register
    expect(sql).not.toMatch(/references\s/i);
  });

  it("the migration touches no policy or privilege: the trail stays append-only", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0021_investor_photo_events.sql"), "utf8").replace(/\r\n/g, "\n").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/create\s+policy|drop\s+policy|grant|revoke|disable\s+row/i);
  });
});
