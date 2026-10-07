// ============================================================================
// The investor Overview is its own field, and publishing is gated by a review.
// ----------------------------------------------------------------------------
// Two paths, against real Postgres (migration 0033):
//
//   A. A sensitive INTERNAL summary must never reach an investor-facing record.
//      Checked the way the audit checked it: not only the draft row, but the
//      payloads an investor's own session reads out of the portal.
//   B. The publish gate (assertPublishConfirmed) refuses without a matching
//      sentence and digest, refuses a stale screen, and refuses a version that is
//      not in review; and the review's diff says what is actually changing.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withSession, type Session } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import { createOpportunity, updateOpportunity, getOpportunity } from "@/lib/data/opportunities";
import {
  addPublicationDocument, createInvestorContact, createInvestorOrganization,
  createPublicationFromOpportunity, grantEntitlement, listPublicationVersions,
  publishVersion, readPublicationSource, submitVersionForReview, updateDraftVersion,
  removePublicationDocument,
} from "@/lib/data/investor-portal";
import { createDraftFromVersion } from "@/lib/data/admin-portal";
import { loadPortalFeed, loadPortalOpportunity, loadPortalDocuments } from "@/lib/data/portal-feed";
import { getPublishReview, assertPublishConfirmed, overviewEchoesInternal } from "@/lib/data/publish-review";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

const SECRET = "ZZ-INTERNAL-SECRET: vendor is distressed, bid 15% under guide, do not disclose to investors.";
const BROKER = "ZZ-INTERNAL-BROKER-LLP";

let staff: Session;
let adminUserId: string;
let portalUid: string;
let portalOrgId: string;
let opportunityId: string;

beforeAll(async () => {
  const meiji = await orgIdByName("Meiji Shipping");
  staff = orgUserSession([meiji]);
  adminUserId = await profileIdByEmail("admin@reiwa.com");

  portalUid = await ensureAuthUser(createSupabaseAdminClient(), {
    email: "overview@portal-fixture.example", password: DEMO_PASSWORD, name: "O. Fixture",
  });
  portalOrgId = await createInvestorOrganization(adminSession, { name: "Overview Fixture Partners", notes: "tests/investor-overview.test.ts" });
  await createInvestorContact(adminSession, {
    investorOrgId: portalOrgId, email: "overview@portal-fixture.example", name: "O. Fixture",
    title: "Principal", authUserId: portalUid,
  });

  opportunityId = await createOpportunity(staff, {
    orgId: meiji, name: "9 Overview Lane", city: "London", country: "United Kingdom",
    market: "London", assetType: "office", strategy: "core", currency: "GBP",
    targetPrice: 8400000, niy: 6.25, targetIrr: 13.5,
    summary: SECRET, brokerName: BROKER,
  });
});

describe("A. the internal summary never becomes the investor Overview", () => {
  let publicationId: string;
  let draftOne: string;

  it("a new opportunity has no investor overview, and the boundary offers none", async () => {
    const opp = await getOpportunity(staff, opportunityId);
    expect(opp!.summary).toBe(SECRET);
    expect(opp!.investorOverview).toBeNull();

    const source = await readPublicationSource(adminSession, opportunityId);
    expect(Object.keys(source!)).not.toContain("overview");
    expect(JSON.stringify(source)).not.toContain("ZZ-INTERNAL");
  });

  it("Prepare investor draft starts with a BLANK Overview and no trace of the summary", async () => {
    const created = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
    publicationId = created.publicationId;
    draftOne = created.versionId;

    const row = await withSession(adminSession, (tx) =>
      tx.query("select * from publication_versions where version_id = $1", [draftOne]));
    expect(row.rows[0].overview).toBeNull();
    const text = JSON.stringify(row.rows[0]);
    expect(text).not.toContain("ZZ-INTERNAL");
    expect(text).not.toContain("distressed");
    expect(text).not.toContain(BROKER);
  });

  it("nothing reaches the investor's own payloads once it is published and entitled", async () => {
    await updateDraftVersion(adminSession, draftOne, { headline: "Secure freehold income, London SE1" });
    await submitVersionForReview(adminSession, draftOne, adminUserId);
    await publishVersion(adminSession, draftOne, adminUserId);
    await grantEntitlement(adminSession, {
      investorOrgId: portalOrgId, publicationId, isVisible: true, placement: "featured",
      documentAccessLevel: "standard",
    }, adminUserId);

    const feed = await loadPortalFeed(portalUid);
    const one = await loadPortalOpportunity(portalUid, publicationId);
    const docs = await loadPortalDocuments(portalUid, one!.versionId);
    expect(one).not.toBeNull();
    expect(one!.overview ?? null).toBeNull();

    // The payloads, serialised: the summary, the broker, and the internal id.
    const wire = JSON.stringify({ feed, one, docs });
    for (const needle of ["ZZ-INTERNAL", "distressed", "bid 15%", BROKER, opportunityId]) {
      expect(wire).not.toContain(needle);
    }
  });

  it("editing the internal summary later still changes nothing an investor can read", async () => {
    await updateOpportunity(staff, opportunityId, { summary: `${SECRET} (revised)` });
    const again = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
    const versions = await listPublicationVersions(adminSession, publicationId);
    const next = versions.find((v) => v.versionId === again.versionId)!;
    expect(next.overview).toBeNull();
  });

  it("a human-written investor overview is what a new draft carries, and only that", async () => {
    const written = "Freehold multi-let building in Bermondsey, let on a 12-year lease to a single food covenant.";
    await updateOpportunity(staff, opportunityId, { investorOverview: written });
    const created = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
    const v = (await listPublicationVersions(adminSession, publicationId)).find((x) => x.versionId === created.versionId)!;
    expect(v.overview).toBe(written);
    expect(v.overview).not.toContain("distressed");
  });

  it("clearing it returns to blank; there is no fallback to the summary", async () => {
    await updateOpportunity(staff, opportunityId, { investorOverview: null });
    const created = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
    const v = (await listPublicationVersions(adminSession, publicationId)).find((x) => x.versionId === created.versionId)!;
    expect(v.overview).toBeNull();
  });

  it("whitespace is not an overview: the database refuses a blank string", async () => {
    await expect(updateOpportunity(staff, opportunityId, { investorOverview: "   " })).rejects.toThrow();
  });

  it("an EXPLICIT copy of the summary is allowed, and the publish review flags it", async () => {
    // The deliberate second action: the person pastes the internal text in themselves.
    await updateOpportunity(staff, opportunityId, { investorOverview: SECRET });
    const created = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
    await submitVersionForReview(adminSession, created.versionId, adminUserId);
    const review = await getPublishReview(adminSession, created.versionId);
    expect(review!.warnings.map((w) => w.code)).toContain("overview_matches_internal");
    // The ordinary sentence is refused; the one that names the problem is required.
    expect(review!.phrase).toContain("with the internal summary as the overview");
    const ordinary = review!.phrase.replace(" with the internal summary as the overview", "");
    await expect(assertPublishConfirmed(adminSession, created.versionId, { digest: review!.digest, typed: ordinary }))
      .rejects.toThrow(/does not match/);
    await expect(assertPublishConfirmed(adminSession, created.versionId, { digest: review!.digest, typed: review!.phrase }))
      .resolves.toBeTruthy();
    await updateOpportunity(staff, opportunityId, { investorOverview: null });
  });

  it("overviewEchoesInternal: equal, contained and unrelated text", () => {
    expect(overviewEchoesInternal(SECRET, SECRET)).toBe(true);
    expect(overviewEchoesInternal(`Intro. ${SECRET} Outro.`, SECRET)).toBe(true);
    expect(overviewEchoesInternal("A quite different paragraph written for investors.", SECRET)).toBe(false);
    expect(overviewEchoesInternal(null, SECRET)).toBe(false);
    expect(overviewEchoesInternal("short", "short")).toBe(true);
    expect(overviewEchoesInternal("x", null)).toBe(false);
  });
});

describe("B. the publish gate", () => {
  let opp: string;
  let publicationId: string;
  let v1: string;
  let v2: string;

  beforeAll(async () => {
    const meiji = await orgIdByName("Meiji Shipping");
    opp = await createOpportunity(staff, {
      orgId: meiji, name: "11 Gate Street", city: "London", country: "United Kingdom",
      market: "London", assetType: "office", strategy: "core", currency: "GBP",
      targetPrice: 10000000, niy: 5, targetIrr: 12,
    });
    const created = await createPublicationFromOpportunity(adminSession, opp, adminUserId);
    publicationId = created.publicationId;
    v1 = created.versionId;
    await addPublicationDocument(adminSession, {
      versionId: v1, title: "Teaser", storagePath: `publications/${v1}/teaser.pdf`, accessLevel: "standard",
    }, adminUserId);
    await addPublicationDocument(adminSession, {
      versionId: v1, title: "Title report", storagePath: `publications/${v1}/title.pdf`, accessLevel: "diligence",
    }, adminUserId);
  });

  it("a draft cannot be published through the gate", async () => {
    const review = (await getPublishReview(adminSession, v1))!;
    await expect(assertPublishConfirmed(adminSession, v1, { digest: review.digest, typed: review.phrase }))
      .rejects.toThrow(/submitted for review/);
  });

  it("the first publication shows everything as new and quotes the count and audience", async () => {
    await submitVersionForReview(adminSession, v1, adminUserId);
    await grantEntitlement(adminSession, {
      investorOrgId: portalOrgId, publicationId, isVisible: true, placement: "secondary",
      documentAccessLevel: "standard",
    }, adminUserId);
    const review = (await getPublishReview(adminSession, v1))!;
    expect(review.diff.firstPublication).toBe(true);
    expect(review.liveVersionNumber).toBeNull();
    expect(review.diff.documents.map((d) => d.type)).toEqual(["added", "added"]);
    expect(review.audience.map((a) => a.organisation)).toEqual(["Overview Fixture Partners"]);
    expect(review.phrase).toBe(`publish v1 with ${review.diff.changeCount} changes to 1 organisation`);
    expect(review.warnings.map((w) => w.code)).toContain("overview_blank");
  });

  it("refuses a missing, wrong or empty confirmation; accepts the exact sentence", async () => {
    const review = (await getPublishReview(adminSession, v1))!;
    await expect(assertPublishConfirmed(adminSession, v1, { digest: review.digest, typed: "" }))
      .rejects.toThrow(/does not match/);
    await expect(assertPublishConfirmed(adminSession, v1, { digest: review.digest, typed: "publish it" }))
      .rejects.toThrow(/does not match/);
    await expect(assertPublishConfirmed(adminSession, v1, undefined)).rejects.toThrow(/changed after you opened/);
    await expect(assertPublishConfirmed(adminSession, v1, null)).rejects.toThrow(/changed after you opened/);
    await expect(assertPublishConfirmed(adminSession, v1, { digest: "", typed: review.phrase }))
      .rejects.toThrow(/changed after you opened/);
    await expect(assertPublishConfirmed(adminSession, v1, { digest: "0".repeat(64), typed: review.phrase }))
      .rejects.toThrow(/changed after you opened/);
    // Case and spacing do not matter; words and numbers do.
    await expect(assertPublishConfirmed(adminSession, v1, {
      digest: review.digest, typed: `  ${review.phrase.toUpperCase().replace(/ /g, "   ")} `,
    })).resolves.toBeTruthy();
    // The wrong number is the wrong sentence.
    await expect(assertPublishConfirmed(adminSession, v1, {
      digest: review.digest, typed: review.phrase.replace(/with \d+ changes/, "with 99 changes"),
    })).rejects.toThrow(/does not match/);
  });

  it("a stale screen is refused: the audience moved after it was read", async () => {
    const review = (await getPublishReview(adminSession, v1))!;
    const org2 = await createInvestorOrganization(adminSession, { name: "Overview Fixture Two", notes: "tests" });
    await grantEntitlement(adminSession, {
      investorOrgId: org2, publicationId, isVisible: true, placement: "secondary",
      documentAccessLevel: "standard",
    }, adminUserId);
    await expect(assertPublishConfirmed(adminSession, v1, { digest: review.digest, typed: review.phrase }))
      .rejects.toThrow(/changed after you opened/);
    const fresh = (await getPublishReview(adminSession, v1))!;
    expect(fresh.audience).toHaveLength(2);
    expect(fresh.phrase).toContain("to 2 organisations");
    await publishVersion(adminSession, v1, adminUserId); // what the action does after the gate
  });

  it("the second version's review diffs against what is live: text, figures, documents", async () => {
    const draft = await createDraftFromVersion(adminSession, v1, { copyDocuments: true }, adminUserId);
    v2 = draft.versionId;
    await updateDraftVersion(adminSession, v2, {
      headline: "A new headline", headlinePrice: 10250000, targetNiy: 5.25,
    });
    const docs = await withSession(adminSession, (tx) =>
      tx.query<{ document_id: string; title: string }>("select document_id, title from publication_documents where version_id = $1", [v2]));
    const titleReport = docs.rows.find((d) => d.title === "Title report")!;
    await removePublicationDocument(adminSession, titleReport.document_id);
    await addPublicationDocument(adminSession, {
      versionId: v2, title: "Financial summary", storagePath: `publications/${v2}/fin.pdf`, accessLevel: "diligence",
    }, adminUserId);
    await submitVersionForReview(adminSession, v2, adminUserId);

    const review = (await getPublishReview(adminSession, v2))!;
    expect(review.liveVersionNumber).toBe(1);
    expect(review.diff.firstPublication).toBe(false);
    const changed = Object.fromEntries(review.diff.fields.map((f) => [f.key, [f.before, f.after]]));
    expect(changed.headline).toEqual([null, "A new headline"]);
    expect(changed.headlinePrice).toEqual(["£10,000,000", "£10,250,000"]);
    expect(changed.targetNiy).toEqual(["5%", "5.25%"]);
    expect(Object.keys(changed)).not.toContain("title"); // unchanged fields are not listed
    expect(review.diff.documents.map((d) => `${d.type}:${d.title}`).sort())
      .toEqual(["added:Financial summary", "removed:Title report"]);
    expect(review.diff.changeCount).toBe(5);
    expect(review.phrase).toBe("publish v2 with 5 changes to 2 organisations");
  });

  it("no one but an admin can read a review at all", async () => {
    const review = await getPublishReview(orgUserSession([await orgIdByName("Meiji Shipping")]), v2);
    expect(review).toBeNull();
  });

  it("documents the audit trail the gate leaves: nothing is published by reading a review", async () => {
    const rows = await adminQuery<{ status: string }>(
      "select status from publication_versions where version_id = $1", [v2]);
    expect(rows[0].status).toBe("in_review");
  });
});
