// ============================================================================
// Investment Portal — the publication boundary and the version lifecycle.
// ----------------------------------------------------------------------------
// Exercises the admin data layer against the real database: the one-way prefill
// from an internal opportunity, the atomic publish, the immutability of a
// published snapshot, and the entitlement constraints. Investor-side assertions
// run through withInvestorSession(), so they are decided by RLS.
//
// The fixture here is self-contained (its own investor organisation, contact and
// Supabase Auth user), so nothing it does can disturb the seeded fixtures.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withInvestorSession, withSession, type Session } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import { createOpportunity, updateOpportunity } from "@/lib/data/opportunities";
import {
  addPublicationDocument, createInvestorContact, createInvestorOrganization,
  createPublicationFromOpportunity, getPublicationProvenance, getVersionProvenance,
  grantEntitlement, listPublicationsForInvestorOrg,
  listPublicationVersions, publicationSourceDrift, publishVersion, readPublicationSource,
  revokeEntitlement, setEntitlementPlacement, submitVersionForReview,
  supersedeActiveVersion, updateDraftVersion, updateInvestorContact,
  updateInvestorOrganization,
} from "@/lib/data/investor-portal";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

let meiji: string;
let staff: Session;
let adminUserId: string;

// The isolated portal fixture for this file.
let portalOrgId: string;
let portalContactId: string;
let portalUid: string;

// The internal opportunity this file publishes from.
let opportunityId: string;
let publicationId: string;
let versionOne: string;

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  staff = orgUserSession([meiji]);
  adminUserId = await profileIdByEmail("admin@reiwa.com");

  portalUid = await ensureAuthUser(createSupabaseAdminClient(), {
    email: "lifecycle@portal-fixture.example",
    password: DEMO_PASSWORD,
    name: "L. Fixture",
  });
  portalOrgId = await createInvestorOrganization(adminSession, {
    name: "Lifecycle Fixture Partners",
    notes: "Created by tests/publication-lifecycle.test.ts.",
  });
  portalContactId = await createInvestorContact(adminSession, {
    investorOrgId: portalOrgId,
    email: "lifecycle@portal-fixture.example",
    name: "L. Fixture",
    title: "Portfolio Manager",
    authUserId: portalUid,
  });

  opportunityId = await createOpportunity(staff, {
    orgId: meiji,
    name: "14 Cavendish Row",
    city: "London",
    country: "United Kingdom",
    market: "London",
    assetType: "office",
    strategy: "value_add",
    currency: "GBP",
    targetPrice: 51000000,
    niy: 4.6,
    targetIrr: 14.25,
    capexBudget: 6000000,
    probability: 60,
    summary: "Freehold island site with vacant upper floors.",
    brokerName: "Confidential Broker LLP",
    vendorName: "Confidential Vendor Ltd",
    source: "Off-market introduction",
  });
});

describe("The publication boundary is a whitelist", () => {
  it("copies only approved fields out of the internal opportunity", async () => {
    const source = await readPublicationSource(adminSession, opportunityId);
    expect(source).not.toBeNull();

    // Approved.
    expect(source!.title).toBe("14 Cavendish Row");
    expect(source!.city).toBe("London");
    expect(Number(source!.headline_price)).toBe(51000000);
    expect(source!.overview).toBe("Freehold island site with vacant upper floors.");

    // Everything else is absent by construction, not by omission at call sites.
    for (const excluded of ["broker_name", "vendor_name", "source", "probability",
                            "capex_budget", "stage", "status", "org_id", "opportunity_id",
                            "owner_user_id", "reference"]) {
      expect(Object.keys(source!)).not.toContain(excluded);
    }
  });

  it("creates a publication and a draft version carrying no confidential field", async () => {
    const created = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
    publicationId = created.publicationId;
    versionOne = created.versionId;
    expect(created.versionNumber).toBe(1);

    const version = (await listPublicationVersions(adminSession, publicationId))[0];
    expect(version.status).toBe("draft");
    expect(version.title).toBe("14 Cavendish Row");
    expect(version.headlinePrice).toBe(51000000);
    expect(version.targetIrr).toBe(14.25);

    // Provenance is recorded, but privately — not on the version row.
    const provenance = await getVersionProvenance(adminSession, versionOne);
    expect(provenance!.sourceFingerprint).toBeTruthy();
    const link = await getPublicationProvenance(adminSession, publicationId);
    expect(link!.opportunityId).toBe(opportunityId);
    expect(Object.keys(version)).not.toContain("sourceOpportunityId");

    // The broker and vendor are nowhere in the investor-facing row.
    const raw = await adminQuery<Record<string, unknown>>(
      "select to_jsonb(v)::text as body from publication_versions v where v.version_id = $1",
      [versionOne]);
    expect(String(raw[0].body)).not.toContain("Confidential Broker");
    expect(String(raw[0].body)).not.toContain("Confidential Vendor");
    expect(String(raw[0].body)).not.toContain("Off-market introduction");
  });

  it("keeps one publication identity per internal opportunity", async () => {
    const again = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
    expect(again.publicationId).toBe(publicationId);   // same identity
    expect(again.versionId).not.toBe(versionOne);      // a new draft
    expect(again.versionNumber).toBe(2);

    // The rule now lives on the private mapping: a second publication cannot be
    // linked to the same internal opportunity.
    const orphan = (await adminQuery<{ publication_id: string }>(
      "insert into investor_publications(status) values ('draft') returning publication_id"))[0];
    await expect(adminQuery(
      "insert into publication_sources(publication_id, opportunity_id) values ($1,$2)",
      [orphan.publication_id, opportunityId],
    )).rejects.toThrow(/unique|duplicate/i);
    await adminQuery("delete from investor_publications where publication_id = $1",
                     [orphan.publication_id]);

    // Keep the file's fixture tidy: drop the extra draft.
    await adminQuery("delete from publication_versions where version_id = $1", [again.versionId]);
  });
});

describe("Draft editing and review", () => {
  it("accepts edits while a version is a draft", async () => {
    await updateDraftVersion(adminSession, versionOne, {
      headline: "Freehold City fringe repositioning",
      overview: "Investor-facing narrative, written by Reiwa — not the internal summary.",
      highlights: ["Vacant possession of floors 3–6", "Planning consent for a roof extension"],
    });
    const version = (await listPublicationVersions(adminSession, publicationId))[0];
    expect(version.headline).toBe("Freehold City fringe repositioning");
    expect(version.highlights).toEqual([
      "Vacant possession of floors 3–6", "Planning consent for a roof extension",
    ]);
  });

  it("freezes content once the version is submitted for review", async () => {
    await submitVersionForReview(adminSession, versionOne, adminUserId);
    const version = (await listPublicationVersions(adminSession, publicationId))[0];
    expect(version.status).toBe("in_review");
    expect(version.submittedAt).toBeTruthy();

    await expect(
      withSession(adminSession, (tx) =>
        tx.query("update publication_versions set headline = 'Edited in review' where version_id = $1",
                 [versionOne])),
    ).rejects.toThrow(/in review/i);

    // A second submission of the same version is rejected.
    await expect(submitVersionForReview(adminSession, versionOne, adminUserId)).rejects.toThrow();
  });
});

describe("Publishing", () => {
  it("attaches documents while the version is still editable", async () => {
    for (const [title, level] of [
      ["Investment teaser", "standard"], ["Data room index", "diligence"],
      ["Internal IC memo", "internal"],
    ] as const) {
      await addPublicationDocument(adminSession, {
        versionId: versionOne,
        title,
        category: level === "internal" ? "other" : "teaser",
        storagePath: `publications/${versionOne}/${level}.pdf`,
        accessLevel: level,
      }, adminUserId);
    }
    const docs = await adminQuery<{ n: number }>(
      "select count(*)::int as n from publication_documents where version_id = $1", [versionOne]);
    expect(docs[0].n).toBe(3);
  });

  it("publishes, and makes the publication visible to an entitled organisation", async () => {
    await publishVersion(adminSession, versionOne, adminUserId);

    const publication = await adminQuery<{ status: string; active_version_id: string }>(
      "select status, active_version_id from investor_publications where publication_id = $1",
      [publicationId]);
    expect(publication[0].status).toBe("published");
    expect(publication[0].active_version_id).toBe(versionOne);

    // Default deny: an entitlement that is not visible shows nothing.
    const entitlementId = await grantEntitlement(adminSession, {
      investorOrgId: portalOrgId, publicationId, documentAccessLevel: "diligence",
    }, adminUserId);
    let seen = await withInvestorSession(portalUid, (tx) =>
      tx.query("select * from investor_publications where publication_id = $1", [publicationId]));
    expect(seen.rows.length).toBe(0);

    await setEntitlementPlacement(adminSession, entitlementId, "featured", 0);
    await withSession(adminSession, (tx) =>
      tx.query("update publication_entitlements set is_visible = true where entitlement_id = $1",
               [entitlementId]));

    seen = await withInvestorSession(portalUid, (tx) =>
      tx.query("select * from investor_publications where publication_id = $1", [publicationId]));
    expect(seen.rows.length).toBe(1);
  });

  it("swaps the active version atomically when a second version is published", async () => {
    const next = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
    await updateDraftVersion(adminSession, next.versionId, { headline: "Second release" });

    // Before: the investor reads version one.
    const before = await withInvestorSession(portalUid, (tx) =>
      tx.query<{ version_id: string }>(
        "select version_id from publication_versions where publication_id = $1", [publicationId]));
    expect(before.rows.map((r) => r.version_id)).toEqual([versionOne]);

    await publishVersion(adminSession, next.versionId, adminUserId);

    // After: exactly one live version, the pointer moved, the old one superseded.
    const versions = await adminQuery<{ version_id: string; status: string }>(
      "select version_id, status from publication_versions where publication_id = $1", [publicationId]);
    expect(versions.filter((v) => v.status === "published").map((v) => v.version_id))
      .toEqual([next.versionId]);
    expect(versions.find((v) => v.version_id === versionOne)!.status).toBe("superseded");

    const publication = await adminQuery<{ active_version_id: string }>(
      "select active_version_id from investor_publications where publication_id = $1", [publicationId]);
    expect(publication[0].active_version_id).toBe(next.versionId);

    // The investor never sees both: one row, the new one.
    const after = await withInvestorSession(portalUid, (tx) =>
      tx.query<{ version_id: string }>(
        "select version_id from publication_versions where publication_id = $1", [publicationId]));
    expect(after.rows.map((r) => r.version_id)).toEqual([next.versionId]);

    versionOne = next.versionId; // the live version from here on
  });

  it("cannot leave two live versions behind, even by direct statement", async () => {
    const superseded = (await adminQuery<{ version_id: string }>(
      "select version_id from publication_versions where publication_id = $1 and status = 'superseded'",
      [publicationId]))[0].version_id;

    await expect(adminQuery(
      "update publication_versions set status = 'published' where version_id = $1", [superseded],
    )).rejects.toThrow();
  });

  it("refuses to publish a version that is already published", async () => {
    await expect(publishVersion(adminSession, versionOne, adminUserId))
      .rejects.toThrow(/cannot be published from status/i);
  });
});

describe("A published version is immutable", () => {
  it("rejects edits, deletes and document changes", async () => {
    await expect(adminQuery(
      "update publication_versions set headline = 'Rewritten' where version_id = $1", [versionOne],
    )).rejects.toThrow(/immutable/i);

    await expect(adminQuery(
      "update publication_versions set published_at = now() where version_id = $1", [versionOne],
    )).rejects.toThrow(/immutable/i);

    await expect(adminQuery(
      "delete from publication_versions where version_id = $1", [versionOne],
    )).rejects.toThrow(/immutable/i);

    await expect(adminQuery(
      `insert into publication_documents(version_id, title, storage_path, access_level)
       values ($1,'Late addition','publications/late.pdf','standard')`, [versionOne],
    )).rejects.toThrow(/immutable/i);

    const doc = await adminQuery<{ document_id: string }>(
      "select document_id from publication_documents where version_id = $1 limit 1", [versionOne]);
    if (doc[0]) {
      await expect(adminQuery(
        "delete from publication_documents where document_id = $1", [doc[0].document_id],
      )).rejects.toThrow(/immutable/i);
    }
  });

  it("rejects any change to a superseded version", async () => {
    const superseded = (await adminQuery<{ version_id: string }>(
      "select version_id from publication_versions where publication_id = $1 and status = 'superseded'",
      [publicationId]))[0].version_id;

    await expect(adminQuery(
      "update publication_versions set headline = 'Rewritten' where version_id = $1", [superseded],
    )).rejects.toThrow(/immutable/i);
    await expect(adminQuery(
      "delete from publication_versions where version_id = $1", [superseded],
    )).rejects.toThrow(/immutable/i);
  });
});

describe("The publication is independent of the internal opportunity", () => {
  it("does not follow changes made to the internal record, and reports the drift", async () => {
    const before = (await listPublicationVersions(adminSession, publicationId))
      .find((v) => v.versionId === versionOne)!;
    const driftBefore = await publicationSourceDrift(adminSession, versionOne);
    expect(driftBefore.changed).toBe(false);

    await updateOpportunity(staff, opportunityId, {
      name: "14 Cavendish Row (renamed internally)",
      targetPrice: 47500000,
      summary: "Internal view revised after the second inspection.",
    });

    // The published snapshot is untouched.
    const after = (await listPublicationVersions(adminSession, publicationId))
      .find((v) => v.versionId === versionOne)!;
    expect(after.title).toBe(before.title);
    expect(after.headlinePrice).toBe(before.headlinePrice);
    expect(after.overview).toBe(before.overview);

    // ...and so is what the investor reads.
    const investorView = await withInvestorSession(portalUid, (tx) =>
      tx.query<{ title: string; headline_price: string }>(
        "select title, headline_price from investor_feed where publication_id = $1", [publicationId]));
    expect(investorView.rows[0].title).toBe("14 Cavendish Row");

    // The admin side can tell that the internal record has moved on.
    const drift = await publicationSourceDrift(adminSession, versionOne);
    expect(drift.changed).toBe(true);
    expect(drift.capturedFingerprint).not.toBe(drift.currentFingerprint);
  });
});

describe("Entitlement constraints", () => {
  it("allows at most one visible featured publication per investor organisation", async () => {
    // A second publication for the same investor organisation.
    const otherOpportunity = await createOpportunity(staff, {
      orgId: meiji, name: "Second Featured Probe", market: "London", assetType: "office",
      currency: "GBP", targetPrice: 12000000,
    });
    const second = await createPublicationFromOpportunity(adminSession, otherOpportunity, adminUserId);
    await publishVersion(adminSession, second.versionId, adminUserId);

    // Direct statement: the database refuses the second visible featured row.
    await expect(adminQuery(
      `insert into publication_entitlements(investor_org_id, publication_id, is_visible, placement)
       values ($1,$2,true,'featured')`, [portalOrgId, second.publicationId],
    )).rejects.toThrow(/publication_entitlements_single_featured|unique|duplicate/i);

    // Through the data layer, assigning featured demotes the incumbent.
    const secondEntitlement = await grantEntitlement(adminSession, {
      investorOrgId: portalOrgId, publicationId: second.publicationId,
      isVisible: true, placement: "featured",
    }, adminUserId);

    const assigned = await listPublicationsForInvestorOrg(adminSession, portalOrgId);
    const featured = assigned.filter((a) => a.entitlement.placement === "featured" && a.entitlement.isVisible);
    expect(featured.length).toBe(1);
    expect(featured[0].publication.publicationId).toBe(second.publicationId);

    // Restore this file's fixture as the featured one.
    await revokeEntitlement(adminSession, secondEntitlement);
    const restored = (await listPublicationsForInvestorOrg(adminSession, portalOrgId))
      .find((a) => a.publication.publicationId === publicationId)!;
    await setEntitlementPlacement(adminSession, restored.entitlement.entitlementId, "featured", 0);
    await withSession(adminSession, (tx) =>
      tx.query("update publication_entitlements set is_visible = true where entitlement_id = $1",
               [restored.entitlement.entitlementId]));
  });

  it("cannot grant an investor the internal document tier", async () => {
    await expect(adminQuery(
      `update publication_entitlements set document_access_level = 'internal'
        where investor_org_id = $1`, [portalOrgId],
    )).rejects.toThrow(/document_access_level/i);
  });
});

describe("Access ends the moment the record is disabled", () => {
  async function visibleToFixture(): Promise<number> {
    const { rows } = await withInvestorSession(portalUid, (tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from investor_publications"));
    return rows[0].n;
  }

  it("a deactivated contact immediately loses access", async () => {
    expect(await visibleToFixture()).toBeGreaterThan(0);

    await updateInvestorContact(adminSession, portalContactId, { isActive: false });
    expect(await visibleToFixture()).toBe(0);
    const feed = await withInvestorSession(portalUid, (tx) =>
      tx.query("select * from investor_feed"));
    expect(feed.rows.length).toBe(0);

    await updateInvestorContact(adminSession, portalContactId, { isActive: true });
    expect(await visibleToFixture()).toBeGreaterThan(0);
  });

  it("a suspended investor organisation immediately loses access", async () => {
    await updateInvestorOrganization(adminSession, portalOrgId, { status: "suspended" });
    expect(await visibleToFixture()).toBe(0);

    // Not even their own organisation row resolves any more.
    const org = await withInvestorSession(portalUid, (tx) =>
      tx.query("select * from investor_organizations"));
    expect(org.rows.length).toBe(0);

    await updateInvestorOrganization(adminSession, portalOrgId, { status: "active" });
    expect(await visibleToFixture()).toBeGreaterThan(0);
  });

  it("a revoked entitlement immediately loses access", async () => {
    const assigned = (await listPublicationsForInvestorOrg(adminSession, portalOrgId))
      .find((a) => a.publication.publicationId === publicationId)!;
    await revokeEntitlement(adminSession, assigned.entitlement.entitlementId);

    const seen = await withInvestorSession(portalUid, (tx) =>
      tx.query("select * from investor_publications where publication_id = $1", [publicationId]));
    expect(seen.rows.length).toBe(0);
  });

  it("withdrawing the live version removes the publication from every portal", async () => {
    const assigned = (await listPublicationsForInvestorOrg(adminSession, portalOrgId))
      .find((a) => a.publication.publicationId === publicationId)!;
    await withSession(adminSession, (tx) =>
      tx.query("update publication_entitlements set is_visible = true where entitlement_id = $1",
               [assigned.entitlement.entitlementId]));
    expect(await visibleToFixture()).toBeGreaterThan(0);

    const withdrawn = await supersedeActiveVersion(adminSession, publicationId);
    expect(withdrawn).toBe(versionOne);

    const publication = await adminQuery<{ status: string; active_version_id: string | null }>(
      "select status, active_version_id from investor_publications where publication_id = $1",
      [publicationId]);
    expect(publication[0].status).toBe("withdrawn");
    expect(publication[0].active_version_id).toBeNull();

    const seen = await withInvestorSession(portalUid, (tx) =>
      tx.query("select * from investor_publications where publication_id = $1", [publicationId]));
    expect(seen.rows.length).toBe(0);
  });
});
