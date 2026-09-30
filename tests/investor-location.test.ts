// ============================================================================
// Investor location: the pin reaches a DILIGENCE-tier entitlement and no one else.
// ----------------------------------------------------------------------------
// Through real Postgres RLS, as investor-rls.test.ts does: every assertion runs
// inside withInvestorSession(), which presents nothing but the auth user id, and
// no permission function is mocked. Migration 0018 is what is under test.
//
// Seeded tiers (see src/lib/db/seed.ts):
//   Kitano  - 58 Queens Gate: DILIGENCE.  120 Fenchurch, Herengracht: standard.
//   Sakura  - 120 Fenchurch: standard.  No entitlement to 58 Queens Gate.
//
// The seeded properties carry no coordinates, so this test gives two of them a
// confirmed, fresh geocode, and puts them back afterwards.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, withInvestorSession } from "@/lib/db/client";
import { investorAuthUserId, publicationByOpportunityName } from "./helpers";

const KITANO = "principal@kitano-fo.example";
const SAKURA = "partner@sakura-cap.example";

let kitano: string;
let sakura: string;
let queensGate: Awaited<ReturnType<typeof publicationByOpportunityName>>;
let fenchurch: Awaited<ReturnType<typeof publicationByOpportunityName>>;
let herengracht: Awaited<ReturnType<typeof publicationByOpportunityName>>;

type Saved = { property_id: string; latitude: string | null; longitude: string | null; geocode_status: string; geocoded_at: string | null };
const saved: Saved[] = [];

async function propertyOf(opportunityId: string): Promise<string> {
  const r = await adminQuery<{ property_id: string }>(
    "select property_id from opportunities where opportunity_id = $1", [opportunityId]);
  return r[0].property_id;
}

async function setGeocode(propertyId: string, status: string, ageDays: number | null, lat: number | null, lng: number | null) {
  await adminQuery(
    `update properties set latitude = $2, longitude = $3, geocode_status = $4,
            geocoded_at = case when $5::int is null then null else now() - ($5::int * interval '1 day') end
      where property_id = $1`, [propertyId, lat, lng, status, ageDays]);
}

beforeAll(async () => {
  [kitano, sakura] = await Promise.all([investorAuthUserId(KITANO), investorAuthUserId(SAKURA)]);
  queensGate = await publicationByOpportunityName("58 Queens Gate");
  fenchurch = await publicationByOpportunityName("120 Fenchurch Street");
  herengracht = await publicationByOpportunityName("Herengracht 124");
  for (const p of [queensGate, fenchurch, herengracht]) {
    const id = await propertyOf(p.opportunityId);
    const before = await adminQuery<Saved>(
      "select property_id, latitude::text, longitude::text, geocode_status, geocoded_at::text from properties where property_id = $1", [id]);
    saved.push(before[0]);
    await setGeocode(id, "ok", 3, 51.5158, -0.1755); // confirmed and fresh
  }
});

afterAll(async () => {
  for (const s of saved) {
    await adminQuery(
      "update properties set latitude = $2, longitude = $3, geocode_status = $4, geocoded_at = $5::timestamptz where property_id = $1",
      [s.property_id, s.latitude, s.longitude, s.geocode_status, s.geocoded_at]);
  }
});

async function feedLocation(uid: string, publicationId: string) {
  const { rows } = await withInvestorSession(uid, (tx) =>
    tx.query<{ latitude: string | null; longitude: string | null; document_access_level: string }>(
      "select document_access_level, latitude, longitude from investor_feed where publication_id = $1", [publicationId]));
  return rows;
}

describe("a diligence-tier entitlement sees the pin", () => {
  it("Kitano, diligence on 58 Queens Gate, gets the coordinates", async () => {
    const rows = await feedLocation(kitano, queensGate.publicationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].document_access_level).toBe("diligence");
    expect(Number(rows[0].latitude)).toBeCloseTo(51.5158, 4);
    expect(Number(rows[0].longitude)).toBeCloseTo(-0.1755, 4);
  });
});

describe("a standard-tier entitlement NEVER sees it", () => {
  it("Kitano is standard on 120 Fenchurch Street: the row is visible, the coordinates are null", async () => {
    const rows = await feedLocation(kitano, fenchurch.publicationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].document_access_level).toBe("standard");
    expect(rows[0].latitude).toBeNull();
    expect(rows[0].longitude).toBeNull();
  });

  it("the tier is per publication, not per investor: Kitano is diligence on one and standard on another", async () => {
    const [qg, hg] = await Promise.all([feedLocation(kitano, queensGate.publicationId), feedLocation(kitano, herengracht.publicationId)]);
    expect(qg[0].latitude).not.toBeNull();
    expect(hg[0].latitude).toBeNull();
  });

  it("Sakura is standard on 120 Fenchurch Street: null", async () => {
    const rows = await feedLocation(sakura, fenchurch.publicationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].latitude).toBeNull();
    expect(rows[0].longitude).toBeNull();
  });

  it("no investor's home feed, in any tier, carries a coordinate for a standard entitlement", async () => {
    const { rows } = await withInvestorSession(sakura, (tx) =>
      tx.query<{ document_access_level: string; latitude: string | null }>("select document_access_level, latitude from investor_feed"));
    for (const r of rows.filter((x) => x.document_access_level === "standard")) expect(r.latitude).toBeNull();
  });
});

describe("no entitlement, no row, no pin", () => {
  it("Sakura has no entitlement to 58 Queens Gate: nothing from the feed", async () => {
    expect(await feedLocation(sakura, queensGate.publicationId)).toEqual([]);
  });

  it("calling the helper directly is no way round it", async () => {
    const call = (uid: string, pub: string) => withInvestorSession(uid, (tx) =>
      tx.query("select * from app.investor_publication_location($1)", [pub]));
    expect((await call(kitano, queensGate.publicationId)).rows).toHaveLength(1);       // diligence
    expect((await call(kitano, fenchurch.publicationId)).rows).toHaveLength(0);        // standard
    expect((await call(sakura, queensGate.publicationId)).rows).toHaveLength(0);       // no entitlement
    expect((await call(sakura, fenchurch.publicationId)).rows).toHaveLength(0);        // standard
  });

  it("a diligence investor still reads nothing from properties directly", async () => {
    const { rows } = await withInvestorSession(kitano, (tx) => tx.query<{ n: number }>("select count(*)::int as n from properties"));
    expect(rows[0].n).toBe(0);
  });
});

describe("the diligence pin still respects Google's 30-day limit", () => {
  const qgProperty = () => propertyOf(queensGate.opportunityId);

  it.each([
    ["an expired geocode", "ok", 45, 51.5, -0.1],
    ["a no_match", "no_match", 3, null, null],
    ["coordinates entered by hand (never geocoded)", "pending", null, 51.4, -0.2],
    ["a failed geocode", "failed", 3, null, null],
  ] as const)("returns nothing for %s, even at diligence", async (_name, status, age, lat, lng) => {
    const id = await qgProperty();
    await setGeocode(id, status, age, lat, lng);
    try {
      const rows = await feedLocation(kitano, queensGate.publicationId);
      expect(rows).toHaveLength(1);
      expect(rows[0].latitude).toBeNull();
      expect(rows[0].longitude).toBeNull();
    } finally {
      await setGeocode(id, "ok", 3, 51.5158, -0.1755);
    }
  });

  it("returns it again once the geocode is refreshed", async () => {
    const rows = await feedLocation(kitano, queensGate.publicationId);
    expect(rows[0].latitude).not.toBeNull();
  });
});
