// ============================================================================
// Asset photos (migration 0019): the invariants, asserted against Postgres.
// ----------------------------------------------------------------------------
// Through real RLS, as investor-location.test.ts does. Three promises:
//   1. At most one headline per property - the database refuses a second.
//   2. A photograph is INTERNAL unless a person widens it.
//   3. No investor session can read a photograph, at ANY visibility. Phase 1 has
//      no investor path, so "above their entitlement tier" is every tier.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { adminQuery, withInvestorSession, type Session } from "@/lib/db/client";
import {
  recordPhoto, setHeadline, setPhotoVisibility, listPropertyPhotos, deletePhotoRow, reorderPhotos,
} from "@/lib/data/property-photos";
import { orgIdByName, orgUserSession, viewerSession, profileIdByEmail, investorAuthUserId } from "./helpers";

let meiji: string;
let aoyama: string;
let writer: Session;
let viewer: Session;
let otherOrgUser: Session;
let propertyId: string;
let otherPropertyId: string;
const made: string[] = [];

const path = () => `properties/test/${randomUUID()}.jpg`;

async function add(asHeadline = false): Promise<string> {
  const id = await recordPhoto(writer, { propertyId, objectPath: path(), mimeType: "image/jpeg", asHeadline });
  made.push(id);
  return id;
}

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  aoyama = await orgIdByName("Aoyama Holdings");
  writer = orgUserSession([meiji], await profileIdByEmail("analyst@meiji.com"));
  viewer = viewerSession([meiji], await profileIdByEmail("viewer@meiji.com"));
  otherOrgUser = orgUserSession([aoyama], await profileIdByEmail("user@aoyama.com"));
  // Own properties, so nothing here depends on what the seed happens to hold.
  const mk = async (name: string) => (await adminQuery<{ property_id: string }>(
    "insert into properties (org_id, name) values ($1, $2) returning property_id", [meiji, name]))[0].property_id;
  propertyId = await mk("Photo test property A");
  otherPropertyId = await mk("Photo test property B");
});

afterAll(async () => {
  // Deleting the properties cascades to their photographs.
  await adminQuery("delete from properties where property_id = any($1::uuid[])", [[propertyId, otherPropertyId]]);
});

describe("one headline per property", () => {
  it("the database refuses a second headline outright", async () => {
    const first = await add(true);
    await expect(adminQuery(
      `insert into property_photos (org_id, property_id, object_path, mime_type, is_headline, uploaded_by)
       values ($1, $2, $3, 'image/jpeg', true, $4)`,
      [meiji, propertyId, path(), writer.userId])).rejects.toMatchObject({ code: "23505" });
    // ...and the first is untouched.
    const rows = await listPropertyPhotos(writer, propertyId);
    expect(rows.filter((r) => r.isHeadline).map((r) => r.photoId)).toEqual([first]);
  });

  it("replacing the headline demotes the old one into the gallery", async () => {
    const before = (await listPropertyPhotos(writer, propertyId)).find((r) => r.isHeadline)!;
    const next = await add(true);
    const rows = await listPropertyPhotos(writer, propertyId);
    expect(rows.filter((r) => r.isHeadline).map((r) => r.photoId)).toEqual([next]);
    expect(rows.find((r) => r.photoId === before.photoId)!.isHeadline).toBe(false);
  });

  it("making a gallery photograph the headline swaps, never doubles", async () => {
    const gallery = await add(false);
    await setHeadline(writer, propertyId, gallery);
    const rows = await listPropertyPhotos(writer, propertyId);
    expect(rows.filter((r) => r.isHeadline).map((r) => r.photoId)).toEqual([gallery]);
  });

  it("two headlines on DIFFERENT properties are fine", async () => {
    await add(true); // property A already has one
    const id = await recordPhoto(writer, { propertyId: otherPropertyId, objectPath: path(), mimeType: "image/jpeg", asHeadline: true });
    made.push(id);
    expect((await listPropertyPhotos(writer, otherPropertyId)).filter((r) => r.isHeadline)).toHaveLength(1);
  });
});

describe("every photograph starts internal", () => {
  it("recordPhoto has no way to ask for anything else", async () => {
    const id = await add(false);
    const [row] = await listPropertyPhotos(writer, propertyId).then((r) => r.filter((x) => x.photoId === id));
    expect(row.visibility).toBe("internal");
  });

  it("the column default is internal for any other writer too", async () => {
    const r = await adminQuery<{ visibility: string; photo_id: string }>(
      `insert into property_photos (org_id, property_id, object_path, mime_type, uploaded_by)
       values ($1, $2, $3, 'image/png', $4) returning photo_id, visibility`,
      [meiji, propertyId, path(), writer.userId]);
    made.push(r[0].photo_id);
    expect(r[0].visibility).toBe("internal");
  });

  it("the table refuses any visibility but internal or diligence (no standard tier for a photo), and any type outside the three images", async () => {
    for (const bad of ["public", "standard"]) {
      await expect(adminQuery(
        `insert into property_photos (org_id, property_id, object_path, mime_type, visibility, uploaded_by)
         values ($1, $2, $3, 'image/jpeg', $5, $4)`,
        [meiji, propertyId, path(), writer.userId, bad]), bad).rejects.toMatchObject({ code: "23514" });
    }
    const id = await add();
    await expect(setPhotoVisibility(writer, propertyId, id, "standard")).rejects.toThrow(/not a valid visibility/);
    await expect(adminQuery(
      `insert into property_photos (org_id, property_id, object_path, mime_type, uploaded_by)
       values ($1, $2, $3, 'image/svg+xml', $4)`,
      [meiji, propertyId, path(), writer.userId])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("staff access", () => {
  it("a read-only session can read but not write", async () => {
    const id = await add();
    expect((await listPropertyPhotos(viewer, propertyId)).some((p) => p.photoId === id)).toBe(true);
    await expect(recordPhoto(viewer, { propertyId, objectPath: path(), mimeType: "image/jpeg", asHeadline: false }))
      .rejects.toBeTruthy();
    await expect(setPhotoVisibility(viewer, propertyId, id, "diligence")).rejects.toBeTruthy();
    expect(await deletePhotoRow(viewer, propertyId, id)).toBeNull();
  });

  it("another organisation sees nothing and can change nothing", async () => {
    const id = await add();
    expect(await listPropertyPhotos(otherOrgUser, propertyId)).toEqual([]);
    expect(await deletePhotoRow(otherOrgUser, propertyId, id)).toBeNull();
  });

  it("a photograph of one property cannot be touched through another property's id", async () => {
    const id = await add();
    await expect(setPhotoVisibility(writer, randomUUID(), id, "diligence")).rejects.toThrow(/could not be found/);
    await expect(reorderPhotos(writer, propertyId, [id, randomUUID()])).rejects.toThrow(/not part of this property/);
  });

  it("deleting returns the object path so the stored file can be removed with the row", async () => {
    const objectPath = path();
    const id = await recordPhoto(writer, { propertyId, objectPath, mimeType: "image/jpeg", asHeadline: false });
    expect(await deletePhotoRow(writer, propertyId, id)).toEqual({ objectPath });
    expect(await deletePhotoRow(writer, propertyId, id)).toBeNull();
  });
});

describe("no investor can read a photograph, at any tier", () => {
  const INVESTORS = ["principal@kitano-fo.example", "partner@sakura-cap.example"];

  it.each(["internal", "diligence"] as const)("a %s photograph is invisible to every investor", async (tier) => {
    const id = await add();
    await setPhotoVisibility(writer, propertyId, id, tier);
    for (const email of INVESTORS) {
      const uid = await investorAuthUserId(email);
      const { rows } = await withInvestorSession(uid, (tx) =>
        tx.query("select photo_id from property_photos where photo_id = $1", [id]));
      expect(rows, `${email} at ${tier}`).toEqual([]);
      const all = await withInvestorSession(uid, (tx) => tx.query("select count(*)::int as n from property_photos"));
      expect((all.rows[0] as { n: number }).n).toBe(0);
    }
  });

  it("an investor cannot write one either", async () => {
    const uid = await investorAuthUserId(INVESTORS[0]);
    await expect(withInvestorSession(uid, (tx) => tx.query(
      `insert into property_photos (org_id, property_id, object_path, mime_type, uploaded_by)
       values ($1, $2, $3, 'image/jpeg', $4)`, [meiji, propertyId, path(), writer.userId]))).rejects.toBeTruthy();
  });

  it("the staff read is the ONLY policy that grants a select", async () => {
    const policies = await adminQuery<{ policyname: string; cmd: string; qual: string | null }>(
      "select policyname, cmd, qual from pg_policies where tablename = 'property_photos' order by policyname");
    expect(policies.map((p) => p.policyname)).toEqual([
      "property_photos_delete", "property_photos_insert", "property_photos_select", "property_photos_update"]);
    for (const p of policies.filter((x) => x.cmd === "SELECT")) expect(p.qual).toContain("has_org");
  });
});
