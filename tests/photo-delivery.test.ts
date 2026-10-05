// ============================================================================
// Investor photo delivery and the activity trail, against Postgres and Storage.
// ----------------------------------------------------------------------------
// The twin of the "activity trail" half of tests/document-delivery.test.ts:
// photo_viewed is written only after an authorised delivery, never on a refusal,
// and never for a photograph above the investor's tier.
//
// Seeded tiers (see src/lib/db/seed.ts):
//   Kitano  - 58 Queens Gate: DILIGENCE.  120 Fenchurch: standard.
//   Sakura  - 120 Fenchurch: standard.  No entitlement to 58 Queens Gate.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { adminQuery } from "@/lib/db/client";
import { issuePortalPhotoDownload } from "@/lib/photos/portal-delivery";
import { ensurePhotoBucket, putPhotoObject, deletePhotoObject, thumbPathFor } from "@/lib/photos/storage";
import { investorAuthUserId, profileIdByEmail, publicationByOpportunityName } from "./helpers";

const KITANO = "principal@kitano-fo.example";
const SAKURA = "partner@sakura-cap.example";

let kitano: string;
let sakura: string;
let uploader: string;
let queensGate: Awaited<ReturnType<typeof publicationByOpportunityName>>;
let qg: { property_id: string; org_id: string };
let fen: { property_id: string; org_id: string };
const rows: string[] = [];
const objects: string[] = [];

async function propertyOf(opportunityId: string) {
  return (await adminQuery<{ property_id: string; org_id: string }>(
    "select p.property_id, p.org_id from opportunities o join properties p on p.property_id = o.property_id where o.opportunity_id = $1",
    [opportunityId]))[0];
}

/** A real, stored photograph (full and thumbnail) with a row at the given visibility. */
async function photo(prop: { property_id: string; org_id: string }, visibility: "internal" | "diligence", withObjects = true) {
  const path = `properties/test/${randomUUID()}.jpg`;
  if (withObjects) {
    const jpg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#369" } }).jpeg().toBuffer();
    await putPhotoObject(path, jpg, "image/jpeg");
    await putPhotoObject(thumbPathFor(path), jpg, "image/jpeg");
    objects.push(path);
  }
  const r = await adminQuery<{ photo_id: string }>(
    `insert into property_photos (org_id, property_id, object_path, mime_type, visibility, uploaded_by)
     values ($1, $2, $3, 'image/jpeg', $4, $5) returning photo_id`, [prop.org_id, prop.property_id, path, visibility, uploader]);
  rows.push(r[0].photo_id);
  return { id: r[0].photo_id, path };
}

async function events(photoId: string, contactEmail?: string) {
  return adminQuery<{ event_type: string; publication_id: string; photo_id: string; version_id: string | null; document_id: string | null; context: { variant?: string }; email: string; org: string }>(
    `select e.event_type, e.publication_id, e.photo_id, e.version_id, e.document_id, e.context, c.email, e.investor_org_id as org
       from investor_activity_events e join investor_contacts c using (investor_contact_id)
      where e.photo_id = $1 and ($2::text is null or lower(c.email) = lower($2))
      order by e.occurred_at`, [photoId, contactEmail ?? null]);
}

let cleared: { id: string; path: string };
let internal: { id: string; path: string };
let fenCleared: { id: string; path: string };

beforeAll(async () => {
  await ensurePhotoBucket();
  [kitano, sakura] = await Promise.all([investorAuthUserId(KITANO), investorAuthUserId(SAKURA)]);
  uploader = await profileIdByEmail("analyst@meiji.com");
  queensGate = await publicationByOpportunityName("58 Queens Gate");
  qg = await propertyOf(queensGate.opportunityId);
  fen = await propertyOf((await publicationByOpportunityName("120 Fenchurch Street")).opportunityId);
  cleared = await photo(qg, "diligence");
  internal = await photo(qg, "internal");
  fenCleared = await photo(fen, "diligence");
});

afterAll(async () => {
  if (rows.length) {
    await adminQuery("delete from investor_activity_events where photo_id = any($1::uuid[])", [rows]).catch(() => {});
    await adminQuery("delete from property_photos where photo_id = any($1::uuid[])", [rows]);
  }
  for (const o of objects) await deletePhotoObject(o);
});

describe("an authorised delivery", () => {
  it("returns a signed URL that serves the stored bytes", async () => {
    const url = await issuePortalPhotoDownload(kitano, cleared.id, "full");
    expect(url).not.toBeNull();
    const res = await fetch(url!);
    expect(res.status).toBe(200);
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(64);
  });

  it("records one photo_viewed event, for this contact, organisation and publication", async () => {
    const ev = await events(cleared.id, KITANO);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      event_type: "photo_viewed", publication_id: queensGate.publicationId, photo_id: cleared.id,
      version_id: null, document_id: null, context: { variant: "full" },
    });
    const org = await adminQuery<{ investor_org_id: string }>(
      "select investor_org_id from investor_contacts where auth_user_id = $1", [kitano]);
    expect(ev[0].org).toBe(org[0].investor_org_id);
  });

  it("does not record every reload: the same rendition within the window adds nothing, another rendition adds one", async () => {
    await issuePortalPhotoDownload(kitano, cleared.id, "full");
    await issuePortalPhotoDownload(kitano, cleared.id, "full");
    expect(await events(cleared.id, KITANO)).toHaveLength(1);
    expect(await issuePortalPhotoDownload(kitano, cleared.id, "thumb")).not.toBeNull();
    const ev = await events(cleared.id, KITANO);
    expect(ev.map((e) => e.context.variant).sort()).toEqual(["full", "thumb"]);
  });

  it("an older view is recorded again once the window has passed", async () => {
    await adminQuery(
      "update investor_activity_events set occurred_at = now() - interval '31 minutes' where photo_id = $1 and context ->> 'variant' = 'full'",
      [cleared.id]);
    await issuePortalPhotoDownload(kitano, cleared.id, "full");
    expect((await events(cleared.id, KITANO)).filter((e) => e.context.variant === "full")).toHaveLength(2);
  });
});

describe("a refusal records nothing", () => {
  it("an INTERNAL photo, for the diligence-tier investor", async () => {
    expect(await issuePortalPhotoDownload(kitano, internal.id, "full")).toBeNull();
    expect(await issuePortalPhotoDownload(kitano, internal.id, "thumb")).toBeNull();
    expect(await events(internal.id)).toEqual([]);
  });

  it("a diligence-visible photo above the investor's TIER (standard entitlement)", async () => {
    expect(await issuePortalPhotoDownload(kitano, fenCleared.id, "full")).toBeNull();
    expect(await issuePortalPhotoDownload(sakura, fenCleared.id, "full")).toBeNull();
    expect(await events(fenCleared.id)).toEqual([]);
  });

  it("another organisation's investor, who holds no entitlement to the publication", async () => {
    expect(await issuePortalPhotoDownload(sakura, cleared.id, "full")).toBeNull();
    expect(await events(cleared.id, SAKURA)).toEqual([]);
  });

  it("a malformed or invented id", async () => {
    expect(await issuePortalPhotoDownload(kitano, "not-a-uuid", "full")).toBeNull();
    const ghost = randomUUID();
    expect(await issuePortalPhotoDownload(kitano, ghost, "full")).toBeNull();
    expect(await events(ghost)).toEqual([]);
  });

  it("an entitlement that was hidden: the very next request is refused and unrecorded", async () => {
    const fresh = await photo(qg, "diligence");
    const e = await adminQuery<{ entitlement_id: string }>(
      `select e.entitlement_id from publication_entitlements e
        where e.publication_id = $1 and e.investor_org_id = (select investor_org_id from investor_contacts where auth_user_id = $2)`,
      [queensGate.publicationId, kitano]);
    await adminQuery("update publication_entitlements set is_visible = false where entitlement_id = $1", [e[0].entitlement_id]);
    try {
      expect(await issuePortalPhotoDownload(kitano, fresh.id, "full")).toBeNull();
      expect(await events(fresh.id)).toEqual([]);
    } finally {
      await adminQuery("update publication_entitlements set is_visible = true where entitlement_id = $1", [e[0].entitlement_id]);
    }
  });

  it("an authorised photo whose object is missing from the store is not a delivery, so nothing is recorded", async () => {
    const orphan = await photo(qg, "diligence", false); // row, but no stored bytes
    expect(await issuePortalPhotoDownload(kitano, orphan.id, "full")).toBeNull();
    expect(await events(orphan.id)).toEqual([]);
  });
});

describe("the vocabulary", () => {
  it("accepts photo_viewed and still refuses an invented event type", async () => {
    const c = await adminQuery<{ investor_contact_id: string; investor_org_id: string }>(
      "select investor_contact_id, investor_org_id from investor_contacts where auth_user_id = $1", [kitano]);
    const insert = (type: string) => adminQuery(
      "insert into investor_activity_events(investor_contact_id, investor_org_id, event_type) values ($1, $2, $3)",
      [c[0].investor_contact_id, c[0].investor_org_id, type]);
    await expect(insert("photo_deleted")).rejects.toMatchObject({ code: "23514" });
    await insert("photo_viewed");
    await adminQuery("delete from investor_activity_events where event_type = 'photo_viewed' and photo_id is null and investor_contact_id = $1", [c[0].investor_contact_id]);
  });

  it("photo_id is not a foreign key: a deleted photograph leaves its old events intact", async () => {
    const gone = await photo(qg, "diligence");
    await issuePortalPhotoDownload(kitano, gone.id, "full");
    expect(await events(gone.id, KITANO)).toHaveLength(1);
    await adminQuery("delete from property_photos where photo_id = $1", [gone.id]);
    expect(await events(gone.id, KITANO)).toHaveLength(1);
  });

  it("the trail stays append-only for staff and investors", async () => {
    const priv = await adminQuery<{ u: boolean; d: boolean }>(
      `select has_table_privilege('authenticated', 'investor_activity_events', 'UPDATE') as u,
              has_table_privilege('authenticated', 'investor_activity_events', 'DELETE') as d`);
    expect(priv[0]).toEqual({ u: false, d: false });
  });
});
