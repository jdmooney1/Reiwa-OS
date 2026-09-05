// ============================================================================
// P4 — the investor-facing portal, against the real database.
// ----------------------------------------------------------------------------
// Exercises what the investor actually receives: the curated feed, one
// opportunity, saved state, comparison, tiered documents and information
// requests — and, at every one of those, that the boundary holds. The portal
// reads nothing but the P1 investor surfaces, so each test below asserts on the
// same functions the pages call, with no privileged connection in the path.
//
// Self-contained fixture (its own internal opportunities, investor
// organisations, contacts and Auth users); nothing seeded is touched, so the
// P0-P3 suites stay valid.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withInvestorSession, type Session } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import { createOpportunity } from "@/lib/data/opportunities";
import {
  createInvestorOrganization, createInvestorContact, updateInvestorContact,
  updateInvestorOrganization, createPublicationFromOpportunity, updateDraftVersion,
  publishVersion, addPublicationDocument, grantEntitlement,
  updateEntitlement, supersedeActiveVersion, listEntitlements,
} from "@/lib/data/investor-portal";
import { createDraftFromVersion } from "@/lib/data/admin-portal";
import { loadPortalIdentity } from "@/lib/auth/portal-session";
import {
  loadPortalFeed, loadPortalOpportunity, loadPortalDocuments, loadSavedOpportunities,
  loadSavedIds, loadComparison, loadRequestsForPublication, saveOpportunity,
  unsaveOpportunity, submitRequest, recordPortalEvent, COMPARE_LIMIT,
} from "@/lib/data/portal-feed";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

const PRIMARY = "primary@p4-fixture.example";     // standard tier
const COLLEAGUE = "colleague@p4-fixture.example"; // same organisation as PRIMARY
const DILIGENCE = "diligence@p4-fixture.example"; // a different org, diligence tier

let staff: Session;
let adminUserId: string;
let staffAuthUserId: string;

let orgId: string;          // "P4 Portal Partners" — standard tier
let diligenceOrgId: string; // "P4 Diligence House" — diligence tier
let primaryUid: string;
let colleagueUid: string;
let diligenceUid: string;
let primaryContactId: string;

// Publications, by the role each plays in the fixture.
let pubFeatured: string;    // featured, visible, published twice (v1 superseded)
let pubAlpha: string;       // secondary, sort_order 10
let pubBeta: string;        // secondary, sort_order 5  -> must sort before Alpha
let pubHidden: string;      // entitlement exists, is_visible = false
let pubForeign: string;     // entitled to the diligence org only
let pubWithdrawn: string;   // published, then withdrawn
let featuredV1: string;
let featuredV2: string;
let featuredDocs: { standard: string; diligence: string; internal: string };

/** Create an internal opportunity + publication, publish v1, return both ids. */
async function publish(
  name: string, headline: string, highlights: string[],
  overrides: Record<string, unknown> = {},
): Promise<{ publicationId: string; versionId: string }> {
  const opportunityId = await createOpportunity(staff, {
    orgId: await orgIdByName("Meiji Shipping"),
    name, city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "core_plus", currency: "GBP",
    targetPrice: 25_000_000, niy: 4.5, targetIrr: 11.5,
    summary: `${name} — internal summary.`,
    brokerName: "Confidential Broker LLP", vendorName: "Confidential Vendor Ltd",
  });
  const created = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
  await updateDraftVersion(adminSession, created.versionId, {
    headline, highlights, ...overrides,
  });
  await publishVersion(adminSession, created.versionId, adminUserId);
  return { publicationId: created.publicationId, versionId: created.versionId };
}

beforeAll(async () => {
  staff = orgUserSession([await orgIdByName("Meiji Shipping")]);
  adminUserId = await profileIdByEmail("admin@reiwa.com");
  staffAuthUserId = adminUserId;

  const supabase = createSupabaseAdminClient();
  primaryUid = await ensureAuthUser(supabase,
    { email: PRIMARY, password: DEMO_PASSWORD, name: "P. Fixture" });
  colleagueUid = await ensureAuthUser(supabase,
    { email: COLLEAGUE, password: DEMO_PASSWORD, name: "C. Fixture" });
  diligenceUid = await ensureAuthUser(supabase,
    { email: DILIGENCE, password: DEMO_PASSWORD, name: "D. Fixture" });

  orgId = await createInvestorOrganization(adminSession, {
    name: "P4 Portal Partners", notes: "Created by tests/portal-experience.test.ts.",
  });
  diligenceOrgId = await createInvestorOrganization(adminSession, {
    name: "P4 Diligence House", notes: "Created by tests/portal-experience.test.ts.",
  });

  primaryContactId = await createInvestorContact(adminSession, {
    investorOrgId: orgId, email: PRIMARY, name: "P. Fixture",
    title: "Principal", authUserId: primaryUid,
  });
  await createInvestorContact(adminSession, {
    investorOrgId: orgId, email: COLLEAGUE, name: "C. Fixture", authUserId: colleagueUid,
  });
  await createInvestorContact(adminSession, {
    investorOrgId: diligenceOrgId, email: DILIGENCE, name: "D. Fixture", authUserId: diligenceUid,
  });

  // ---- Publications -------------------------------------------------------
  const featured = await publish("P4 Featured Tower", "Version one headline",
    ["Original rationale"]);
  pubFeatured = featured.publicationId;
  featuredV1 = featured.versionId;

  // A second published version: v1 becomes superseded and must never be read.
  const draft2 = await createDraftFromVersion(adminSession, featuredV1,
    { copyDocuments: false }, adminUserId);
  featuredV2 = draft2.versionId;
  await updateDraftVersion(adminSession, featuredV2, {
    headline: "Version two headline",
    highlights: ["Revised rationale", "Second point"],
    targetIrr: 13.25,
  });

  // One document per tier. A published version's documents are immutable
  // (P2 guard), so they are attached while this version is still a draft.
  featuredDocs = {
    standard: await addPublicationDocument(adminSession, {
      versionId: featuredV2, title: "P4 Teaser", category: "teaser",
      storagePath: "publications/p4/teaser.pdf", accessLevel: "standard", sortOrder: 0,
    }, adminUserId),
    diligence: await addPublicationDocument(adminSession, {
      versionId: featuredV2, title: "P4 Data Room Index", category: "data_room",
      storagePath: "publications/p4/data-room.pdf", accessLevel: "diligence", sortOrder: 1,
    }, adminUserId),
    internal: await addPublicationDocument(adminSession, {
      versionId: featuredV2, title: "P4 Internal IC Memo", category: "other",
      storagePath: "publications/p4/internal-ic-memo.pdf", accessLevel: "internal", sortOrder: 2,
    }, adminUserId),
  };

  await publishVersion(adminSession, featuredV2, adminUserId);

  pubAlpha = (await publish("P4 Secondary Alpha", "Alpha headline", ["Alpha point"])).publicationId;
  pubBeta = (await publish("P4 Secondary Beta", "Beta headline", ["Beta point"])).publicationId;
  pubHidden = (await publish("P4 Hidden Manor", "Hidden headline", [])).publicationId;
  pubForeign = (await publish("P4 Foreign Estate", "Foreign headline", [])).publicationId;
  const withdrawn = await publish("P4 Withdrawn House", "Withdrawn headline", []);
  pubWithdrawn = withdrawn.publicationId;

  // ---- Entitlements -------------------------------------------------------
  await grantEntitlement(adminSession, {
    investorOrgId: orgId, publicationId: pubFeatured, isVisible: true,
    placement: "featured", sortOrder: 0, documentAccessLevel: "standard",
    investorNote: "Shared ahead of the spring committee.",
  }, adminUserId);
  await grantEntitlement(adminSession, {
    investorOrgId: orgId, publicationId: pubAlpha, isVisible: true,
    placement: "secondary", sortOrder: 10, documentAccessLevel: "standard",
  }, adminUserId);
  await grantEntitlement(adminSession, {
    investorOrgId: orgId, publicationId: pubBeta, isVisible: true,
    placement: "secondary", sortOrder: 5, documentAccessLevel: "standard",
  }, adminUserId);
  // Present but hidden — grants nothing.
  await grantEntitlement(adminSession, {
    investorOrgId: orgId, publicationId: pubHidden, isVisible: false,
    placement: "secondary", sortOrder: 20, documentAccessLevel: "diligence",
  }, adminUserId);
  // Visible, then the publication itself is withdrawn.
  await grantEntitlement(adminSession, {
    investorOrgId: orgId, publicationId: pubWithdrawn, isVisible: true,
    placement: "secondary", sortOrder: 30, documentAccessLevel: "standard",
  }, adminUserId);
  await supersedeActiveVersion(adminSession, pubWithdrawn);

  // The other organisation: the same featured publication at the diligence
  // tier, plus one publication our primary org has no entitlement to at all.
  await grantEntitlement(adminSession, {
    investorOrgId: diligenceOrgId, publicationId: pubFeatured, isVisible: true,
    placement: "featured", sortOrder: 0, documentAccessLevel: "diligence",
  }, adminUserId);
  await grantEntitlement(adminSession, {
    investorOrgId: diligenceOrgId, publicationId: pubForeign, isVisible: true,
    placement: "secondary", sortOrder: 0, documentAccessLevel: "standard",
  }, adminUserId);
});

// ============================================================================
// 1, 2, 3 — the curated feed
// ============================================================================
describe("The curated feed", () => {
  it("shows only the publications this investor is entitled to see", async () => {
    const feed = await loadPortalFeed(primaryUid);
    const titles = [feed.featured, ...feed.secondary]
      .filter(Boolean).map((o) => o!.title).sort();
    expect(titles).toEqual(["P4 Featured Tower", "P4 Secondary Alpha", "P4 Secondary Beta"]);

    // Nothing hidden, withdrawn or belonging to another organisation appears.
    expect(titles).not.toContain("P4 Hidden Manor");
    expect(titles).not.toContain("P4 Withdrawn House");
    expect(titles).not.toContain("P4 Foreign Estate");
  });

  it("presents the featured publication as featured, and only one of them", async () => {
    const feed = await loadPortalFeed(primaryUid);
    expect(feed.featured).not.toBeNull();
    expect(feed.featured!.title).toBe("P4 Featured Tower");
    expect(feed.featured!.placement).toBe("featured");
    expect(feed.featured!.investorNote).toBe("Shared ahead of the spring committee.");
    expect(feed.secondary.every((o) => o.placement === "secondary")).toBe(true);
  });

  it("orders the secondary opportunities by the order the admin configured", async () => {
    const feed = await loadPortalFeed(primaryUid);
    // Beta carries sort_order 5, Alpha 10 — configured order, not alphabetical.
    expect(feed.secondary.map((o) => o.title)).toEqual([
      "P4 Secondary Beta", "P4 Secondary Alpha",
    ]);
  });

  it("shows a different organisation an entirely different portal", async () => {
    const feed = await loadPortalFeed(diligenceUid);
    expect(feed.featured!.title).toBe("P4 Featured Tower");
    expect(feed.secondary.map((o) => o.title)).toEqual(["P4 Foreign Estate"]);
  });
});

// ============================================================================
// 4, 5, 6, 7 — a publication id is not a capability
// ============================================================================
describe("Direct access to an opportunity", () => {
  it("refuses a publication this investor holds no entitlement to", async () => {
    expect(await loadPortalOpportunity(primaryUid, pubForeign)).toBeNull();
  });

  it("refuses a publication whose entitlement is hidden", async () => {
    expect(await loadPortalOpportunity(primaryUid, pubHidden)).toBeNull();
  });

  it("refuses a withdrawn publication, entitlement notwithstanding", async () => {
    // The entitlement is still visible; the publication is not live.
    const entitlements = await listEntitlements(adminSession, orgId);
    expect(entitlements.some((e) => e.publicationId === pubWithdrawn && e.isVisible)).toBe(true);
    expect(await loadPortalOpportunity(primaryUid, pubWithdrawn)).toBeNull();
  });

  it("never renders a superseded version — only the active one", async () => {
    const opportunity = await loadPortalOpportunity(primaryUid, pubFeatured);
    expect(opportunity).not.toBeNull();
    expect(opportunity!.versionId).toBe(featuredV2);
    expect(opportunity!.versionId).not.toBe(featuredV1);
    expect(opportunity!.headline).toBe("Version two headline");
    expect(opportunity!.highlights).toEqual(["Revised rationale", "Second point"]);
    expect(opportunity!.targetIrr).toBe(13.25);

    // The superseded version is unreadable even when named directly.
    const rows = await withInvestorSession(primaryUid, (tx) =>
      tx.query("select version_id from publication_versions where version_id = $1", [featuredV1]));
    expect(rows.rows).toEqual([]);
    // ...and so are its documents.
    expect(await loadPortalDocuments(primaryUid, featuredV1)).toEqual([]);
  });

  it("returns nothing for a malformed or unknown publication id", async () => {
    expect(await loadPortalOpportunity(primaryUid, "not-a-uuid")).toBeNull();
    expect(await loadPortalOpportunity(primaryUid,
      "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

// ============================================================================
// 8, 9 — saved state
// ============================================================================
describe("Saved opportunities", () => {
  it("is personal to the contact, not shared across the organisation", async () => {
    expect(await saveOpportunity(primaryUid, pubAlpha)).toBe(true);

    const mine = await loadSavedOpportunities(primaryUid);
    expect(mine.map((o) => o.title)).toEqual(["P4 Secondary Alpha"]);

    // A colleague at the same investor organisation sees their own empty list.
    expect(await loadSavedOpportunities(colleagueUid)).toEqual([]);
    expect(await loadSavedIds(colleagueUid)).toEqual([]);
  });

  it("saving twice is harmless, and unsaving removes it", async () => {
    expect(await saveOpportunity(primaryUid, pubBeta)).toBe(true);
    expect(await saveOpportunity(primaryUid, pubBeta)).toBe(false); // already saved
    expect((await loadSavedIds(primaryUid)).sort()).toEqual([pubAlpha, pubBeta].sort());

    expect(await unsaveOpportunity(primaryUid, pubBeta)).toBe(true);
    expect(await loadSavedIds(primaryUid)).toEqual([pubAlpha]);
  });

  it("cannot save an opportunity the investor is not entitled to", async () => {
    expect(await saveOpportunity(primaryUid, pubForeign)).toBe(false);
    expect(await saveOpportunity(primaryUid, pubHidden)).toBe(false);
    expect(await loadSavedIds(primaryUid)).toEqual([pubAlpha]);
  });

  it("a saved opportunity disappears the moment its entitlement is revoked", async () => {
    // Saved and visible...
    expect((await loadSavedOpportunities(primaryUid)).map((o) => o.title))
      .toEqual(["P4 Secondary Alpha"]);

    const entitlements = await listEntitlements(adminSession, orgId);
    const grant = entitlements.find((e) => e.publicationId === pubAlpha)!;
    await updateEntitlement(adminSession, grant.entitlementId, { isVisible: false });

    // ...and gone, without the saved row being touched.
    expect(await loadSavedOpportunities(primaryUid)).toEqual([]);
    const stillSaved = await adminQuery<{ n: string }>(
      "select count(*)::text as n from investor_saved where publication_id = $1", [pubAlpha]);
    expect(Number(stillSaved[0].n)).toBeGreaterThan(0);

    await updateEntitlement(adminSession, grant.entitlementId, { isVisible: true });
    expect((await loadSavedOpportunities(primaryUid)).map((o) => o.title))
      .toEqual(["P4 Secondary Alpha"]);
  });
});

// ============================================================================
// 10, 11 — comparison
// ============================================================================
describe("Comparison", () => {
  it("never returns more than three opportunities, whatever the client asks for", async () => {
    const asked = [pubFeatured, pubAlpha, pubBeta, pubFeatured, pubAlpha];
    const compared = await loadComparison(primaryUid, asked);
    expect(compared.length).toBeLessThanOrEqual(COMPARE_LIMIT);
    expect(compared.length).toBe(3);
    // De-duplicated, and in the order requested.
    expect(compared.map((o) => o.publicationId)).toEqual([pubFeatured, pubAlpha, pubBeta]);
  });

  it("silently drops anything the investor is not currently entitled to", async () => {
    const compared = await loadComparison(primaryUid, [pubForeign, pubHidden, pubWithdrawn]);
    expect(compared).toEqual([]);

    const mixed = await loadComparison(primaryUid, [pubForeign, pubFeatured]);
    expect(mixed.map((o) => o.title)).toEqual(["P4 Featured Tower"]);
  });

  it("ignores malformed ids rather than failing the page", async () => {
    const compared = await loadComparison(primaryUid, ["", "not-a-uuid", pubBeta]);
    expect(compared.map((o) => o.title)).toEqual(["P4 Secondary Beta"]);
  });
});

// ============================================================================
// 12, 13, 14 — document tiers
// ============================================================================
describe("Documents", () => {
  it("a standard entitlement receives standard documents only", async () => {
    const opportunity = await loadPortalOpportunity(primaryUid, pubFeatured);
    const docs = await loadPortalDocuments(primaryUid, opportunity!.versionId);
    expect(docs.map((d) => d.title)).toEqual(["P4 Teaser"]);
    expect(docs.every((d) => d.accessLevel === "standard")).toBe(true);
  });

  it("a diligence entitlement receives standard and diligence documents", async () => {
    const opportunity = await loadPortalOpportunity(diligenceUid, pubFeatured);
    const docs = await loadPortalDocuments(diligenceUid, opportunity!.versionId);
    expect(docs.map((d) => d.title)).toEqual(["P4 Teaser", "P4 Data Room Index"]);
    expect(docs.map((d) => d.accessLevel).sort()).toEqual(["diligence", "standard"]);
  });

  it("an internal document never reaches investor code, at any tier", async () => {
    for (const uid of [primaryUid, diligenceUid]) {
      const docs = await loadPortalDocuments(uid, featuredV2);
      expect(docs.some((d) => d.title === "P4 Internal IC Memo")).toBe(false);
      expect(docs.some((d) => (d.accessLevel as string) === "internal")).toBe(false);

      // Named directly, on the privileged row id, it is still unreadable.
      const direct = await withInvestorSession(uid, (tx) =>
        tx.query("select document_id, title from publication_documents where document_id = $1",
          [featuredDocs.internal]));
      expect(direct.rows).toEqual([]);
    }
  });

  it("never projects the private storage path to investor code", async () => {
    const docs = await loadPortalDocuments(diligenceUid, featuredV2);
    expect(docs.length).toBeGreaterThan(0);
    for (const d of docs) {
      expect(Object.keys(d)).not.toContain("storagePath");
      expect(JSON.stringify(d)).not.toContain("publications/p4/");
    }
  });
});

// ============================================================================
// 15, 16 — information requests
// ============================================================================
describe("Information requests", () => {
  it("binds the request to the submitting contact and the named publication", async () => {
    const requestId = await submitRequest(primaryUid, pubFeatured, "information",
      "  Please send the rent roll.  ");
    expect(requestId).toBeTruthy();

    const stored = await adminQuery<{
      investor_contact_id: string; investor_org_id: string; publication_id: string;
      request_type: string; message: string; status: string;
    }>("select investor_contact_id, investor_org_id, publication_id, request_type, message, status from investor_requests where request_id = $1",
      [requestId]);
    expect(stored[0].investor_contact_id).toBe(primaryContactId);
    expect(stored[0].investor_org_id).toBe(orgId);
    expect(stored[0].publication_id).toBe(pubFeatured);
    expect(stored[0].request_type).toBe("information");
    expect(stored[0].message).toBe("Please send the rent roll."); // trimmed
    expect(stored[0].status).toBe("new");

    // The contact reads their own request back; a colleague does not.
    expect((await loadRequestsForPublication(primaryUid, pubFeatured)).length).toBeGreaterThan(0);
    expect(await loadRequestsForPublication(colleagueUid, pubFeatured)).toEqual([]);
  });

  it("refuses a request forged against an unentitled publication", async () => {
    // The policy refuses the row; the data layer reports it as "not submitted"
    // rather than raising, so the portal shows a message instead of failing.
    expect(await submitRequest(primaryUid, pubForeign, "diligence_access", "let me in")).toBeNull();
    expect(await submitRequest(primaryUid, pubHidden, "information", null)).toBeNull();

    const leaked = await adminQuery<{ n: string }>(
      `select count(*)::text as n from investor_requests
        where publication_id = any($1::uuid[])`, [[pubForeign, pubHidden]]);
    expect(Number(leaked[0].n)).toBe(0);
  });

  it("records the factual activity events the product needs, and nothing derived", async () => {
    // The five events P4 is permitted to emit, written the way the pages and
    // actions write them.
    await recordPortalEvent(primaryUid, "opportunity_viewed",
      { publicationId: pubFeatured, versionId: featuredV2 });
    await recordPortalEvent(primaryUid, "saved", { publicationId: pubAlpha });
    await recordPortalEvent(primaryUid, "unsaved", { publicationId: pubAlpha });
    await recordPortalEvent(primaryUid, "compared",
      { context: { publication_ids: [pubFeatured, pubAlpha] } });

    const events = await adminQuery<{ event_type: string; context: Record<string, unknown> }>(
      `select event_type, context from investor_activity_events
        where investor_contact_id = $1 order by occurred_at desc limit 20`, [primaryContactId]);
    const types = new Set(events.map((e) => e.event_type));
    expect(types.has("opportunity_viewed")).toBe(true);
    expect(types.has("saved")).toBe(true);
    // No engagement score, duration or inferred suitability is ever written.
    for (const e of events) {
      const keys = Object.keys(e.context ?? {});
      expect(keys.some((k) => /score|duration|suitab|rank|dwell/i.test(k))).toBe(false);
    }
  });
});

// ============================================================================
// 17, 18, 19, 20 — the boundary still holds
// ============================================================================
describe("The boundary", () => {
  it("a suspended investor organisation loses the portal entirely", async () => {
    await updateInvestorOrganization(adminSession, diligenceOrgId, { status: "suspended" });
    try {
      expect(await loadPortalIdentity(diligenceUid)).toBeNull();
      const feed = await loadPortalFeed(diligenceUid);
      expect(feed.featured).toBeNull();
      expect(feed.secondary).toEqual([]);
      expect(await loadPortalOpportunity(diligenceUid, pubFeatured)).toBeNull();
      expect(await loadPortalDocuments(diligenceUid, featuredV2)).toEqual([]);
      expect(await saveOpportunity(diligenceUid, pubFeatured)).toBe(false);
    } finally {
      await updateInvestorOrganization(adminSession, diligenceOrgId, { status: "active" });
    }
    // Restored with the organisation.
    expect(await loadPortalIdentity(diligenceUid)).not.toBeNull();
  });

  it("a deactivated contact loses the portal, while colleagues keep it", async () => {
    const contacts = await adminQuery<{ investor_contact_id: string }>(
      "select investor_contact_id from investor_contacts where lower(email) = lower($1)", [COLLEAGUE]);
    const colleagueContactId = contacts[0].investor_contact_id;

    await updateInvestorContact(adminSession, colleagueContactId, { isActive: false });
    try {
      expect(await loadPortalIdentity(colleagueUid)).toBeNull();
      const feed = await loadPortalFeed(colleagueUid);
      expect(feed.featured).toBeNull();
      expect(feed.secondary).toEqual([]);
      // The organisation is untouched: the primary contact still has the portal.
      expect((await loadPortalFeed(primaryUid)).featured).not.toBeNull();
    } finally {
      await updateInvestorContact(adminSession, colleagueContactId, { isActive: true });
    }
    expect(await loadPortalIdentity(colleagueUid)).not.toBeNull();
  });

  it("an internal staff identity never resolves into the investor portal", async () => {
    expect(await loadPortalIdentity(staffAuthUserId)).toBeNull();

    // Even presented as an investor session, staff match no entitlement.
    const feed = await loadPortalFeed(staffAuthUserId);
    expect(feed.featured).toBeNull();
    expect(feed.secondary).toEqual([]);
    expect(await loadPortalOpportunity(staffAuthUserId, pubFeatured)).toBeNull();
    expect(await loadSavedOpportunities(staffAuthUserId)).toEqual([]);
  });

  it("an investor still reaches no internal table through the portal session", async () => {
    const internal = [
      "opportunities", "investment_cases", "assets", "business_plans",
      "transactions", "organizations", "profiles", "valuations", "properties",
      "publication_sources", "publication_version_sources",
    ];
    for (const table of internal) {
      const { rows } = await withInvestorSession(primaryUid, (tx) =>
        tx.query<{ n: string }>(`select count(*)::text as n from ${table}`));
      expect({ table, rows: Number(rows[0].n) }).toEqual({ table, rows: 0 });
    }
  });

  it("carries no internal identifier on anything the portal renders", async () => {
    const internalIds = new Set<string>();
    for (const q of [
      "select opportunity_id::text as id from opportunities",
      "select org_id::text as id from organizations",
      "select asset_id::text as id from assets",
    ]) {
      for (const r of await adminQuery<{ id: string }>(q)) internalIds.add(r.id);
    }

    const feed = await loadPortalFeed(primaryUid);
    const rendered = JSON.stringify([feed.featured, ...feed.secondary]);
    for (const id of internalIds) {
      expect({ id, leaked: rendered.includes(id) }).toEqual({ id, leaked: false });
    }
  });
});
