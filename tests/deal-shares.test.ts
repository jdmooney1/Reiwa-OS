// ============================================================================
// Deal shares (migration 0029): a named, expiring, revocable link to two FROZEN documents,
// opened by someone with no account. Real Postgres and the real Storage stand-in; no mocked
// permission, no mocked clock (expiry is moved in the row, as it would pass in life).
// ----------------------------------------------------------------------------
// Proved here: creation refuses what is not final or not this opportunity's; every kind of
// bad token is the SAME refusal and records nothing; a good open records exactly one view;
// revocation bites on the next request; the stored row holds a hash and never the token;
// the database lets admins create and revoke and nothing else; and a prospect still sees
// the pictures frozen at finalisation after the originals are deleted.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { adminQuery, withSession, type Session } from "@/lib/db/client";
import { createOpportunity } from "@/lib/data/opportunities";
import { createVersion } from "@/lib/data/underwriting";
import { loadMemoSource, createMemoDraft, getMemo } from "@/lib/data/memos";
import { finaliseMemoFreezingAssets } from "@/lib/data/memo-assets";
import { recordPhoto, setPhotoVisibility, deletePhotoRow } from "@/lib/data/property-photos";
import { createDealShare, listDealShares, listShareableMemos, revokeDealShare } from "@/lib/data/deal-shares";
import { openProspectShare, frozenPictureForShare } from "@/lib/data/deal-share-access";
import { composeMemo } from "@/lib/memo/compose";
import { validateShareInput } from "@/lib/deal-share/policy";
import { hashShareToken } from "@/lib/deal-share/token";
import { ensurePhotoBucket, putPhotoObject, deletePhotoObject } from "@/lib/photos/storage";
import ProspectDealPage from "@/app/(prospect)/deal/[token]/page";
import { GET as imageRoute } from "@/app/(prospect)/deal/[token]/image/[slot]/route";
import { adminSession, orgIdByName, orgUserSession, viewerSession, profileIdByEmail } from "./helpers";

let analyst: Session;
let viewer: Session;
let meiji: string;
let n = 0;
const RUN = String(Date.now()).slice(-6);
const cleanup: (() => Promise<unknown>)[] = [];

const input = (over: Record<string, unknown> = {}) => validateShareInput({
  prospectName: "Hanako Sato", prospectEmail: "Hanako@Example.com", ttlDays: 14, snapshotMemoId: null, teaserMemoId: null, ...over,
});
const jpeg = (colour: string) => sharp({ create: { width: 120, height: 80, channels: 3, background: colour } }).jpeg().toBuffer();

async function deal() {
  const opp = await createOpportunity(analyst, {
    orgId: meiji, name: `Share ${++n}`, city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "value_add", currency: "GBP", address: `${RUN}${700 + n} Share Street`,
  });
  await createVersion(analyst, opp, { acquisitionPrice: 40_000_000 });
  const property = (await adminQuery<{ property_id: string }>("select property_id from opportunities where opportunity_id = $1", [opp]))[0].property_id;
  return { opp, property };
}

async function picture(property: string, kind: "building" | "map", colour: string) {
  const bytes = await jpeg(colour);
  const objectPath = `properties/${property}/${randomUUID()}.jpg`;
  await putPhotoObject(objectPath, bytes, "image/jpeg");
  const photoId = await recordPhoto(analyst, { propertyId: property, objectPath, mimeType: "image/jpeg", asHeadline: kind === "building", kind });
  await setPhotoVisibility(analyst, property, photoId, "diligence");
  cleanup.push(() => deletePhotoObject(objectPath));
  return { photoId, objectPath };
}

/** A FINAL memo (with its pictures frozen) for a fresh deal. */
async function finalDeal(withPictures = false) {
  const d = await deal();
  const pics = withPictures ? { photo: await picture(d.property, "building", "#336699"), map: await picture(d.property, "map", "#339966") } : null;
  const memoId = await createMemoDraft(analyst, d.opp, composeMemo((await loadMemoSource(analyst, d.opp))!));
  await finaliseMemoFreezingAssets(analyst, memoId);
  return { ...d, memoId, pics };
}

const viewsOf = async (shareId: string) =>
  Number((await adminQuery<{ n: string }>("select count(*)::text n from deal_share_views where share_id = $1", [shareId]))[0].n);

async function share(opp: string, memoId: string, over: Record<string, unknown> = {}) {
  return createDealShare(adminSession, adminSession.userId, opp, input({ snapshotMemoId: memoId, teaserMemoId: memoId, ...over }));
}

/** Pass a link's date, the way time would. `expires_at > created_at` must still hold. */
const expire = (shareId: string) =>
  adminQuery("update deal_shares set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where share_id = $1", [shareId]);

beforeAll(async () => {
  await ensurePhotoBucket();
  meiji = await orgIdByName("Meiji Shipping");
  analyst = orgUserSession([meiji], await profileIdByEmail("analyst@meiji.com"));
  viewer = viewerSession([meiji], await profileIdByEmail("viewer@meiji.com"));
});
afterAll(async () => { for (const c of cleanup) await c().catch(() => {}); });

describe("creating a share", () => {
  it("is refused unless every named memo is FINAL, and says to finalise first", async () => {
    const { opp } = await deal();
    const draft = await createMemoDraft(analyst, opp, composeMemo((await loadMemoSource(analyst, opp))!));
    await expect(share(opp, draft)).rejects.toThrow(/Finalise the memo first/);
    await expect(createDealShare(adminSession, adminSession.userId, opp, input({ teaserMemoId: draft }))).rejects.toThrow(/Finalise the memo first/);
    expect((await adminQuery("select 1 from deal_shares where opportunity_id = $1", [opp]))).toHaveLength(0);
  });

  it("is refused for a memo that belongs to a DIFFERENT opportunity", async () => {
    const a = await finalDeal();
    const b = await finalDeal();
    await expect(share(a.opp, b.memoId)).rejects.toThrow(/does not belong to this opportunity/);
    await expect(createDealShare(adminSession, adminSession.userId, a.opp, input({ teaserMemoId: b.memoId }))).rejects.toThrow(/does not belong/);
  });

  it("is refused for a Snapshot taken from a memo version that has no snapshot", async () => {
    const { opp, memoId } = await finalDeal();
    // A version composed before the Snapshot existed, inserted as the privileged connection.
    const old = (await adminQuery<{ memo_id: string }>(
      `insert into memos (org_id, opportunity_id, version, status, content, overrides, created_by, finalized_by, finalized_at)
       select org_id, opportunity_id, 99, 'final', content - 'snapshot', '{}'::jsonb, created_by, created_by, now() from memos where memo_id = $1
       returning memo_id`, [memoId]))[0].memo_id;
    await expect(createDealShare(adminSession, adminSession.userId, opp, input({ snapshotMemoId: old }))).rejects.toThrow(/no finalised Asset Snapshot/);
    // The same version still serves as a Teaser source.
    await expect(createDealShare(adminSession, adminSession.userId, opp, input({ teaserMemoId: old }))).resolves.toBeTruthy();
  });

  it("needs at least one document", () => {
    expect(() => input()).toThrow(/at least one document/);
  });

  it("stores the HASH and never the token, in any column of any table it touches", async () => {
    const { opp, memoId } = await finalDeal();
    const made = await share(opp, memoId);
    const row = (await adminQuery<{ token_hash: string; whole: string }>(
      "select token_hash, s::text as whole from deal_shares s where share_id = $1", [made.shareId]))[0];
    expect(row.token_hash).toBe(hashShareToken(made.rawToken));
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.whole).not.toContain(made.rawToken);
    await openProspectShare(made.rawToken);
    const views = (await adminQuery<{ whole: string }>("select v::text as whole from deal_share_views v where share_id = $1", [made.shareId]));
    expect(views.map((v) => v.whole).join("")).not.toContain(made.rawToken);
    // Lower-cased email, expiry in the future.
    expect((await adminQuery<{ e: string }>("select prospect_email e from deal_shares where share_id = $1", [made.shareId]))[0].e).toBe("hanako@example.com");
    expect(new Date(made.expiresAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
  });

  it("lists finalised versions only, flagging a Snapshot whose pictures were never frozen", async () => {
    const { opp, memoId } = await finalDeal();
    await createMemoDraft(analyst, opp, composeMemo((await loadMemoSource(analyst, opp))!));
    const memos = await listShareableMemos(adminSession, opp);
    expect(memos.map((m) => m.memoId)).toEqual([memoId]);
    expect(memos[0].hasSnapshot).toBe(true);
    expect(memos[0].snapshotPicturesLive).toBe(false);
  });
});

describe("opening a link", () => {
  it("shows the two frozen documents and records exactly one view per open", async () => {
    const { opp, memoId } = await finalDeal();
    const made = await share(opp, memoId);
    const one = await openProspectShare(made.rawToken);
    expect(one).not.toBeNull();
    expect(one!.prospectName).toBe("Hanako Sato");
    expect(one!.snapshot!.data.name).toBe(`Share ${n}`);
    // The teaser's sections that have something in them, in teaser order: an investor copy does not print an empty box.
    const teaserOrder = ["executive_summary", "key_metrics", "asset_overview", "location_market", "investment_thesis", "business_plan", "exit_strategy"];
    const keys = one!.teaser!.sections.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["key_metrics", "asset_overview", "location_market"]));
    expect(keys).toEqual(teaserOrder.filter((k) => (keys as string[]).includes(k)));
    expect(one!.teaser!.sections.every((s) => s.resolved.state !== "empty")).toBe(true);
    expect(await viewsOf(made.shareId)).toBe(1);
    await openProspectShare(made.rawToken);
    expect(await viewsOf(made.shareId)).toBe(2);
    const listed = (await listDealShares(adminSession, { opportunityId: opp }))[0];
    expect(listed).toMatchObject({ viewCount: 2, state: "active", prospectName: "Hanako Sato", snapshotVersion: 1, teaserVersion: 1 });
    expect(listed.lastViewedAt).not.toBeNull();
  });

  it("a Teaser-only share has no Snapshot, and a Snapshot-only share has no Teaser", async () => {
    const { opp, memoId } = await finalDeal();
    const t = await createDealShare(adminSession, adminSession.userId, opp, input({ teaserMemoId: memoId }));
    const s = await createDealShare(adminSession, adminSession.userId, opp, input({ snapshotMemoId: memoId }));
    expect(await openProspectShare(t.rawToken)).toMatchObject({ snapshot: null, teaser: expect.anything() });
    expect(await openProspectShare(s.rawToken)).toMatchObject({ teaser: null, snapshot: expect.anything() });
  });

  it("wrong, malformed, expired and revoked tokens are all the SAME refusal, and record nothing", async () => {
    const { opp, memoId } = await finalDeal();
    const live = await share(opp, memoId);
    const expired = await share(opp, memoId);
    const revoked = await share(opp, memoId);
    await expire(expired.shareId);
    await revokeDealShare(adminSession, revoked.shareId);

    const attempts = [
      "x".repeat(43), "short", "", "../../etc/passwd", "a".repeat(500), expired.rawToken, revoked.rawToken,
      // The hash of a real token is NOT a token.
      hashShareToken(live.rawToken),
    ];
    for (const a of attempts) expect(await openProspectShare(a)).toBeNull();
    expect(await openProspectShare(undefined)).toBeNull();
    expect(await openProspectShare(null)).toBeNull();
    for (const s of [live, expired, revoked]) expect(await viewsOf(s.shareId)).toBe(0);
    // And the real one still works, so the refusals were not a broken lookup.
    expect(await openProspectShare(live.rawToken)).not.toBeNull();
  });

  it("revoking cuts an in-flight link off on the very next request", async () => {
    const { opp, memoId } = await finalDeal();
    const made = await share(opp, memoId);
    expect(await openProspectShare(made.rawToken)).not.toBeNull();
    await revokeDealShare(adminSession, made.shareId);
    expect(await openProspectShare(made.rawToken)).toBeNull();
    expect(await viewsOf(made.shareId)).toBe(1);
    expect((await listDealShares(adminSession, { opportunityId: opp }))[0].state).toBe("revoked");
  });

  it("an expired link stops working without anyone doing anything", async () => {
    const { opp, memoId } = await finalDeal();
    const made = await share(opp, memoId);
    expect(await openProspectShare(made.rawToken)).not.toBeNull();
    await expire(made.shareId);
    expect(await openProspectShare(made.rawToken)).toBeNull();
    expect((await listDealShares(adminSession, { opportunityId: opp }))[0].state).toBe("expired");
  });

  it("a memo that is not this opportunity's final memo never opens, even if the row was forced in", async () => {
    const a = await finalDeal();
    const b = await finalDeal();
    const draft = await createMemoDraft(analyst, a.opp, composeMemo((await loadMemoSource(analyst, a.opp))!));
    const wrong = await share(a.opp, a.memoId);
    const forcedForeign = await share(a.opp, a.memoId);
    const forcedDraft = await share(a.opp, a.memoId);
    await adminQuery("update deal_shares set teaser_memo_id = $2 where share_id = $1", [forcedForeign.shareId, b.memoId]);
    await adminQuery("update deal_shares set snapshot_memo_id = $2 where share_id = $1", [forcedDraft.shareId, draft]);
    expect(await openProspectShare(wrong.rawToken)).not.toBeNull();
    expect(await openProspectShare(forcedForeign.rawToken)).toBeNull();
    expect(await openProspectShare(forcedDraft.rawToken)).toBeNull();
    expect(await viewsOf(forcedForeign.shareId)).toBe(0);
    expect(await viewsOf(forcedDraft.shareId)).toBe(0);
  });
});

describe("the page and the picture route answer every refusal identically", () => {
  it("the page renders for a good token and is the same notFound() for every bad one", async () => {
    const { opp, memoId } = await finalDeal();
    const live = await share(opp, memoId);
    const dead = await share(opp, memoId);
    const gone = await share(opp, memoId);
    await revokeDealShare(adminSession, dead.shareId);
    await expire(gone.shareId);

    const element = await ProspectDealPage({ params: { token: live.rawToken } });
    expect(element).toBeTruthy();
    const digests: string[] = [];
    for (const token of ["nope".repeat(10), dead.rawToken, gone.rawToken, ""]) {
      try { await ProspectDealPage({ params: { token } }); digests.push("rendered"); }
      catch (e) { digests.push(`${(e as Error).message}|${(e as { digest?: string }).digest}`); }
    }
    expect(new Set(digests).size).toBe(1);
    expect(digests[0]).toContain("NEXT_NOT_FOUND");
    expect(await viewsOf(dead.shareId)).toBe(0);
    expect(await viewsOf(gone.shareId)).toBe(0);
    expect(await viewsOf(live.shareId)).toBe(1);
  });

  it("the picture route is a bare 404 for every bad token and slot, with no-store headers", async () => {
    const { opp, memoId } = await finalDeal();
    const dead = await share(opp, memoId);
    await revokeDealShare(adminSession, dead.shareId);
    const live = await share(opp, memoId);
    const res = [
      await imageRoute(null as never, { params: { token: "nope".repeat(10), slot: "photo" } }),
      await imageRoute(null as never, { params: { token: dead.rawToken, slot: "photo" } }),
      await imageRoute(null as never, { params: { token: live.rawToken, slot: "../photo" } }),
      await imageRoute(null as never, { params: { token: live.rawToken, slot: "photo" } }), // valid link, but this deal has no picture
    ];
    for (const r of res) {
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("");
      expect(r.headers.get("cache-control")).toContain("no-store");
      expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    }
    // The picture route records no view.
    expect(await viewsOf(live.shareId)).toBe(0);
  });

  it("a prospect still gets the FROZEN pictures after the originals are deleted or withdrawn", async () => {
    const { opp, property, memoId, pics } = await finalDeal(true);
    const made = await share(opp, memoId);
    const frozen = (await getMemo(analyst, memoId))!.content.snapshot!;
    expect(frozen.photo).toMatchObject({ source: "frozen" });

    await deletePhotoRow(analyst, property, pics!.photo.photoId);
    await deletePhotoObject(pics!.photo.objectPath);
    await setPhotoVisibility(analyst, property, pics!.map.photoId, "internal");

    for (const slot of ["photo", "map"] as const) {
      const r = await imageRoute(null as never, { params: { token: made.rawToken, slot } });
      expect(r.status).toBe(303);
      const url = r.headers.get("location")!;
      const bytes = await fetch(url);
      expect(bytes.ok).toBe(true);
      expect((await bytes.arrayBuffer()).byteLength).toBeGreaterThan(100);
    }
    const view = (await openProspectShare(made.rawToken))!;
    expect(view.snapshot!.pictures).toEqual({ photo: true, map: true });
    expect(await frozenPictureForShare(made.rawToken, "photo")).toMatch(/^http/);
    expect(await frozenPictureForShare("nope".repeat(10), "photo")).toBeNull();
    // Revoked: the pictures stop too.
    await revokeDealShare(adminSession, made.shareId);
    expect((await imageRoute(null as never, { params: { token: made.rawToken, slot: "photo" } })).status).toBe(404);
  });
});

describe("what the database allows", () => {
  it("only an administrator can see or create a share; staff and viewers get nothing", async () => {
    const { opp, memoId } = await finalDeal();
    const made = await share(opp, memoId);
    for (const s of [analyst, viewer]) {
      expect(await withSession(s, async (tx) => (await tx.query("select 1 from deal_shares")).rows)).toHaveLength(0);
      expect(await withSession(s, async (tx) => (await tx.query("select 1 from deal_share_views")).rows)).toHaveLength(0);
      await expect(withSession(s, (tx) => tx.query(
        `insert into deal_shares(opportunity_id, teaser_memo_id, prospect_name, prospect_email, token_hash, expires_at)
         values ($1, $2, 'x', 'x@y.zz', $3, now() + interval '1 day')`, [opp, memoId, hashShareToken(randomUUID() + randomUUID())]))).rejects.toThrow();
      await expect(createDealShare(s, s.userId, opp, input({ teaserMemoId: memoId }))).rejects.toThrow();
    }
    expect(made.shareId).toBeTruthy();
  });

  it("an administrator can revoke and nothing else: no re-pointing, no extending, no deleting, no editing the audit trail", async () => {
    const { opp, memoId } = await finalDeal();
    const made = await share(opp, memoId);
    const run = (sql: string, p: unknown[] = []) => withSession(adminSession, (tx) => tx.query(sql, p));
    await expect(run("update deal_shares set expires_at = expires_at + interval '30 days' where share_id = $1", [made.shareId])).rejects.toThrow(/permission denied/);
    await expect(run("update deal_shares set token_hash = $2 where share_id = $1", [made.shareId, "0".repeat(64)])).rejects.toThrow(/permission denied/);
    await expect(run("update deal_shares set prospect_email = 'a@b.cc' where share_id = $1", [made.shareId])).rejects.toThrow(/permission denied/);
    await expect(run("delete from deal_shares where share_id = $1", [made.shareId])).rejects.toThrow(/permission denied/);
    await openProspectShare(made.rawToken);
    await expect(run("insert into deal_share_views(share_id) values ($1)", [made.shareId])).rejects.toThrow(/permission denied/);
    await expect(run("update deal_share_views set viewed_at = now() where share_id = $1", [made.shareId])).rejects.toThrow(/permission denied/);
    await expect(run("delete from deal_share_views where share_id = $1", [made.shareId])).rejects.toThrow(/permission denied/);
    expect((await run("select 1 from deal_share_views where share_id = $1", [made.shareId])).rows).toHaveLength(1);
    await expect(run("update deal_shares set revoked_at = now() where share_id = $1", [made.shareId])).resolves.toBeTruthy();
  });

  it("refuses a share that names no document, a malformed hash, or an expiry before creation", async () => {
    const { opp, memoId } = await finalDeal();
    const insert = (memo: string | null, hash: string, expires: string) => adminQuery(
      `insert into deal_shares(opportunity_id, teaser_memo_id, prospect_name, prospect_email, token_hash, expires_at)
       values ($1, $2, 'x', 'x@y.zz', $3, ${expires})`, [opp, memo, hash]);
    await expect(insert(null, "a".repeat(64), "now() + interval '1 day'")).rejects.toThrow(/deal_shares_has_a_document/);
    await expect(insert(memoId, "not-a-sha256", "now() + interval '1 day'")).rejects.toThrow(/token_hash/);
    await expect(insert(memoId, "b".repeat(64), "now() - interval '1 day'")).rejects.toThrow(/deal_shares_expires_after_creation/);
  });

  it("gives anon and PUBLIC nothing on either table", async () => {
    for (const t of ["deal_shares", "deal_share_views"]) {
      const g = await adminQuery<{ n: string }>(
        "select count(*)::text n from information_schema.role_table_grants where table_name = $1 and grantee in ('anon', 'PUBLIC')", [t]);
      expect(Number(g[0].n)).toBe(0);
    }
  });

  it("deleting a shared opportunity is refused rather than erasing the record of what was shown", async () => {
    const { opp, memoId } = await finalDeal();
    const made = await share(opp, memoId);
    // A final memo cannot be deleted (app.guard_memo), and the share's own references do not cascade.
    await expect(adminQuery("delete from opportunities where opportunity_id = $1", [opp])).rejects.toThrow(/cannot be deleted|violates foreign key/);
    expect((await adminQuery("select 1 from deal_shares where share_id = $1", [made.shareId]))).toHaveLength(1);
  });
});
