// ============================================================================
// The Asset Snapshot's inputs against real Postgres: the photograph is chosen the
// way the investor teaser card chooses it (cleared photos only), the address is
// the recorded street address, and the whole thing composes from a real loader.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, type Session } from "@/lib/db/client";
import { createOpportunity } from "@/lib/data/opportunities";
import { createVersion } from "@/lib/data/underwriting";
import { loadMemoSource } from "@/lib/data/memos";
import { loadSnapshotAsset } from "@/lib/data/snapshot-source";
import { composeMemo } from "@/lib/memo/compose";
import { orgIdByName, orgUserSession, viewerSession, profileIdByEmail } from "./helpers";

let session: Session;
let viewer: Session;
let aoyama: Session;
let meiji: string;
let n = 0;

async function deal(over: Record<string, unknown> = {}) {
  const opp = await createOpportunity(session, {
    orgId: meiji, name: `Snapshot ${++n}`, city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "value_add", currency: "GBP",
    // A distinct street per deal: the same address is the same PROPERTY, and a property has one headline.
    address: `${100 + n} Queens Gate`, postcode: "SW7 5JW", ...over,
  });
  const property = (await adminQuery<{ property_id: string }>("select property_id from opportunities where opportunity_id = $1", [opp]))[0].property_id;
  return { opp, property, address: `${100 + n} Queens Gate, London, SW7 5JW` };
}

const photo = (property: string, o: { visibility: string; headline?: boolean; sort?: number; created?: string }) => adminQuery<{ photo_id: string }>(
  `insert into property_photos (org_id, property_id, object_path, mime_type, is_headline, sort_order, visibility, uploaded_by, created_at)
   values ($1, $2, 'p/' || gen_random_uuid(), 'image/jpeg', $3, $4, $5, $6, coalesce($7::timestamptz, now())) returning photo_id`,
  [meiji, property, o.headline ?? false, o.sort ?? 0, o.visibility, session.userId, o.created ?? null]).then((r) => r[0].photo_id);

interface Row { currency: string; rate_to_gbp: string; as_of_date: string; source: string }
let fxBefore: Row[];

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  session = orgUserSession([meiji], await profileIdByEmail("analyst@meiji.com"));
  viewer = viewerSession([meiji], await profileIdByEmail("viewer@meiji.com"));
  aoyama = orgUserSession([await orgIdByName("Aoyama Holdings")], await profileIdByEmail("user@aoyama.com"));
  fxBefore = await adminQuery<Row>("select currency, rate_to_gbp::text, as_of_date::text, source from fx_rates");
});
afterAll(async () => {
  for (const r of fxBefore) await adminQuery("update fx_rates set rate_to_gbp=$2, as_of_date=$3, source=$4 where currency=$1", [r.currency, r.rate_to_gbp, r.as_of_date, r.source]);
});

describe("the photograph on the Snapshot is one staff have cleared", () => {
  it("never uses an internal-only photograph, even when it is the headline", async () => {
    const { opp, property } = await deal();
    await photo(property, { visibility: "internal", headline: true });
    await photo(property, { visibility: "internal", sort: 1 });
    expect((await loadSnapshotAsset(session, opp)).photoId).toBeNull();
  });

  it("uses the headline when it has been cleared", async () => {
    const { opp, property } = await deal();
    const cleared = await photo(property, { visibility: "diligence", headline: true });
    await photo(property, { visibility: "diligence", sort: 1 });
    expect((await loadSnapshotAsset(session, opp)).photoId).toBe(cleared);
  });

  it("otherwise the first cleared gallery photo, by order: the investor teaser card's rule", async () => {
    const { opp, property } = await deal();
    await photo(property, { visibility: "internal", headline: true });
    await photo(property, { visibility: "diligence", sort: 5 });
    const first = await photo(property, { visibility: "diligence", sort: 2 });
    expect((await loadSnapshotAsset(session, opp)).photoId).toBe(first);
  });

  it("clearing a photograph later is picked up on the next composition", async () => {
    const { opp, property } = await deal();
    const p = await photo(property, { visibility: "internal", headline: true });
    expect((await loadSnapshotAsset(session, opp)).photoId).toBeNull();
    await adminQuery("update property_photos set visibility = 'diligence' where photo_id = $1", [p]);
    expect((await loadSnapshotAsset(session, opp)).photoId).toBe(p);
  });
});

describe("the address and reference", () => {
  it("joins the recorded street address, city and postcode", async () => {
    const { opp, address } = await deal();
    expect((await loadSnapshotAsset(session, opp)).addressLine).toBe(address);
  });

  it("is null without a street address: a city alone is not an address", async () => {
    const { opp } = await deal({ address: null, postcode: null, name: `NoAddr ${++n}` });
    expect((await loadSnapshotAsset(session, opp)).addressLine).toBeNull();
  });

  it("reads the opportunity's reference when one is recorded", async () => {
    const { opp } = await deal();
    const ref = `RC-T-${Date.now()}`;
    expect((await loadSnapshotAsset(session, opp)).reference).toBeNull();
    await adminQuery("update opportunities set reference = $2 where opportunity_id = $1", [opp, ref]);
    expect((await loadSnapshotAsset(session, opp)).reference).toBe(ref);
  });
});

describe("RLS still decides who sees any of it", () => {
  it("another organisation reads no address, no reference and no photograph", async () => {
    const { opp, property } = await deal();
    await photo(property, { visibility: "diligence", headline: true });
    expect(await loadSnapshotAsset(aoyama, opp)).toEqual({ reference: null, addressLine: null, photoId: null });
  });

  it("the loader for the whole memo returns null to them", async () => {
    const { opp } = await deal();
    expect(await loadMemoSource(aoyama, opp)).toBeNull();
  });

  it("a read-only member of the organisation can compose it too (it is a read)", async () => {
    const { opp, address } = await deal();
    expect((await loadMemoSource(viewer, opp))!.asset.addressLine).toBe(address);
  });
});

describe("a whole snapshot from the real loader", () => {
  it("composes the price, the yen equivalent from the stored JPY rate, the address, and the cleared photograph", async () => {
    await adminQuery("update fx_rates set rate_to_gbp = 0.0052, as_of_date = current_date, source = 'ECB reference rate (auto)' where currency = 'JPY'");
    const { opp, property, address } = await deal();
    const p = await photo(property, { visibility: "diligence", headline: true });
    await createVersion(session, opp, { acquisitionPrice: 26_000_000, entryYieldPct: 5.25, grossRentalIncome: 1_400_000, erv: 1_600_000, occupancyPct: 90, capex: 900_000 });
    await adminQuery("update opportunities set size_sqm = 2500 where opportunity_id = $1", [opp]);

    const snap = composeMemo((await loadMemoSource(session, opp))!).snapshot!;
    expect(snap).toMatchObject({
      price: 26_000_000, niyPct: 5.25, passingRent: 1_400_000, erv: 1_600_000, occupancyPct: 90, capex: 900_000,
      addressLine: address, photoId: p, basisLabel: "Reiwa underwriting v1 (working version, not yet approved)",
    });
    expect(snap.priceJpy).toBeCloseTo(26_000_000 / 0.0052, 0);
    expect(snap.area!.tsubo).toBeCloseTo(2500 / 3.30578, 6);
    expect(snap.fx!.staleNote).toBeNull();
  });

  it("with no JPY rate there is no yen figure and the gap says so", async () => {
    await adminQuery("delete from fx_rates where currency = 'JPY'");
    try {
      const { opp } = await deal();
      await createVersion(session, opp, { acquisitionPrice: 10_000_000 });
      const snap = composeMemo((await loadMemoSource(session, opp))!).snapshot!;
      expect(snap.priceJpy).toBeNull();
      expect(snap.gaps.find((g) => g.key === "jpy")?.why).toMatch(/No JPY exchange rate/);
    } finally {
      const r = fxBefore.find((x) => x.currency === "JPY");
      if (r) await adminQuery("insert into fx_rates (currency, rate_to_gbp, as_of_date, source) values ($1,$2,$3,$4)", [r.currency, r.rate_to_gbp, r.as_of_date, r.source]);
    }
  });

  it("an opportunity with no underwriting at all still composes a snapshot (a thin one), never an error", async () => {
    const { opp, address } = await deal();
    const snap = composeMemo((await loadMemoSource(session, opp))!).snapshot!;
    expect(snap).toMatchObject({ price: null, priceJpy: null, niyPct: null, basisLabel: null, addressLine: address });
  });
});
