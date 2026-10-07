// ============================================================================
// Every publication document owns its stored file.
// ----------------------------------------------------------------------------
// Reproduces the audit's data-loss path with REAL stored objects, end to end:
//
//   publish v1 with a document -> start a draft (v2) -> remove the document from v2
//   -> fetch the v1 document exactly as the investor would.
//
// Before this fix the last step failed: v2's row pointed at v1's file, and removing it
// deleted the file. Also covered: the guard that refuses to delete a file anything else
// still references, the repair for rows that already share a file, a missing source file,
// and cleanup when a copy fails part-way.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, withSession } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import { createOpportunity } from "@/lib/data/opportunities";
import {
  addPublicationDocument, createInvestorContact, createInvestorOrganization,
  createPublicationFromOpportunity, grantEntitlement, listPublicationDocuments,
  publishVersion, submitVersionForReview, removePublicationDocument,
} from "@/lib/data/investor-portal";
import { createDraftFromVersion } from "@/lib/data/admin-portal";
import { issueDocumentDownload } from "@/lib/documents/secure-delivery";
import { removePublicationDocumentAndObject } from "@/lib/documents/publication-documents";
import { getPublishReview } from "@/lib/data/publish-review";
import { findSharedDocuments, unshareDocuments } from "@/lib/documents/ownership";
import {
  putDocumentObject, signDocumentObject, deleteDocumentObject, newObjectPath, ensureDocumentBucket,
  type DocumentObjectStore,
} from "@/lib/documents/storage";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail, testPool } from "./helpers";

const adminDb = createSupabaseAdminClient;
let adminUserId: string;
let portalUid: string;
let portalOrgId: string;
let meiji: string;
const created: string[] = [];

const bytes = (text: string) => new TextEncoder().encode(text);

async function fetchAsInvestor(documentId: string): Promise<{ status: number; body: string }> {
  const grant = await issueDocumentDownload(portalUid, documentId);
  if (!grant) return { status: 404, body: "" }; // what the portal route answers
  const res = await fetch(grant.signedUrl);
  return { status: res.status, body: await res.text() };
}

async function newPublication(name: string): Promise<{ publicationId: string; v1: string }> {
  const opp = await createOpportunity(orgUserSession([meiji]), {
    orgId: meiji, name, city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "core", currency: "GBP", targetPrice: 5000000, niy: 5, targetIrr: 11,
  });
  const p = await createPublicationFromOpportunity(adminSession, opp, adminUserId);
  await grantEntitlement(adminSession, {
    investorOrgId: portalOrgId, publicationId: p.publicationId, isVisible: true, placement: "secondary",
    documentAccessLevel: "diligence",
  }, adminUserId);
  return { publicationId: p.publicationId, v1: p.versionId };
}

/** A real stored object plus the row that owns it. */
async function attach(versionId: string, title: string, content: string, level = "standard"): Promise<{ documentId: string; path: string }> {
  const path = newObjectPath(versionId, "application/pdf");
  await putDocumentObject(path, bytes(content), "application/pdf");
  created.push(path);
  const documentId = await addPublicationDocument(adminSession, {
    versionId, title, storagePath: path, fileName: `${title}.pdf`, mimeType: "application/pdf",
    sizeBytes: content.length, accessLevel: level as "standard" | "diligence",
  }, adminUserId);
  return { documentId, path };
}

async function publish(versionId: string): Promise<void> {
  await submitVersionForReview(adminSession, versionId, adminUserId);
  await publishVersion(adminSession, versionId, adminUserId);
}

beforeAll(async () => {
  await ensureDocumentBucket();
  meiji = await orgIdByName("Meiji Shipping");
  adminUserId = await profileIdByEmail("admin@reiwa.com");
  portalUid = await ensureAuthUser(adminDb(), {
    email: "ownership@portal-fixture.example", password: DEMO_PASSWORD, name: "D. Fixture",
  });
  portalOrgId = await createInvestorOrganization(adminSession, { name: "Ownership Fixture Partners", notes: "tests/publication-document-ownership.test.ts" });
  await createInvestorContact(adminSession, {
    investorOrgId: portalOrgId, email: "ownership@portal-fixture.example", name: "D. Fixture",
    title: "Principal", authUserId: portalUid,
  });
});

afterAll(async () => {
  for (const p of created) await deleteDocumentObject(p).catch(() => undefined);
});

describe("the audit's reproduction: removing a document from a draft", () => {
  let v1: string; let v2: string;
  let liveDoc: { documentId: string; path: string };

  it("v1 is published with a document the investor can fetch", async () => {
    const pub = await newPublication("Repro Lane");
    v1 = pub.v1;
    liveDoc = await attach(v1, "Title report", "TITLE-REPORT-BYTES", "diligence");
    await publish(v1);
    expect(await fetchAsInvestor(liveDoc.documentId)).toEqual({ status: 200, body: "TITLE-REPORT-BYTES" });
  });

  it("a new draft gets its OWN copy of the file, with identical content", async () => {
    const draft = await createDraftFromVersion(adminSession, v1, { copyDocuments: true }, adminUserId);
    v2 = draft.versionId;
    expect(draft.missingDocuments).toEqual([]);
    const docs = await listPublicationDocuments(adminSession, v2);
    expect(docs).toHaveLength(1);
    expect(docs[0].storagePath).not.toBe(liveDoc.path);
    expect(docs[0].storagePath).toContain(`publications/${v2}/`);
    created.push(docs[0].storagePath);
    const signed = await signDocumentObject(docs[0].storagePath);
    expect(await (await fetch(signed!)).text()).toBe("TITLE-REPORT-BYTES");

    // The copy is still the SAME document, so the publish review does not call it new.
    const live = (await listPublicationDocuments(adminSession, v1))[0];
    expect(docs[0].lineageId).toBe(live.lineageId);
    const review = await getPublishReview(adminSession, v2);
    expect(review!.diff.documents).toEqual([]);
  });

  it("removing the document from v2 deletes v2's file, and v1 still serves", async () => {
    const [draftDoc] = await listPublicationDocuments(adminSession, v2);
    const deleted = await removePublicationDocumentAndObject(adminSession, draftDoc.documentId);
    expect(deleted).toBe(draftDoc.storagePath);
    expect(await signDocumentObject(draftDoc.storagePath)).toBeNull(); // v2's own file is gone
    expect(await listPublicationDocuments(adminSession, v2)).toHaveLength(0);

    // The investor's fetch of the LIVE v1 document, the step that used to 404.
    expect(await fetchAsInvestor(liveDoc.documentId)).toEqual({ status: 200, body: "TITLE-REPORT-BYTES" });
    expect(await signDocumentObject(liveDoc.path)).not.toBeNull();
  });
});

describe("a file is never shared, and never deleted from under another row", () => {
  it("the database refuses a second row on the same file", async () => {
    const { v1 } = await newPublication("Unique Lane");
    const d = await attach(v1, "Teaser", "T");
    await publish(v1);
    const draft = await createDraftFromVersion(adminSession, v1, { copyDocuments: false }, adminUserId);
    await expect(addPublicationDocument(adminSession, {
      versionId: draft.versionId, title: "Teaser again", storagePath: d.path, accessLevel: "standard",
    }, adminUserId)).rejects.toThrow(/duplicate key|publication_documents_storage_path_key/);
  });

  it("copying stops cleanly when a file is missing: the draft starts without it and says so", async () => {
    const { v1 } = await newPublication("Missing Lane");
    const keep = await attach(v1, "Kept", "KEPT");
    const gone = await attach(v1, "Lost", "LOST");
    await publish(v1);
    await deleteDocumentObject(gone.path); // already damaged, as the old bug left it
    const draft = await createDraftFromVersion(adminSession, v1, { copyDocuments: true }, adminUserId);
    expect(draft.missingDocuments).toEqual(["Lost"]);
    const docs = await listPublicationDocuments(adminSession, draft.versionId);
    expect(docs.map((d) => d.title)).toEqual(["Kept"]);
    created.push(docs[0].storagePath);
    expect(docs[0].storagePath).not.toBe(keep.path);
  });

  it("a failed copy part-way rolls the draft back and removes the files already copied", async () => {
    const { v1 } = await newPublication("Rollback Lane");
    await attach(v1, "One", "1");
    await attach(v1, "Two", "2");
    await publish(v1);
    const made: string[] = []; const removed: string[] = [];
    const failing: DocumentObjectStore = {
      async copy(source, versionId, mime) {
        if (made.length === 1) throw new Error("storage outage");
        const to = newObjectPath(versionId, mime ?? "application/pdf");
        await putDocumentObject(to, bytes("copy"), "application/pdf");
        made.push(to); created.push(to);
        return to;
      },
      async remove(paths) { removed.push(...paths); await Promise.all(paths.map((p) => deleteDocumentObject(p))); },
    };
    await expect(createDraftFromVersion(adminSession, v1, { copyDocuments: true, objects: failing }, adminUserId))
      .rejects.toThrow(/storage outage/);
    expect(removed).toEqual(made); // the one copy that did land was cleaned up
    expect(await signDocumentObject(made[0])).toBeNull();
    const open = await adminQuery<{ n: number }>(
      `select count(*)::int as n from publication_versions pv
         join publication_documents d on d.version_id = pv.version_id
        where pv.status = 'draft' and d.storage_path = any($1::text[])`, [made]);
    expect(open[0].n).toBe(0);
    // And no half-made draft remains: a second attempt with a working store succeeds.
    const ok = await createDraftFromVersion(adminSession, v1, { copyDocuments: true }, adminUserId);
    for (const d of await listPublicationDocuments(adminSession, ok.versionId)) created.push(d.storagePath);
    expect(ok.versionNumber).toBe(2);
  });
});

describe("rows that already share a file (data from before the unique index)", () => {
  const INDEX = "publication_documents_storage_path_key";
  let publicationId: string; let v1: string;
  let doc1: { documentId: string; path: string };
  let sharedDraftDocId: string; let draftVersion: string;

  beforeAll(async () => {
    // Recreate the legacy state: drop the index, then make a draft whose row shares v1's file.
    await adminQuery(`drop index if exists ${INDEX}`);
    const pub = await newPublication("Legacy Lane");
    publicationId = pub.publicationId; v1 = pub.v1;
    doc1 = await attach(v1, "Legacy doc", "LEGACY-BYTES");
    await publish(v1);
    const draft = await createDraftFromVersion(adminSession, v1, { copyDocuments: false }, adminUserId);
    draftVersion = draft.versionId;
    sharedDraftDocId = await addPublicationDocument(adminSession, {
      versionId: draftVersion, title: "Legacy doc", storagePath: doc1.path, fileName: "Legacy doc.pdf",
      mimeType: "application/pdf", accessLevel: "standard",
    }, adminUserId);
  });

  afterAll(async () => {
    // Whatever happened, leave the index in place for everything else.
    await unshareDocuments(testPool(), { apply: true });
    await adminQuery(`create unique index if not exists ${INDEX} on publication_documents (storage_path)`);
  });

  it("removing the shared row from the draft leaves the file alone (the interim guard)", async () => {
    const path = await removePublicationDocument(adminSession, sharedDraftDocId);
    expect(path).toBeNull(); // still referenced by v1: not returned for deletion
    expect(await signDocumentObject(doc1.path)).not.toBeNull();
    expect(await fetchAsInvestor(doc1.documentId)).toEqual({ status: 200, body: "LEGACY-BYTES" });
    // put the shared row back for the repair test
    sharedDraftDocId = await addPublicationDocument(adminSession, {
      versionId: draftVersion, title: "Legacy doc", storagePath: doc1.path, fileName: "Legacy doc.pdf",
      mimeType: "application/pdf", accessLevel: "standard",
    }, adminUserId);
  });

  it("the audit finds it, and a dry run changes nothing", async () => {
    const before = await findSharedDocuments(testPool());
    const mine = before.find((g) => g.keep.documentId === doc1.documentId)!;
    expect(mine.repoint.map((r) => r.documentId)).toEqual([sharedDraftDocId]);
    const dry = await unshareDocuments(testPool(), { apply: false });
    expect(dry.applied).toBe(false);
    expect(dry.indexCreated).toBe(false);
    const after = await listPublicationDocuments(adminSession, draftVersion);
    expect(after[0].storagePath).toBe(doc1.path); // untouched
  });

  it("the repair gives the draft its own copy, keeps v1 on the original, and restores the index", async () => {
    const report = await unshareDocuments(testPool(), { apply: true });
    expect(report.unrepairable).toEqual([]);
    expect(report.indexCreated).toBe(true);
    const [draftDoc] = await listPublicationDocuments(adminSession, draftVersion);
    expect(draftDoc.storagePath).not.toBe(doc1.path);
    created.push(draftDoc.storagePath);
    expect(await (await fetch((await signDocumentObject(draftDoc.storagePath))!)).text()).toBe("LEGACY-BYTES");
    expect((await listPublicationDocuments(adminSession, v1))[0].storagePath).toBe(doc1.path);
    // Now the draft can be emptied without touching v1.
    await removePublicationDocumentAndObject(adminSession, draftDoc.documentId);
    expect(await fetchAsInvestor(doc1.documentId)).toEqual({ status: 200, body: "LEGACY-BYTES" });
    // The index is back, and so is the immutability trigger the repair switched off.
    const trig = await adminQuery<{ tgenabled: string }>(
      "select tgenabled from pg_trigger where tgname = 'trg_pubdocument_guard'");
    expect(trig[0].tgenabled).toBe("O");
    await expect(addPublicationDocument(adminSession, {
      versionId: draftVersion, title: "dup", storagePath: doc1.path, accessLevel: "standard",
    }, adminUserId)).rejects.toThrow(/duplicate key/);
  });

  it("repairs a file shared by two IMMUTABLE versions (the case the trigger would block)", async () => {
    await adminQuery(`drop index if exists ${INDEX}`);
    const pub = await newPublication("Immutable Lane");
    const d1 = await attach(pub.v1, "Frozen", "FROZEN-BYTES");
    await publish(pub.v1);
    const draft = await createDraftFromVersion(adminSession, pub.v1, { copyDocuments: false }, adminUserId);
    await addPublicationDocument(adminSession, {
      versionId: draft.versionId, title: "Frozen", storagePath: d1.path, fileName: "Frozen.pdf",
      mimeType: "application/pdf", accessLevel: "standard",
    }, adminUserId);
    await publish(draft.versionId); // v1 superseded, v2 published: both immutable, one file

    const report = await unshareDocuments(testPool(), { apply: true });
    const moved = report.repointed.find((r) => r.title === "Frozen")!;
    expect(moved.versionNumber).toBe(2);
    created.push(moved.to);
    const live = (await listPublicationDocuments(adminSession, draft.versionId))[0];
    expect(live.storagePath).toBe(moved.to);
    expect(await (await fetch((await signDocumentObject(live.storagePath))!)).text()).toBe("FROZEN-BYTES");
    expect((await listPublicationDocuments(adminSession, pub.v1))[0].storagePath).toBe(d1.path);
  });

  it("shared rows whose file is already gone are reported, not guessed at", async () => {
    await adminQuery(`drop index if exists ${INDEX}`);
    const pub = await newPublication("Gone Lane");
    const d = await attach(pub.v1, "Gone", "X");
    await publish(pub.v1);
    const draft = await createDraftFromVersion(adminSession, pub.v1, { copyDocuments: false }, adminUserId);
    const dupe = await addPublicationDocument(adminSession, {
      versionId: draft.versionId, title: "Gone", storagePath: d.path, accessLevel: "standard",
    }, adminUserId);
    await deleteDocumentObject(d.path);
    const report = await unshareDocuments(testPool(), { apply: true });
    expect(report.unrepairable.map((u) => u.path)).toContain(d.path);
    expect(report.indexCreated).toBe(false); // the shared rows remain, so the index cannot be built
    await adminQuery("delete from publication_documents where document_id = $1", [dupe]); // tidy for the next file
  });
});
