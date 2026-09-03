// ============================================================================
// P2 — the admin surface is Reiwa-admin only.
// ----------------------------------------------------------------------------
// Two layers, both asserted here:
//   * the application gate (isPortalAdmin / assertPortalAdmin) that the /admin
//     layout and every admin server action call first, and
//   * the database itself: the same admin read models and mutations executed
//     under a non-admin session return nothing and write nothing, because every
//     portal policy requires app.is_admin(). The screens are a convenience; RLS
//     is the control.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withSession } from "@/lib/db/client";
import { isPortalAdmin, assertPortalAdmin } from "@/lib/auth/admin";
import {
  getAdminOverview, listInvestorOrgSummaries, listPublicationSummaries,
  listEntitlementsForPublication, createDraftFromVersion,
} from "@/lib/data/admin-portal";
import {
  createInvestorOrganization, createInvestorContact, grantEntitlement,
  createPublicationFromOpportunity, updateDraftVersion, submitVersionForReview,
  publishVersion, revokeEntitlement, listInvestorOrganizations, addPublicationDocument,
} from "@/lib/data/investor-portal";
import {
  adminSession, orgIdByName, orgUserSession, viewerSession,
  investorOrgIdByName, publicationByOpportunityName,
} from "./helpers";

let meiji: string;
let hanabi: string;
let bondStreet: { publicationId: string; opportunityId: string; activeVersionId: string | null };
let queensGateDraftId: string; // the seeded open draft (v3) of 58 Queens Gate

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  hanabi = await investorOrgIdByName("Hanabi Ventures");
  bondStreet = await publicationByOpportunityName("Old Bond Street Retail");
  const queensGate = await publicationByOpportunityName("58 Queens Gate");
  const draft = await adminQuery<{ version_id: string }>(
    "select version_id from publication_versions where publication_id = $1 and status = 'draft'",
    [queensGate.publicationId]);
  queensGateDraftId = draft[0].version_id;
});

describe("The application gate", () => {
  it("admits only the reiwa_admin global role", () => {
    expect(isPortalAdmin({ role: "reiwa_admin" })).toBe(true);
    expect(isPortalAdmin({ role: "org_user" })).toBe(false);
    expect(isPortalAdmin({ role: "investor_viewer" })).toBe(false);

    expect(() => assertPortalAdmin({ role: "reiwa_admin" })).not.toThrow();
    expect(() => assertPortalAdmin({ role: "org_user" })).toThrow(/Not authorised/);
    expect(() => assertPortalAdmin({ role: "investor_viewer" })).toThrow(/Not authorised/);
  });
});

describe("Non-admin staff read nothing through the admin read models", () => {
  it("sees empty directories and a zeroed overview", async () => {
    for (const session of [orgUserSession([meiji]), viewerSession([meiji])]) {
      expect(await listInvestorOrgSummaries(session)).toEqual([]);
      expect(await listPublicationSummaries(session)).toEqual([]);
      expect(await listInvestorOrganizations(session)).toEqual([]);
      expect(await listEntitlementsForPublication(session, bondStreet.publicationId)).toEqual([]);

      const overview = await getAdminOverview(session);
      expect(overview.counts).toEqual({
        investorOrganizations: 0,
        activeContacts: 0,
        publicationsInDraft: 0,
        publicationsInReview: 0,
        publicationsPublished: 0,
        visibleAssignments: 0,
      });
      expect(overview.reviewQueue).toEqual([]);
      expect(overview.unassignedPublished).toEqual([]);
      expect(overview.investorsWithoutAssignments).toEqual([]);
    }
  });
});

describe("Non-admin staff cannot perform admin mutations", () => {
  it("cannot create investor organisations or contacts", async () => {
    for (const session of [orgUserSession([meiji]), viewerSession([meiji])]) {
      await expect(createInvestorOrganization(session, { name: "Rogue Capital" }))
        .rejects.toThrow();
      await expect(createInvestorContact(session, {
        investorOrgId: hanabi, email: "rogue@rogue.example", name: "R. Ogue",
      })).rejects.toThrow();
    }
  });

  it("cannot create a publication, even from an opportunity they can read", async () => {
    const staff = orgUserSession([meiji]);
    const opp = await adminQuery<{ opportunity_id: string }>(
      "select opportunity_id from opportunities where org_id = $1 and name = 'Magna Plaza'", [meiji]);
    // The org user CAN read the opportunity — the boundary function returns the
    // projection — but the insert into investor_publications is denied.
    await expect(createPublicationFromOpportunity(staff, opp[0].opportunity_id))
      .rejects.toThrow();
  });

  it("cannot edit, submit or publish a draft version", async () => {
    const staff = orgUserSession([meiji]);

    // Update matches no row under their RLS: a silent no-op that changes nothing.
    await updateDraftVersion(staff, queensGateDraftId, { title: "Defaced by staff" });
    const after = await adminQuery<{ title: string; status: string }>(
      "select title, status from publication_versions where version_id = $1", [queensGateDraftId]);
    expect(after[0].title).not.toBe("Defaced by staff");
    expect(after[0].status).toBe("draft");

    await expect(submitVersionForReview(staff, queensGateDraftId)).rejects.toThrow();
    await expect(publishVersion(staff, queensGateDraftId)).rejects.toThrow();
    await expect(createDraftFromVersion(staff, queensGateDraftId)).rejects.toThrow(/not found|not readable/);
  });

  it("cannot attach documents or touch entitlements", async () => {
    const staff = orgUserSession([meiji]);
    await expect(addPublicationDocument(staff, {
      versionId: queensGateDraftId, title: "Planted document", storagePath: "x/y.pdf",
    })).rejects.toThrow();

    await expect(grantEntitlement(staff, {
      investorOrgId: hanabi, publicationId: bondStreet.publicationId, isVisible: true,
    })).rejects.toThrow();

    // Revoking matches no row under their RLS; Hanabi's access is untouched.
    const entitlement = await adminQuery<{ entitlement_id: string }>(
      `select entitlement_id from publication_entitlements
        where investor_org_id = $1 and publication_id = $2`, [hanabi, bondStreet.publicationId]);
    await revokeEntitlement(staff, entitlement[0].entitlement_id);
    const still = await adminQuery<{ is_visible: boolean }>(
      "select is_visible from publication_entitlements where entitlement_id = $1",
      [entitlement[0].entitlement_id]);
    expect(still[0].is_visible).toBe(true);
  });

  it("admin sessions do pass the same paths (control)", async () => {
    const overview = await getAdminOverview(adminSession);
    expect(overview.counts.investorOrganizations).toBeGreaterThan(0);
    expect(overview.counts.publicationsPublished).toBeGreaterThan(0);
    const orgs = await listInvestorOrgSummaries(adminSession);
    expect(orgs.map((o) => o.name)).toContain("Hanabi Ventures");
    // The seeded open draft keeps 58 Queens Gate listed with an open draft.
    const publications = await listPublicationSummaries(adminSession);
    const queensGate = publications.find((p) => p.hasOpenDraft && p.state === "published");
    expect(queensGate).toBeTruthy();
  });
});

describe("Direct SQL under a non-admin session is equally inert", () => {
  it("select/insert/update on portal tables yields nothing", async () => {
    const staff = orgUserSession([meiji]);
    const seen = await withSession(staff, (tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from publication_entitlements"));
    expect(seen.rows[0].n).toBe(0);

    await expect(withSession(staff, (tx) =>
      tx.query("insert into investor_publications(status) values ('draft')"))).rejects.toThrow();

    const touched = await withSession(staff, (tx) =>
      tx.query("update investor_publications set status = 'withdrawn' returning publication_id"));
    expect(touched.rows.length).toBe(0);
  });
});
