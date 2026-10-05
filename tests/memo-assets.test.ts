// ============================================================================
// A finalised Asset Snapshot's pictures are FROZEN: copied into the memo's own private
// location at finalisation, so deleting or re-marking the originals later cannot change a
// document that has already been sent. And a map is a second kind of the same row.
// Real Postgres and real Storage (the local stand-in), no mocked permission anywhere.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { adminQuery, withInvestorSession, type Session } from "@/lib/db/client";
import { createOpportunity } from "@/lib/data/opportunities";
import { createVersion } from "@/lib/data/underwriting";
import { loadMemoSource, createMemoDraft, getMemo, recomposeDraft, listMemos } from "@/lib/data/memos";
import { finaliseMemoFreezingAssets, issueMemoAssetDownload } from "@/lib/data/memo-assets";
import {
  recordPhoto, setPhotoVisibility, deletePhotoRow, listPropertyPhotos, setHeadline, reorderPhotos,
} from "@/lib/data/property-photos";
import { composeMemo } from "@/lib/memo/compose";
import { ensurePhotoBucket, putPhotoObject, deletePhotoObject } from "@/lib/photos/storage";
import { liveRefsIn } from "@/lib/memo/assets";
import { investorAuthUserId, orgIdByName, orgUserSession, viewerSession, profileIdByEmail, publicationByOpportunityName } from "./helpers";

let session: Session;
let viewer: Session;
let otherOrg: Session;
let meiji: string;
let n = 0;
const RUN = String(Date.now()).slice(-6);
const cleanup: (() => Promise<unknown>)[] = [];

const jpeg = (colour: string) => sharp({ create: { width: 120, height: 80, channels: 3, background: colour } }).jpeg().toBuffer();
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A deal with a property, an underwriting version and an address: enough for a Snapshot. */
async function deal() {
  const opp = await createOpportunity(session, {
    orgId: meiji, name: `Freeze ${++n}`, city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "value_add", currency: "GBP", // A distinct street per deal AND per run: the same address is the same PROPERTY, and its pictures persist.
    address: `${RUN}${500 + n} Freeze Street`,
  });
  await createVersion(session, opp, { acquisitionPrice: 40_000_000 });
  const property = (await adminQuery<{ property_id: string }>("select property_id from opportunities where opportunity_id = $1", [opp]))[0].property_id;
  return { opp, property };
}

/** A stored picture of the given kind: real bytes in the real bucket, a real row, cleared to diligence. */
async function picture(property: string, kind: "building" | "map", colour: string, visibility: "diligence" | "internal" = "diligence") {
  const bytes = await jpeg(colour);
  const objectPath = `properties/${property}/${randomUUID()}.jpg`;
  await putPhotoObject(objectPath, bytes, "image/jpeg");
  const photoId = await recordPhoto(session, { propertyId: property, objectPath, mimeType: "image/jpeg", asHeadline: kind === "building", kind });
  if (visibility === "diligence") await setPhotoVisibility(session, property, photoId, "diligence");
  cleanup.push(() => deletePhotoObject(objectPath));
  return { photoId, objectPath, bytes: new Uint8Array(bytes) };
}

async function draftFor(opp: string) {
  const memoId = await createMemoDraft(session, opp, composeMemo((await loadMemoSource(session, opp))!));
  return memoId;
}

/** What the browser would receive: follow the route's signed URL and read the bytes. */
async function bytesOf(memoId: string, slot: "photo" | "map", as: Session = session): Promise<Uint8Array | null> {
  const url = await issueMemoAssetDownload(as, memoId, slot);
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

beforeAll(async () => {
  await ensurePhotoBucket();
  meiji = await orgIdByName("Meiji Shipping");
  session = orgUserSession([meiji], await profileIdByEmail("analyst@meiji.com"));
  viewer = viewerSession([meiji], await profileIdByEmail("viewer@meiji.com"));
  otherOrg = orgUserSession([await orgIdByName("Aoyama Holdings")], await profileIdByEmail("user@aoyama.com"));
});
afterAll(async () => { for (const c of cleanup) await c().catch(() => {}); });

describe("finalising freezes the pictures into the memo's own copy", () => {
  it("copies the bytes, keys the copy by the MEMO, and leaves no reference to the photograph in the stored content", async () => {
    const { opp, property } = await deal();
    const photo = await picture(property, "building", "#336699");
    const map = await picture(property, "map", "#339966");
    const memoId = await draftFor(opp);

    expect(liveRefsIn(JSON.parse(JSON.stringify((await getMemo(session, memoId))!.content)))).toHaveLength(2);
    await finaliseMemoFreezingAssets(session, memoId);

    const memo = (await getMemo(session, memoId))!;
    expect(memo.status).toBe("final");
    expect(memo.content.snapshot!.photo).toMatchObject({ source: "frozen", path: expect.stringMatching(new RegExp(`^memos/${memoId}/photo-[0-9a-f]{16}\\.jpg$`)) });
    expect(memo.content.snapshot!.map).toMatchObject({ source: "frozen", path: expect.stringMatching(new RegExp(`^memos/${memoId}/map-[0-9a-f]{16}\\.jpg$`)) });

    // The raw stored row: no photograph id and no live reference anywhere in it.
    const raw = (await adminQuery<{ c: string }>("select content::text as c from memos where memo_id = $1", [memoId]))[0].c;
    expect(raw).not.toContain(photo.photoId);
    expect(raw).not.toContain(map.photoId);
    expect(raw).not.toContain('"live"');

    // And what the route serves is the very bytes that were copied.
    expect(sha((await bytesOf(memoId, "photo"))!)).toBe(sha(photo.bytes));
    expect(sha((await bytesOf(memoId, "map"))!)).toBe(sha(map.bytes));
  });

  it("DELETING the source photograph and map afterwards does not change what a reprint shows", async () => {
    const { opp, property } = await deal();
    const photo = await picture(property, "building", "#aa3333");
    const map = await picture(property, "map", "#3333aa");
    const memoId = await draftFor(opp);
    await finaliseMemoFreezingAssets(session, memoId);
    const before = (await getMemo(session, memoId))!.content.snapshot;

    for (const p of [photo, map]) {
      await deletePhotoRow(session, property, p.photoId);
      await deletePhotoObject(p.objectPath);
    }
    expect((await adminQuery("select 1 from property_photos where photo_id = any($1::uuid[])", [[photo.photoId, map.photoId]]))).toHaveLength(0);

    expect((await getMemo(session, memoId))!.content.snapshot).toEqual(before);
    expect(sha((await bytesOf(memoId, "photo"))!)).toBe(sha(photo.bytes));
    expect(sha((await bytesOf(memoId, "map"))!)).toBe(sha(map.bytes));
  });

  it("RE-MARKING the source internal afterwards does not change what a reprint shows", async () => {
    const { opp, property } = await deal();
    const photo = await picture(property, "building", "#aaaa33");
    const map = await picture(property, "map", "#33aaaa");
    const memoId = await draftFor(opp);
    await finaliseMemoFreezingAssets(session, memoId);

    await setPhotoVisibility(session, property, photo.photoId, "internal");
    await setPhotoVisibility(session, property, map.photoId, "internal");

    expect(sha((await bytesOf(memoId, "photo"))!)).toBe(sha(photo.bytes));
    expect(sha((await bytesOf(memoId, "map"))!)).toBe(sha(map.bytes));
    // A fresh composition now finds nothing cleared, but the FINAL memo is untouched by that.
    const live = composeMemo((await loadMemoSource(session, opp))!).snapshot!;
    expect(live.photo).toBeNull();
    expect(live.map).toBeNull();
    expect((await getMemo(session, memoId))!.content.snapshot!.photo).toMatchObject({ source: "frozen" });
  });

  it("REPLACING the headline photograph afterwards does not change what the final memo shows", async () => {
    const { opp, property } = await deal();
    const first = await picture(property, "building", "#112233");
    const memoId = await draftFor(opp);
    await finaliseMemoFreezingAssets(session, memoId);
    const second = await picture(property, "building", "#445566");
    await setHeadline(session, property, second.photoId);
    expect(sha((await bytesOf(memoId, "photo"))!)).toBe(sha(first.bytes));
  });

  it("a memo with no pictures finalises exactly as before, and has nothing to serve", async () => {
    const { opp } = await deal();
    const memoId = await draftFor(opp);
    await finaliseMemoFreezingAssets(session, memoId);
    const memo = (await getMemo(session, memoId))!;
    expect(memo.status).toBe("final");
    expect(memo.content.snapshot!.photo).toBeNull();
    expect(await issueMemoAssetDownload(session, memoId, "photo")).toBeNull();
  });

  it("a final memo cannot be changed afterwards, content included (the existing guard still holds)", async () => {
    const { opp, property } = await deal();
    await picture(property, "building", "#778899");
    const memoId = await draftFor(opp);
    await finaliseMemoFreezingAssets(session, memoId);
    await expect(adminQuery("update memos set content = '{}'::jsonb where memo_id = $1", [memoId])).rejects.toThrow();
    await expect(finaliseMemoFreezingAssets(session, memoId)).rejects.toThrow(/Only a draft memo can be finalised/);
  });
});

describe("a DRAFT still reflects live changes", () => {
  it("keeps live references and serves nothing from the frozen store", async () => {
    const { opp, property } = await deal();
    const p = await picture(property, "building", "#010203");
    const memoId = await draftFor(opp);
    const draft = (await getMemo(session, memoId))!;
    expect(draft.content.snapshot!.photo).toEqual({ source: "live", photoId: p.photoId });
    expect(await issueMemoAssetDownload(session, memoId, "photo")).toBeNull();
  });

  it("follows a changed photograph on recompose", async () => {
    const { opp, property } = await deal();
    const a = await picture(property, "building", "#0a0a0a");
    const memoId = await draftFor(opp);
    expect((await getMemo(session, memoId))!.content.snapshot!.photo).toEqual({ source: "live", photoId: a.photoId });
    await setPhotoVisibility(session, property, a.photoId, "internal");
    const b = await picture(property, "building", "#0b0b0b");
    await setHeadline(session, property, b.photoId);
    await recomposeDraft(session, memoId, composeMemo((await loadMemoSource(session, opp))!));
    expect((await getMemo(session, memoId))!.content.snapshot!.photo).toEqual({ source: "live", photoId: b.photoId });
  });
});

describe("finalising refuses a picture that is gone or no longer cleared, and locks nothing", () => {
  const still = async (memoId: string) => {
    const m = (await getMemo(session, memoId))!;
    expect(m.status).toBe("draft");
    expect(liveRefsIn(JSON.parse(JSON.stringify(m.content))).length).toBeGreaterThan(0);
  };

  it("withdrawn (re-marked internal) since the draft was composed", async () => {
    const { opp, property } = await deal();
    const p = await picture(property, "building", "#111111");
    const memoId = await draftFor(opp);
    await setPhotoVisibility(session, property, p.photoId, "internal");
    await expect(finaliseMemoFreezingAssets(session, memoId)).rejects.toThrow(/no longer available or is no longer cleared for investors/);
    await still(memoId);
  });

  it("deleted since the draft was composed", async () => {
    const { opp, property } = await deal();
    const p = await picture(property, "map", "#222222");
    const memoId = await draftFor(opp);
    await deletePhotoRow(session, property, p.photoId);
    await expect(finaliseMemoFreezingAssets(session, memoId)).rejects.toThrow(/no longer available/);
    await still(memoId);
  });

  it("its stored object is missing", async () => {
    const { opp, property } = await deal();
    const p = await picture(property, "building", "#333333");
    const memoId = await draftFor(opp);
    await deletePhotoObject(p.objectPath);
    await expect(finaliseMemoFreezingAssets(session, memoId)).rejects.toThrow(/no longer available/);
    await still(memoId);
  });

  it("recomposing clears the refusal: the draft then finalises on the current pictures", async () => {
    const { opp, property } = await deal();
    const p = await picture(property, "building", "#444444");
    const memoId = await draftFor(opp);
    await setPhotoVisibility(session, property, p.photoId, "internal");
    await recomposeDraft(session, memoId, composeMemo((await loadMemoSource(session, opp))!));
    await finaliseMemoFreezingAssets(session, memoId);
    expect((await getMemo(session, memoId))!.status).toBe("final");
  });

  it("a different property's photograph cannot be frozen into this memo", async () => {
    const a = await deal();
    const b = await deal();
    const foreign = await picture(b.property, "building", "#555555");
    const memoId = await draftFor(a.opp);
    // Tamper with the draft's stored reference, as a bug or a hand edit might.
    await adminQuery(
      "update memos set content = jsonb_set(content, '{snapshot,photo}', $2::jsonb) where memo_id = $1",
      [memoId, JSON.stringify({ source: "live", photoId: foreign.photoId })]);
    await expect(finaliseMemoFreezingAssets(session, memoId)).rejects.toThrow(/no longer available/);
    await still(memoId);
  });
});

describe("who may read a frozen picture", () => {
  it("staff of the organisation, and nobody else: another org, a read-only member and an invented id read nothing", async () => {
    const { opp, property } = await deal();
    await picture(property, "building", "#666666");
    const memoId = await draftFor(opp);
    await finaliseMemoFreezingAssets(session, memoId);
    expect(await issueMemoAssetDownload(session, memoId, "photo")).toBeTruthy();
    expect(await issueMemoAssetDownload(otherOrg, memoId, "photo")).toBeNull();
    expect(await issueMemoAssetDownload(viewer, memoId, "photo")).toBeNull();
    expect(await issueMemoAssetDownload(session, randomUUID(), "photo")).toBeNull();
    expect(await issueMemoAssetDownload(session, "not-a-uuid", "photo")).toBeNull();
  });

  it("a path in the content that is outside this memo's own folder is never signed", async () => {
    const { opp, property } = await deal();
    const p = await picture(property, "building", "#777777");
    const memoId = await draftFor(opp);
    await adminQuery(
      "update memos set content = jsonb_set(content, '{snapshot,photo}', $2::jsonb) where memo_id = $1",
      [memoId, JSON.stringify({ source: "frozen", path: p.objectPath })]);
    expect(await issueMemoAssetDownload(session, memoId, "photo")).toBeNull();
  });
});

describe("a map is a second kind of the same row", () => {
  it("is listed apart from the building photographs, and never mixed into the gallery", async () => {
    const { property } = await deal();
    const photo = await picture(property, "building", "#808080");
    const map = await picture(property, "map", "#909090");
    expect((await listPropertyPhotos(session, property)).map((p) => p.photoId)).toEqual([photo.photoId]);
    const maps = await listPropertyPhotos(session, property, "map");
    expect(maps.map((p) => [p.photoId, p.kind, p.isHeadline])).toEqual([[map.photoId, "map", false]]);
  });

  it("starts internal like a photograph, and is never a headline: the database says so, not just the code", async () => {
    const { property } = await deal();
    const m = await picture(property, "map", "#a0a0a0", "internal");
    expect((await listPropertyPhotos(session, property, "map"))[0]).toMatchObject({ visibility: "internal", isHeadline: false });
    await expect(adminQuery("update property_photos set is_headline = true where photo_id = $1", [m.photoId])).rejects.toThrow(/property_photos_map_not_headline/);
    // Asking recordPhoto for a headline map is quietly a plain map.
    const again = await recordPhoto(session, { propertyId: property, objectPath: `properties/${property}/x-${randomUUID()}.jpg`, mimeType: "image/jpeg", asHeadline: true, kind: "map" });
    expect((await adminQuery<{ is_headline: boolean }>("select is_headline from property_photos where photo_id = $1", [again]))[0].is_headline).toBe(false);
  });

  it("cannot be made the headline or reordered into the gallery through the data layer", async () => {
    const { property } = await deal();
    const photo = await picture(property, "building", "#b0b0b0");
    const map = await picture(property, "map", "#c0c0c0");
    await expect(setHeadline(session, property, map.photoId)).rejects.toThrow(/could not be found/);
    await expect(reorderPhotos(session, property, [map.photoId, photo.photoId])).rejects.toThrow(/not part of this property/);
  });

  it("an unknown kind is refused by the database", async () => {
    const { property } = await deal();
    await expect(adminQuery(
      `insert into property_photos (org_id, property_id, object_path, mime_type, visibility, uploaded_by, kind)
       values ($1, $2, 'p/x.jpg', 'image/jpeg', 'internal', $3, 'floorplan')`,
      [meiji, property, session.userId])).rejects.toThrow(/property_photos_kind_valid/);
  });

  it("the Snapshot's map is the first CLEARED map; an internal one, and a photograph, never fill the slot", async () => {
    const { opp, property } = await deal();
    await picture(property, "building", "#d0d0d0");
    await picture(property, "map", "#e0e0e0", "internal");
    expect(composeMemo((await loadMemoSource(session, opp))!).snapshot!.map).toBeNull();
    const cleared = await picture(property, "map", "#f0f0f0");
    const snap = composeMemo((await loadMemoSource(session, opp))!).snapshot!;
    expect(snap.map).toEqual({ source: "live", photoId: cleared.photoId });
    expect(snap.photo).not.toEqual(snap.map);
    expect(snap.gaps.map((g) => g.key)).not.toContain("map");
  });

  it("with no cleared map the Snapshot shows its existing 'not yet captured' state, and says why", async () => {
    const { opp } = await deal();
    const snap = composeMemo((await loadMemoSource(session, opp))!).snapshot!;
    expect(snap.map).toBeNull();
    expect(snap.gaps.find((g) => g.key === "map")!.why).toMatch(/No map has been cleared for investors/);
  });
});

describe("a map never reaches an investor", () => {
  it("even one staff cleared to diligence is absent from the gallery, the feed and the single-photo function", async () => {
    const kitano = await investorAuthUserId("principal@kitano-fo.example");
    const pub = await publicationByOpportunityName("58 Queens Gate");
    const property = (await adminQuery<{ property_id: string; org_id: string }>(
      "select p.property_id, p.org_id from opportunities o join properties p on p.property_id = o.property_id where o.opportunity_id = $1", [pub.opportunityId]))[0];
    const uploader = await profileIdByEmail("analyst@meiji.com");
    const ins = async (kind: string) => (await adminQuery<{ photo_id: string }>(
      `insert into property_photos (org_id, property_id, object_path, mime_type, visibility, uploaded_by, kind, sort_order)
       values ($1, $2, $3, 'image/jpeg', 'diligence', $4, $5, -5) returning photo_id`,
      [property.org_id, property.property_id, `properties/test/${randomUUID()}.jpg`, uploader, kind]))[0].photo_id;
    const map = await ins("map");
    const building = await ins("building");
    cleanup.push(() => adminQuery("delete from property_photos where photo_id = any($1::uuid[])", [[map, building]]));

    const gallery = await withInvestorSession(kitano, (tx) => tx.query<{ photo_id: string }>("select photo_id from app.investor_publication_photos($1)", [pub.publicationId])).then((r) => r.rows.map((x) => x.photo_id));
    expect(gallery).toContain(building);
    expect(gallery).not.toContain(map);
    const headline = await withInvestorSession(kitano, (tx) => tx.query<{ headline_photo_id: string | null }>("select headline_photo_id from investor_feed where publication_id = $1", [pub.publicationId])).then((r) => r.rows[0]?.headline_photo_id);
    expect(headline).not.toBe(map);
    const direct = await withInvestorSession(kitano, (tx) => tx.query("select * from app.investor_photo($1)", [map]));
    expect(direct.rows).toHaveLength(0);
    const directBuilding = await withInvestorSession(kitano, (tx) => tx.query("select * from app.investor_photo($1)", [building]));
    expect(directBuilding.rows).toHaveLength(1);
  });
});
