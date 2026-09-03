// ============================================================================
// P2 — the admin publication workflow, end to end against the real database.
// ----------------------------------------------------------------------------
//   internal opportunity → prepare publication → draft → review → publish
//   → edit published (new version) → publish again → drift → entitlements
//
// The fixture is self-contained (its own opportunities, investor organisation,
// contact and auth user), so the seeded fixtures and the P0/P1 suites that
// follow are untouched.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { withSession, withInvestorSession, type Session } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import { createOpportunity, updateOpportunity } from "@/lib/data/opportunities";
import {
  createInvestorOrganization, createInvestorContact, createPublicationFromOpportunity,
  updateDraftVersion, submitVersionForReview, returnVersionToDraft, publishVersion,
  addPublicationDocument, listPublicationDocuments, listPublicationVersions,
  grantEntitlement, updateEntitlement, revokeEntitlement, setEntitlementPlacement,
  listEntitlements, publicationSourceDrift, getPublication, getVersionProvenance,
} from "@/lib/data/investor-portal";
import {
  getPublicationForOpportunity, createDraftFromVersion, listPublicationSummaries,
  getAdminOverview, listVersionDrift, getPublicationSourcePanel,
} from "@/lib/data/admin-portal";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

let meiji: string;
let staff: Session;
let adminUserId: string;

// Own portal fixture.
let investorOrgId: string;
let investorUid: string;

// Opportunity A drives the whole lifecycle; B exists for the featured pair.
let oppA: string;
let oppB: string;
let pubA: string;
let pubB: string;
let versionOne: string;
let versionTwo: string;
let entitlementA: string;
let entitlementB: string;

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  staff = orgUserSession([meiji]);
  adminUserId = await profileIdByEmail("admin@reiwa.com");

  investorUid = await ensureAuthUser(createSupabaseAdminClient(), {
    email: "workflow@p2-fixture.example",
    password: DEMO_PASSWORD,
    name: "W. Fixture",
  });
  investorOrgId = await createInvestorOrganization(adminSession, {
    name: "P2 Workflow Capital",
    notes: "Created by tests/admin-workflow.test.ts.",
  });
  await createInvestorContact(adminSession, {
    investorOrgId,
    email: "workflow@p2-fixture.example",
    name: "W. Fixture",
    title: "Principal",
    authUserId: investorUid,
  });

  oppA = await createOpportunity(staff, {
    orgId: meiji, name: "31 Savile Row", city: "London", country: "United Kingdom",
    market: "London", assetType: "office", strategy: "core_plus", currency: "GBP",
    targetPrice: 47500000, niy: 4.35, targetIrr: 12.5, capexBudget: 3500000,
    probability: 55, summary: "Mayfair freehold with rooftop consent.",
    brokerName: "Very Confidential Broker LLP", vendorName: "Very Confidential Vendor Ltd",
    source: "Off-market",
  });
  oppB = await createOpportunity(staff, {
    orgId: meiji, name: "Keizersgracht 200", city: "Amsterdam", country: "Netherlands",
    market: "Amsterdam", assetType: "office", strategy: "core", currency: "EUR",
    targetPrice: 29000000, niy: 4.9, targetIrr: 9.2,
  });
});

// ============================================================================
// Create from opportunity — whitelist and one-publication-per-opportunity
// ============================================================================
describe("Creating a publication from an internal opportunity", () => {
  it("prefills a draft through the P1 whitelist and nothing else", async () => {
    const created = await createPublicationFromOpportunity(adminSession, oppA, adminUserId);
    pubA = created.publicationId;
    versionOne = created.versionId;
    expect(created.versionNumber).toBe(1);

    const version = (await listPublicationVersions(adminSession, pubA))[0];
    expect(version.status).toBe("draft");
    expect(version.title).toBe("31 Savile Row");
    expect(version.headlinePrice).toBe(47500000);
    expect(version.overview).toBe("Mayfair freehold with rooftop consent.");

    // Nothing confidential reaches the investor-facing row.
    const raw = await withSession(adminSession, (tx) =>
      tx.query("select * from publication_versions where version_id = $1", [versionOne]));
    const serialised = JSON.stringify(raw.rows[0]);
    expect(serialised).not.toContain("Confidential Broker");
    expect(serialised).not.toContain("Confidential Vendor");
    expect(serialised).not.toContain("Off-market");
    expect(serialised).not.toContain(oppA); // no internal identifier either

    // Provenance exists, privately.
    expect((await getVersionProvenance(adminSession, versionOne))?.sourceFingerprint).toBeTruthy();
  });

  it("keeps one publication identity per opportunity", async () => {
    // The action path: an existing publication is opened, not duplicated.
    expect(await getPublicationForOpportunity(adminSession, oppA)).toBe(pubA);

    // The data-layer path reuses the same identity...
    const again = await createPublicationFromOpportunity(adminSession, oppA, adminUserId);
    expect(again.publicationId).toBe(pubA);
    // (clean up the extra draft it added, keeping the lifecycle unambiguous)
    await withSession(adminSession, (tx) =>
      tx.query("delete from publication_versions where version_id = $1", [again.versionId]));

    // ...and the database refuses a second identity outright.
    await expect(withSession(adminSession, async (tx) => {
      const p = await tx.query<{ publication_id: string }>(
        "insert into investor_publications(status) values ('draft') returning publication_id");
      await tx.query(
        "insert into publication_sources(publication_id, opportunity_id) values ($1,$2)",
        [p.rows[0].publication_id, oppA]);
    })).rejects.toThrow(/duplicate key|publication_sources/);

    const count = await withSession(adminSession, (tx) =>
      tx.query<{ n: number }>(
        "select count(*)::int as n from publication_sources where opportunity_id = $1", [oppA]));
    expect(count.rows[0].n).toBe(1);
  });
});

// ============================================================================
// Draft → In Review → Published
// ============================================================================
describe("The version lifecycle", () => {
  it("a draft is freely editable", async () => {
    await updateDraftVersion(adminSession, versionOne, {
      title: "31 Savile Row — Mayfair Freehold",
      headline: "Prime Mayfair office with consented rooftop extension",
      highlights: ["Freehold", "Rooftop consent granted"],
    });
    const version = (await listPublicationVersions(adminSession, pubA))[0];
    expect(version.title).toBe("31 Savile Row — Mayfair Freehold");
    expect(version.highlights).toEqual(["Freehold", "Rooftop consent granted"]);

    // Documents attach while the version is editable — one per tier.
    for (const [title, level] of [
      ["Teaser", "standard"], ["Data room index", "diligence"], ["IC memo", "internal"],
    ] as const) {
      await addPublicationDocument(adminSession, {
        versionId: versionOne, title, storagePath: `publications/${versionOne}/${level}.pdf`,
        accessLevel: level, category: "other",
      }, adminUserId);
    }
    expect(await listPublicationDocuments(adminSession, versionOne)).toHaveLength(3);
  });

  it("in-review freezes content until returned or published", async () => {
    await submitVersionForReview(adminSession, versionOne, adminUserId);

    // It appears in the admin review queue.
    const overview = await getAdminOverview(adminSession);
    expect(overview.counts.publicationsInReview).toBeGreaterThan(0);
    expect(overview.reviewQueue.map((v) => v.versionId)).toContain(versionOne);

    // The data layer's draft update no longer matches it...
    await updateDraftVersion(adminSession, versionOne, { title: "Sneaky edit" });
    let version = (await listPublicationVersions(adminSession, pubA))[0];
    expect(version.title).toBe("31 Savile Row — Mayfair Freehold");

    // ...and a direct statement is rejected by the lifecycle trigger.
    await expect(withSession(adminSession, (tx) =>
      tx.query("update publication_versions set title = 'Forced edit' where version_id = $1",
               [versionOne]))).rejects.toThrow(/in review/);

    // A submission can be returned to the author and edited again.
    await returnVersionToDraft(adminSession, versionOne);
    await updateDraftVersion(adminSession, versionOne, { headline: "Prime Mayfair core-plus office" });
    version = (await listPublicationVersions(adminSession, pubA))[0];
    expect(version.status).toBe("draft");
    expect(version.headline).toBe("Prime Mayfair core-plus office");

    await submitVersionForReview(adminSession, versionOne, adminUserId);
  });

  it("publishing makes the version live for entitled investors", async () => {
    await publishVersion(adminSession, versionOne, adminUserId);
    const publication = await getPublication(adminSession, pubA);
    expect(publication!.status).toBe("published");
    expect(publication!.activeVersionId).toBe(versionOne);

    entitlementA = await grantEntitlement(adminSession, {
      investorOrgId, publicationId: pubA, isVisible: true, placement: "featured",
      documentAccessLevel: "standard",
    }, adminUserId);

    const feed = await withInvestorSession(investorUid, (tx) =>
      tx.query<{ title: string; placement: string }>("select title, placement from investor_feed"));
    expect(feed.rows).toEqual([
      { title: "31 Savile Row — Mayfair Freehold", placement: "featured" },
    ]);
  });

  it("a published version is immutable, documents included", async () => {
    await expect(withSession(adminSession, (tx) =>
      tx.query("update publication_versions set title = 'Post-publish edit' where version_id = $1",
               [versionOne]))).rejects.toThrow(/immutable/);
    await expect(withSession(adminSession, (tx) =>
      tx.query("delete from publication_versions where version_id = $1", [versionOne])))
      .rejects.toThrow(/immutable/);
    await expect(addPublicationDocument(adminSession, {
      versionId: versionOne, title: "Late addition", storagePath: "late.pdf",
    })).rejects.toThrow(/immutable/);

    // The courtesy guard in the data layer is a silent no-op on the same rule.
    await updateDraftVersion(adminSession, versionOne, { title: "Another attempt" });
    const version = (await listPublicationVersions(adminSession, pubA))[0];
    expect(version.title).toBe("31 Savile Row — Mayfair Freehold");
  });
});

// ============================================================================
// Editing a published publication = a new draft version
// ============================================================================
describe("Editing published content", () => {
  it("creates a new draft copied from the published version", async () => {
    const draft = await createDraftFromVersion(adminSession, versionOne, {}, adminUserId);
    versionTwo = draft.versionId;
    expect(draft.versionNumber).toBe(2);

    const versions = await listPublicationVersions(adminSession, pubA);
    const v2 = versions.find((v) => v.versionId === versionTwo)!;
    expect(v2.status).toBe("draft");
    expect(v2.title).toBe("31 Savile Row — Mayfair Freehold"); // copied, not re-prefilled
    expect(v2.highlights).toEqual(["Freehold", "Rooftop consent granted"]);

    // Documents came across so the admin does not rebuild the set by hand.
    expect(await listPublicationDocuments(adminSession, versionTwo)).toHaveLength(3);

    // Provenance is inherited from the copied version: same captured snapshot.
    const [p1, p2] = await Promise.all([
      getVersionProvenance(adminSession, versionOne),
      getVersionProvenance(adminSession, versionTwo),
    ]);
    expect(p2?.sourceFingerprint).toBe(p1?.sourceFingerprint);

    // While it exists, the live version is untouched and still what investors see.
    expect((await getPublication(adminSession, pubA))!.activeVersionId).toBe(versionOne);

    // One editable version at a time.
    await expect(createDraftFromVersion(adminSession, versionOne))
      .rejects.toThrow(/already has an open draft/);
  });

  it("publishing the new version replaces the live one and preserves history", async () => {
    await updateDraftVersion(adminSession, versionTwo, {
      title: "31 Savile Row — Mayfair Freehold (Phase II)",
    });
    await submitVersionForReview(adminSession, versionTwo, adminUserId);
    await publishVersion(adminSession, versionTwo, adminUserId);

    const publication = await getPublication(adminSession, pubA);
    expect(publication!.activeVersionId).toBe(versionTwo);

    const versions = await listPublicationVersions(adminSession, pubA);
    const v1 = versions.find((v) => v.versionId === versionOne)!;
    const v2 = versions.find((v) => v.versionId === versionTwo)!;
    expect(v2.status).toBe("published");
    expect(v1.status).toBe("superseded");
    expect(v1.supersededAt).toBeTruthy();
    expect(v1.title).toBe("31 Savile Row — Mayfair Freehold"); // history intact

    // The investor sees exactly the new version.
    const feed = await withInvestorSession(investorUid, (tx) =>
      tx.query<{ title: string; version_id: string }>("select title, version_id from investor_feed"));
    expect(feed.rows).toEqual([
      { title: "31 Savile Row — Mayfair Freehold (Phase II)", version_id: versionTwo },
    ]);
  });
});

// ============================================================================
// Source drift is surfaced, never silently applied
// ============================================================================
describe("Source drift", () => {
  it("reports the change and leaves the publication untouched", async () => {
    await updateOpportunity(staff, oppA, { targetPrice: 45000000, summary: "Repriced guide." });

    const drift = await publicationSourceDrift(adminSession, versionTwo);
    expect(drift.changed).toBe(true);

    // Surfaced on the admin read models…
    const summary = (await listPublicationSummaries(adminSession))
      .find((p) => p.publicationId === pubA)!;
    expect(summary.sourceChanged).toBe(true);
    const perVersion = await listVersionDrift(adminSession, pubA);
    expect(perVersion.find((d) => d.versionId === versionTwo)!.changed).toBe(true);
    expect((await getPublicationSourcePanel(adminSession, pubA))!.opportunityId).toBe(oppA);

    // …while the live investor content is exactly what was published.
    const versions = await listPublicationVersions(adminSession, pubA);
    const v2 = versions.find((v) => v.versionId === versionTwo)!;
    expect(v2.headlinePrice).toBe(47500000);
    const feed = await withInvestorSession(investorUid, (tx) =>
      tx.query<{ headline_price: string }>("select headline_price from investor_feed"));
    expect(Number(feed.rows[0].headline_price)).toBe(47500000);
  });
});

// ============================================================================
// Entitlements: the featured slot, revocation, document tiers
// ============================================================================
describe("Entitlements", () => {
  it("keeps at most one visible featured opportunity per organisation", async () => {
    // A second published publication for the same investor.
    const b = await createPublicationFromOpportunity(adminSession, oppB, adminUserId);
    pubB = b.publicationId;
    await submitVersionForReview(adminSession, b.versionId, adminUserId);
    await publishVersion(adminSession, b.versionId, adminUserId);
    entitlementB = await grantEntitlement(adminSession, {
      investorOrgId, publicationId: pubB, isVisible: true, placement: "secondary",
    }, adminUserId);

    // The workflow path succeeds by demoting the current featured entitlement…
    await setEntitlementPlacement(adminSession, entitlementB, "featured");
    let rows = await listEntitlements(adminSession, investorOrgId);
    expect(rows.find((e) => e.entitlementId === entitlementB)!.placement).toBe("featured");
    expect(rows.find((e) => e.entitlementId === entitlementA)!.placement).toBe("secondary");

    // …because the database itself refuses two visible featured rows.
    await expect(withSession(adminSession, (tx) =>
      tx.query("update publication_entitlements set placement = 'featured' where entitlement_id = $1",
               [entitlementA]))).rejects.toThrow(/single_featured|duplicate key/);

    // Symmetrically, promoting A back demotes B — the UI path never trips the index.
    await setEntitlementPlacement(adminSession, entitlementA, "featured");
    rows = await listEntitlements(adminSession, investorOrgId);
    expect(rows.filter((e) => e.isVisible && e.placement === "featured")).toHaveLength(1);
    expect(rows.find((e) => e.entitlementId === entitlementA)!.placement).toBe("featured");
  });

  it("revoking an entitlement removes visibility immediately", async () => {
    let feed = await withInvestorSession(investorUid, (tx) =>
      tx.query<{ version_id: string }>("select version_id from investor_feed"));
    expect(feed.rows).toHaveLength(2);

    await revokeEntitlement(adminSession, entitlementB);

    feed = await withInvestorSession(investorUid, (tx) =>
      tx.query<{ version_id: string }>("select version_id from investor_feed"));
    expect(feed.rows.map((r) => r.version_id)).toEqual([versionTwo]);

    // The record is kept for the admin, hidden from the investor.
    const rows = await listEntitlements(adminSession, investorOrgId);
    const revoked = rows.find((e) => e.entitlementId === entitlementB)!;
    expect(revoked.isVisible).toBe(false);
  });

  it("document-access tier changes persist and take effect", async () => {
    const readableLevels = () => withInvestorSession(investorUid, (tx) =>
      tx.query<{ access_level: string }>(
        `select access_level from publication_documents where version_id = $1 order by access_level`,
        [versionTwo]));

    // Standard tier: the diligence and internal documents are invisible.
    expect((await readableLevels()).rows.map((r) => r.access_level)).toEqual(["standard"]);

    await updateEntitlement(adminSession, entitlementA, { documentAccessLevel: "diligence" });
    let rows = await listEntitlements(adminSession, investorOrgId);
    expect(rows.find((e) => e.entitlementId === entitlementA)!.documentAccessLevel).toBe("diligence");
    expect((await readableLevels()).rows.map((r) => r.access_level))
      .toEqual(["diligence", "standard"]); // internal stays unreachable at every tier

    await updateEntitlement(adminSession, entitlementA, { documentAccessLevel: "standard" });
    rows = await listEntitlements(adminSession, investorOrgId);
    expect(rows.find((e) => e.entitlementId === entitlementA)!.documentAccessLevel).toBe("standard");
    expect((await readableLevels()).rows.map((r) => r.access_level)).toEqual(["standard"]);
  });
});
