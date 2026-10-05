// ============================================================================
// Investor photos: a photograph reaches a DILIGENCE-tier entitlement, and only if
// staff cleared THAT photo to `diligence`. Nothing else, to no one else.
// ----------------------------------------------------------------------------
// Through real Postgres RLS, as investor-location.test.ts does: every assertion
// runs inside withInvestorSession(), which presents nothing but the auth user id,
// and no permission function is mocked. Migration 0020 is what is under test.
//
// Seeded tiers (see src/lib/db/seed.ts):
//   Kitano  - 58 Queens Gate: DILIGENCE.  120 Fenchurch, Herengracht: standard.
//   Sakura  - 120 Fenchurch: standard.  No entitlement to 58 Queens Gate.
//
// The seeded properties carry no photographs, so this test adds some directly
// (admin connection) and removes them afterwards.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { adminQuery, withInvestorSession } from "@/lib/db/client";
import { investorAuthUserId, profileIdByEmail, publicationByOpportunityName } from "./helpers";

const KITANO = "principal@kitano-fo.example";
const SAKURA = "partner@sakura-cap.example";

let kitano: string;
let sakura: string;
let uploader: string;
let queensGate: Awaited<ReturnType<typeof publicationByOpportunityName>>;
let fenchurch: Awaited<ReturnType<typeof publicationByOpportunityName>>;
let qgProperty: { property_id: string; org_id: string };
let fenProperty: { property_id: string; org_id: string };
const made: string[] = [];

async function propertyOf(opportunityId: string) {
  const r = await adminQuery<{ property_id: string; org_id: string }>(
    "select p.property_id, p.org_id from opportunities o join properties p on p.property_id = o.property_id where o.opportunity_id = $1",
    [opportunityId]);
  return r[0];
}

/** A photograph row, as staff would have left it. `order` fixes created_at so ties are deterministic. */
async function photo(
  prop: { property_id: string; org_id: string },
  o: { visibility: "internal" | "diligence"; headline?: boolean; sort: number },
): Promise<string> {
  const r = await adminQuery<{ photo_id: string }>(
    `insert into property_photos (org_id, property_id, object_path, mime_type, is_headline, sort_order, visibility, uploaded_by)
     values ($1, $2, $3, 'image/jpeg', $4, $5, $6, $7) returning photo_id`,
    [prop.org_id, prop.property_id, `properties/test/${randomUUID()}.jpg`, o.headline ?? false, o.sort, o.visibility, uploader]);
  made.push(r[0].photo_id);
  return r[0].photo_id;
}

const gallery = (uid: string, pub: string) => withInvestorSession(uid, (tx) =>
  tx.query<{ photo_id: string; is_headline: boolean; sort_order: number; caption: string | null }>(
    "select * from app.investor_publication_photos($1)", [pub])).then((r) => r.rows);
const one = (uid: string, id: string) => withInvestorSession(uid, (tx) =>
  tx.query<{ object_path: string; mime_type: string }>("select * from app.investor_photo($1)", [id])).then((r) => r.rows);
const feedHeadline = (uid: string, pub: string) => withInvestorSession(uid, (tx) =>
  tx.query<{ document_access_level: string; headline_photo_id: string | null }>(
    "select document_access_level, headline_photo_id from investor_feed where publication_id = $1", [pub])).then((r) => r.rows);

let qgInternalHeadline: string;
let qgB: string; // diligence, sort 1
let qgA: string; // diligence, sort 2
let qgInternal: string; // internal gallery photo
let fenDiligence: string; // diligence-visible, but on a property Kitano/Sakura only hold STANDARD for

beforeAll(async () => {
  [kitano, sakura] = await Promise.all([investorAuthUserId(KITANO), investorAuthUserId(SAKURA)]);
  uploader = await profileIdByEmail("analyst@meiji.com");
  queensGate = await publicationByOpportunityName("58 Queens Gate");
  fenchurch = await publicationByOpportunityName("120 Fenchurch Street");
  qgProperty = await propertyOf(queensGate.opportunityId);
  fenProperty = await propertyOf(fenchurch.opportunityId);

  qgInternalHeadline = await photo(qgProperty, { visibility: "internal", headline: true, sort: 1 });
  qgA = await photo(qgProperty, { visibility: "diligence", sort: 3 });
  qgB = await photo(qgProperty, { visibility: "diligence", sort: 2 });
  qgInternal = await photo(qgProperty, { visibility: "internal", sort: 4 });
  fenDiligence = await photo(fenProperty, { visibility: "diligence", headline: true, sort: 1 });
});

afterAll(async () => {
  if (made.length) await adminQuery("delete from property_photos where photo_id = any($1::uuid[])", [made]);
});

describe("a diligence-tier entitlement sees exactly the diligence-visible photographs", () => {
  it("Kitano, diligence on 58 Queens Gate: the two cleared photos, in display order, and no more", async () => {
    const rows = await gallery(kitano, queensGate.publicationId);
    expect(rows.map((r) => r.photo_id)).toEqual([qgB, qgA]);
    expect(rows.every((r) => r.photo_id !== qgInternalHeadline && r.photo_id !== qgInternal)).toBe(true);
  });

  it("each cleared photo resolves to a stored object; the answer carries a path for the SERVER to sign", async () => {
    for (const id of [qgA, qgB]) {
      const r = await one(kitano, id);
      expect(r).toHaveLength(1);
      expect(r[0].mime_type).toBe("image/jpeg");
      expect(r[0].object_path).toMatch(/^properties\/test\//);
    }
  });

  it("the teaser photo is the EARLIEST cleared photo even though the internally-marked headline is internal", async () => {
    const row = (await feedHeadline(kitano, queensGate.publicationId))[0];
    expect(row.document_access_level).toBe("diligence");
    expect(row.headline_photo_id).toBe(qgB);          // sort 2 beats sort 3
    expect(row.headline_photo_id).not.toBe(qgInternalHeadline);
  });

  it("clearing the internally-marked headline makes it the teaser (headline first when cleared)", async () => {
    await adminQuery("update property_photos set visibility = 'diligence' where photo_id = $1", [qgInternalHeadline]);
    try {
      expect((await feedHeadline(kitano, queensGate.publicationId))[0].headline_photo_id).toBe(qgInternalHeadline);
      expect((await gallery(kitano, queensGate.publicationId))[0].photo_id).toBe(qgInternalHeadline);
    } finally {
      await adminQuery("update property_photos set visibility = 'internal' where photo_id = $1", [qgInternalHeadline]);
    }
  });

  it("withdrawing a photo (back to internal) removes it at once, from an already-published publication", async () => {
    await adminQuery("update property_photos set visibility = 'internal' where photo_id = $1", [qgB]);
    try {
      expect((await gallery(kitano, queensGate.publicationId)).map((r) => r.photo_id)).toEqual([qgA]);
      expect(await one(kitano, qgB)).toEqual([]);
      expect((await feedHeadline(kitano, queensGate.publicationId))[0].headline_photo_id).toBe(qgA);
    } finally {
      await adminQuery("update property_photos set visibility = 'diligence' where photo_id = $1", [qgB]);
    }
  });
});

describe("an internal photograph is never retrievable by an investor, by any route", () => {
  it("not by id, not in the gallery, not in the feed, not from the table", async () => {
    for (const id of [qgInternal, qgInternalHeadline]) {
      expect(await one(kitano, id), "investor_photo").toEqual([]);
      expect((await gallery(kitano, queensGate.publicationId)).map((r) => r.photo_id)).not.toContain(id);
      expect((await feedHeadline(kitano, queensGate.publicationId))[0].headline_photo_id).not.toBe(id);
      const direct = await withInvestorSession(kitano, (tx) =>
        tx.query("select photo_id from property_photos where photo_id = $1", [id]));
      expect(direct.rows).toEqual([]);
    }
  });

  it("an investor reads no row of property_photos at all, whatever its visibility", async () => {
    for (const uid of [kitano, sakura]) {
      const r = await withInvestorSession(uid, (tx) => tx.query("select count(*)::int as n from property_photos"));
      expect((r.rows[0] as { n: number }).n).toBe(0);
    }
  });
});

describe("a photograph marked diligence still needs a diligence-tier ENTITLEMENT", () => {
  it("Kitano is standard on 120 Fenchurch Street: its cleared photo is invisible to them", async () => {
    expect(await gallery(kitano, fenchurch.publicationId)).toEqual([]);
    expect(await one(kitano, fenDiligence)).toEqual([]);
    const row = (await feedHeadline(kitano, fenchurch.publicationId))[0];
    expect(row.document_access_level).toBe("standard");
    expect(row.headline_photo_id).toBeNull();
  });

  it("the tier is per publication, not per investor: Kitano is diligence on one and standard on another", async () => {
    expect((await gallery(kitano, queensGate.publicationId)).length).toBeGreaterThan(0);
    expect(await gallery(kitano, fenchurch.publicationId)).toEqual([]);
  });

  it("Sakura is standard on 120 Fenchurch Street: nothing", async () => {
    expect(await gallery(sakura, fenchurch.publicationId)).toEqual([]);
    expect(await one(sakura, fenDiligence)).toEqual([]);
    expect((await feedHeadline(sakura, fenchurch.publicationId))[0].headline_photo_id).toBeNull();
  });

  it("no investor's home feed carries a teaser photo for a standard entitlement", async () => {
    for (const uid of [kitano, sakura]) {
      const { rows } = await withInvestorSession(uid, (tx) =>
        tx.query<{ document_access_level: string; headline_photo_id: string | null }>(
          "select document_access_level, headline_photo_id from investor_feed"));
      for (const r of rows.filter((x) => x.document_access_level === "standard")) expect(r.headline_photo_id).toBeNull();
    }
  });
});

describe("tenants are separate", () => {
  it("a photo visible to Kitano's entitlement is never returned to Sakura, who has none for that publication", async () => {
    expect(await feedHeadline(sakura, queensGate.publicationId)).toEqual([]);
    expect(await gallery(sakura, queensGate.publicationId)).toEqual([]);
    for (const id of [qgA, qgB]) expect(await one(sakura, id)).toEqual([]);
  });

  it("naming another publication does not borrow its entitlement", async () => {
    // Sakura holds standard on Fenchurch; asking for Fenchurch's gallery returns
    // nothing, and asking for Queens Gate's photo by id is no different.
    expect(await gallery(sakura, fenchurch.publicationId)).toEqual([]);
    expect(await one(sakura, qgA)).toEqual([]);
  });

  it("an entitlement that is hidden returns nothing, at once", async () => {
    const e = await adminQuery<{ entitlement_id: string }>(
      `select e.entitlement_id from publication_entitlements e
        where e.publication_id = $1 and e.investor_org_id = (select investor_org_id from investor_contacts where auth_user_id = $2)`,
      [queensGate.publicationId, kitano]);
    await adminQuery("update publication_entitlements set is_visible = false where entitlement_id = $1", [e[0].entitlement_id]);
    try {
      expect(await gallery(kitano, queensGate.publicationId)).toEqual([]);
      expect(await one(kitano, qgA)).toEqual([]);
      expect(await feedHeadline(kitano, queensGate.publicationId)).toEqual([]);
    } finally {
      await adminQuery("update publication_entitlements set is_visible = true where entitlement_id = $1", [e[0].entitlement_id]);
    }
  });

  it("an unknown or malformed id answers with no row, like every other refusal", async () => {
    expect(await one(kitano, randomUUID())).toEqual([]);
    expect(await gallery(kitano, randomUUID())).toEqual([]);
  });
});

describe("function privileges", () => {
  it("EXECUTE is granted to authenticated only; anon and public cannot call the bridge", async () => {
    for (const fn of ["app.investor_photo(uuid)", "app.investor_publication_photos(uuid)", "app.investor_publication_headline_photo(uuid)"]) {
      const r = await adminQuery<{ anon: boolean; authenticated: boolean; pub: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authenticated,
                has_function_privilege('public', $1, 'execute') as pub`, [fn]);
      expect(r[0], fn).toEqual({ anon: false, authenticated: true, pub: false });
    }
  });

  it("each is SECURITY DEFINER with an empty search_path", async () => {
    const r = await adminQuery<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `select proname, prosecdef, proconfig from pg_proc
        where pronamespace = 'app'::regnamespace
          and proname in ('investor_photo', 'investor_publication_photos', 'investor_publication_headline_photo')`);
    expect(r).toHaveLength(3);
    for (const f of r) {
      expect(f.prosecdef, f.proname).toBe(true);
      expect(f.proconfig, f.proname).toContain("search_path=\"\"");
    }
  });
});
