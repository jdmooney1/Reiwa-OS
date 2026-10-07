// ============================================================================
// "Start a new draft from current internal data" keeps what a person wrote.
// ----------------------------------------------------------------------------
// It used to build the new draft from the whitelisted source fields alone, so headline,
// highlights, hold period, documents and (unless an investor overview existed) the Overview
// all came out blank. It now starts from a copy of the latest version and overwrites only the
// factual fields, never blanking one because the source is empty.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery } from "@/lib/db/client";
import { createOpportunity, updateOpportunity } from "@/lib/data/opportunities";
import { createVersion } from "@/lib/data/underwriting";
import {
  addPublicationDocument, createPublicationFromOpportunity, listPublicationDocuments,
  listPublicationVersions, publicationSourceDrift, publishVersion, submitVersionForReview,
  supersedeActiveVersion, updateDraftVersion,
} from "@/lib/data/investor-portal";
import { createDraftRefreshedFromSource } from "@/lib/data/admin-portal";
import { getPublishReview } from "@/lib/data/publish-review";
import {
  ensureDocumentBucket, newObjectPath, putDocumentObject, deleteDocumentObject, signDocumentObject,
  type DocumentObjectStore,
} from "@/lib/documents/storage";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

const SECRET = "ZZ-INTERNAL: vendor is distressed, do not disclose to investors.";
let meiji: string;
let adminUserId: string;
const made: string[] = [];

async function published(name: string, opts: { investorOverview?: string } = {}) {
  const staff = orgUserSession([meiji]);
  const opp = await createOpportunity(staff, {
    orgId: meiji, name, city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "core", currency: "GBP", targetPrice: 8000000, niy: 6, targetIrr: 12,
    summary: SECRET,
  });
  if (opts.investorOverview) await updateOpportunity(staff, opp, { investorOverview: opts.investorOverview });
  const p = await createPublicationFromOpportunity(adminSession, opp, adminUserId);
  await updateDraftVersion(adminSession, p.versionId, {
    headline: "Hand-written headline", highlights: ["Hand-written highlight A", "Highlight B"],
    holdPeriodYears: 7, submarket: "Bermondsey", overview: "Hand-written overview.",
  });
  for (const title of ["Teaser", "Title report"]) {
    const path = newObjectPath(p.versionId, "application/pdf");
    await putDocumentObject(path, new TextEncoder().encode(title), "application/pdf"); made.push(path);
    await addPublicationDocument(adminSession, {
      versionId: p.versionId, title, storagePath: path, mimeType: "application/pdf",
      accessLevel: title === "Teaser" ? "standard" : "diligence",
    }, adminUserId);
  }
  await submitVersionForReview(adminSession, p.versionId, adminUserId);
  await publishVersion(adminSession, p.versionId, adminUserId);
  return { opp, staff, ...p };
}

const latest = async (publicationId: string) => (await listPublicationVersions(adminSession, publicationId))[0];

beforeAll(async () => {
  await ensureDocumentBucket();
  meiji = await orgIdByName("Meiji Shipping");
  adminUserId = await profileIdByEmail("admin@reiwa.com");
});
afterAll(async () => { for (const p of made) await deleteDocumentObject(p).catch(() => undefined); });

describe("refresh from source", () => {
  it("overwrites the factual fields and keeps everything a person wrote", async () => {
    const x = await published("1 Refresh Row");
    // The internal record moves on: name, price (via the case) and a new market detail.
    await updateOpportunity(x.staff, x.opp, { name: "1 Refresh Row (renamed)", market: "London City" });
    await createVersion(x.staff, x.opp, { acquisitionPrice: 8750000, changeRationale: "Re-priced." });

    const draft = await createDraftRefreshedFromSource(adminSession, x.publicationId, {}, adminUserId);
    for (const d of await listPublicationDocuments(adminSession, draft.versionId)) made.push(d.storagePath);
    const v = await latest(x.publicationId);
    expect(v.versionId).toBe(draft.versionId);
    expect(v.status).toBe("draft");

    // Factual fields followed the internal record, title included.
    expect(v.title).toBe("1 Refresh Row (renamed)");
    expect(v.market).toBe("London City");
    expect(v.headlinePrice).toBe(8750000);
    // What was written for investors survived.
    expect(v.headline).toBe("Hand-written headline");
    expect(v.highlights).toEqual(["Hand-written highlight A", "Highlight B"]);
    expect(v.holdPeriodYears).toBe(7);
    expect(v.overview).toBe("Hand-written overview."); // no investor overview written: untouched
    expect(JSON.stringify(v)).not.toContain("ZZ-INTERNAL");
    expect(draft.overwritten).toEqual(expect.arrayContaining(["title", "market", "headline_price"]));
    for (const never of ["headline", "highlights", "hold_period_years", "overview"]) {
      expect(draft.overwritten).not.toContain(never);
    }

    // Documents came across as the draft's own copies.
    const docs = await listPublicationDocuments(adminSession, draft.versionId);
    expect(docs.map((d) => d.title).sort()).toEqual(["Teaser", "Title report"]);
    const live = await listPublicationDocuments(adminSession, x.versionId);
    for (const d of docs) expect(live.map((l) => l.storagePath)).not.toContain(d.storagePath);

    // Provenance says the draft is in step with the source as it is now; the live one is not.
    expect((await publicationSourceDrift(adminSession, draft.versionId)).changed).toBe(false);
    expect((await publicationSourceDrift(adminSession, x.versionId)).changed).toBe(true);

    // And the review shows ONLY what moved: no headline, highlights or documents.
    await submitVersionForReview(adminSession, draft.versionId, adminUserId);
    const review = (await getPublishReview(adminSession, draft.versionId))!;
    expect(review.diff.fields.map((f) => f.key).sort()).toEqual(["headlinePrice", "market", "title"]);
    expect(review.diff.documents).toEqual([]);
    // The live version was never touched.
    const liveVersion = (await listPublicationVersions(adminSession, x.publicationId)).find((v2) => v2.versionId === x.versionId)!;
    expect(liveVersion.title).toBe("1 Refresh Row");
  });

  it("never blanks a field because the source is empty", async () => {
    const x = await published("2 Empty Source Row");
    // The opportunity has no submarket (the draft was hand-given "Bermondsey") and no size.
    const draft = await createDraftRefreshedFromSource(adminSession, x.publicationId, {}, adminUserId);
    for (const d of await listPublicationDocuments(adminSession, draft.versionId)) made.push(d.storagePath);
    const v = await latest(x.publicationId);
    expect(v.submarket).toBe("Bermondsey");
    expect(draft.overwritten).not.toContain("submarket");
    expect(draft.overwritten).not.toContain("size_sqft");
  });

  it("overwrites the Overview only when an investor overview exists, and never from the summary", async () => {
    const x = await published("3 Overview Row", { investorOverview: "Newly written for investors." });
    const draft = await createDraftRefreshedFromSource(adminSession, x.publicationId, {}, adminUserId);
    for (const d of await listPublicationDocuments(adminSession, draft.versionId)) made.push(d.storagePath);
    const v = await latest(x.publicationId);
    expect(v.overview).toBe("Newly written for investors.");
    expect(draft.overwritten).toContain("overview");
    expect(JSON.stringify(v)).not.toContain("ZZ-INTERNAL");
  });

  it("works on a withdrawn publication, from its latest version", async () => {
    const x = await published("4 Withdrawn Row");
    await supersedeActiveVersion(adminSession, x.publicationId);
    const draft = await createDraftRefreshedFromSource(adminSession, x.publicationId, {}, adminUserId);
    for (const d of await listPublicationDocuments(adminSession, draft.versionId)) made.push(d.storagePath);
    expect(draft.versionNumber).toBe(2);
    expect((await latest(x.publicationId)).headline).toBe("Hand-written headline");
  });

  it("starts without a document whose file is already missing, and says which", async () => {
    const x = await published("5 Damaged Row");
    const [teaser] = (await listPublicationDocuments(adminSession, x.versionId)).filter((d) => d.title === "Teaser");
    await deleteDocumentObject(teaser.storagePath);
    const draft = await createDraftRefreshedFromSource(adminSession, x.publicationId, {}, adminUserId);
    for (const d of await listPublicationDocuments(adminSession, draft.versionId)) made.push(d.storagePath);
    expect(draft.missingDocuments).toEqual(["Teaser"]);
    expect((await listPublicationDocuments(adminSession, draft.versionId)).map((d) => d.title)).toEqual(["Title report"]);
  });

  it("a failure part-way leaves no draft and no stray copies", async () => {
    const x = await published("6 Rollback Row");
    const copiedPaths: string[] = []; const removed: string[] = [];
    const failing: DocumentObjectStore = {
      async copy(_s, versionId, mime) {
        if (copiedPaths.length === 1) throw new Error("storage outage");
        const to = newObjectPath(versionId, mime ?? "application/pdf");
        await putDocumentObject(to, new TextEncoder().encode("c"), "application/pdf");
        copiedPaths.push(to); made.push(to); return to;
      },
      async remove(paths) { removed.push(...paths); await Promise.all(paths.map((p) => deleteDocumentObject(p))); },
    };
    await expect(createDraftRefreshedFromSource(adminSession, x.publicationId, { objects: failing }, adminUserId))
      .rejects.toThrow(/storage outage/);
    expect(removed).toEqual(copiedPaths);
    expect(await signDocumentObject(copiedPaths[0])).toBeNull();
    const rows = await adminQuery<{ n: number }>(
      "select count(*)::int as n from publication_versions where publication_id = $1", [x.publicationId]);
    expect(rows[0].n).toBe(1); // still just v1
  });

  it("refuses while another version is open", async () => {
    const x = await published("7 Open Row");
    const d = await createDraftRefreshedFromSource(adminSession, x.publicationId, {}, adminUserId);
    for (const doc of await listPublicationDocuments(adminSession, d.versionId)) made.push(doc.storagePath);
    await expect(createDraftRefreshedFromSource(adminSession, x.publicationId, {}, adminUserId))
      .rejects.toThrow(/already has an open draft/);
  });
});
