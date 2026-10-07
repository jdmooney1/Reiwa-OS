// ============================================================================
// reiwa_staff: the pipeline side of the firm, and nothing investor-facing (migration 0035).
// ----------------------------------------------------------------------------
// Every refusal below is asserted against the DATA LAYER, called directly with a staff
// session: no server action, no page, no component in the way. That is the same adversarial
// shape tests/investor-access.test.ts uses against investor isolation. Each "refused" test
// ends by reading the database on the privileged connection and proving nothing moved,
// because a statement that returns quietly having changed nothing is a refusal too, and one
// that returns quietly having changed something is the bug.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withSession, type Session } from "@/lib/db/client";
import { createOpportunity, updateOpportunity, listOpportunities, getOpportunity } from "@/lib/data/opportunities";
import { createVersion, makeCurrent, listVersions } from "@/lib/data/underwriting";
import { addDdItem, listDdItems } from "@/lib/data/due-diligence";
import { createRisk, listRisks } from "@/lib/data/opportunity-risks";
import { recordDocument, listDocuments } from "@/lib/data/opportunity-documents";
import { createMemoDraft, composeLive, setOverride, getMemo, finalizeMemo } from "@/lib/data/memos";
import { recordReview, listReviews } from "@/lib/data/memo-reviews";
import { recordTranslationDraft, listTranslationDrafts } from "@/lib/data/memo-translation-drafts";
import { acceptTranslatedSection } from "@/lib/data/memo-translation-accept";
import { listOrgs } from "@/lib/data/orgs";
import {
  createPublicationFromOpportunity, submitVersionForReview, publishVersion, supersedeActiveVersion,
  grantEntitlement, revokeEntitlement, createInvestorOrganization, listInvestorOrganizations,
  getPublication, listPublicationVersions, listEntitlements, updateDraftVersion,
} from "@/lib/data/investor-portal";
import { getPublishReview, assertPublishConfirmed } from "@/lib/data/publish-review";
import { adminSession, createStaffSession, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

let meiji: string;
let aoyama: string;
let staff: Session;          // reiwa_staff, a member of Meiji only
let staffNoOrg: Session;     // reiwa_staff with no membership at all
let adminUserId: string;
let opp: string;             // a Meiji opportunity staff created
let publicationId: string;
let liveVersion: string;
let draftVersion: string;
let entitlementId: string;
let investorOrgId: string;

const count = async (sql: string, params: unknown[] = []) =>
  Number((await adminQuery<{ n: string }>(`select count(*)::text as n from (${sql}) t`, params))[0].n);

/** Run a statement as the given session; resolve to its error text, or "ok:<rowCount>". */
async function attempt(s: Session, sql: string, params: unknown[] = []): Promise<string> {
  try {
    const r = await withSession(s, (tx) => tx.query(sql, params) as Promise<{ rows: unknown[]; rowCount?: number }>);
    return `ok:${(r as { rowCount?: number }).rowCount ?? r.rows.length}`;
  } catch (e) { return (e as Error).message; }
}

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  aoyama = await orgIdByName("Aoyama Holdings");
  adminUserId = await profileIdByEmail("admin@reiwa.com");
  staff = await createStaffSession("staff.role@fixture.example", "S. Fixture", [meiji]);
  staffNoOrg = await createStaffSession("staff.noorg@fixture.example", "N. Fixture", []);

  // Fixture for the restricted side: a publication that is LIVE and entitled, set up by an admin.
  opp = await createOpportunity(staff, {
    orgId: meiji, name: "Staff Fixture Row", city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "core", currency: "GBP", targetPrice: 6000000, niy: 6, targetIrr: 12,
  });
  const p = await createPublicationFromOpportunity(adminSession, opp, adminUserId);
  publicationId = p.publicationId; liveVersion = p.versionId;
  await submitVersionForReview(adminSession, liveVersion, adminUserId);
  await publishVersion(adminSession, liveVersion, adminUserId);
  investorOrgId = await createInvestorOrganization(adminSession, { name: "Staff Role Fixture Partners", notes: "tests/staff-role.test.ts" });
  entitlementId = await grantEntitlement(adminSession, {
    investorOrgId, publicationId, isVisible: true, placement: "secondary", documentAccessLevel: "standard",
  }, adminUserId);
  const d = await (await import("@/lib/data/admin-portal")).createDraftFromVersion(
    adminSession, liveVersion, { copyDocuments: false }, adminUserId);
  draftVersion = d.versionId;
});

describe("the role exists, and starts with nobody in it", () => {
  it("the profile constraint accepts reiwa_staff and still refuses an invented role", async () => {
    expect(await count("select 1 from profiles where global_role = 'reiwa_staff' and email = 'staff.role@fixture.example'")).toBe(1);
    await expect(adminQuery(
      "update profiles set global_role = 'reiwa_superstaff' where email = 'staff.role@fixture.example'")).rejects.toThrow(/profiles_global_role_check/);
  });

  it("the seeded accounts are untouched: the admin is still the only reiwa_admin", async () => {
    const roles = await adminQuery<{ global_role: string; n: string }>(
      "select global_role, count(*)::text as n from profiles where email not like '%fixture.example' group by 1 order by 1");
    expect(Object.fromEntries(roles.map((r) => [r.global_role, Number(r.n)]))).toEqual({
      investor_viewer: 1, org_user: 2, reiwa_admin: 1,
    });
  });

  it("app.is_staff() is true for admin and staff, false for everyone else", async () => {
    const ask = async (role: string | null) => {
      const claims = JSON.stringify({ sub: "00000000-0000-0000-0000-000000000000", role: "authenticated", app_metadata: role ? { global_role: role } : {} });
      return (await adminQuery<{ s: boolean; a: boolean }>(
        `select app.is_staff() as s, app.is_admin() as a from (select set_config('request.jwt.claims', $1, true)) c`, [claims]))[0];
    };
    // set_config(..., true) is transaction-local; adminQuery runs each statement on its own, so the
    // single statement above carries its own claims.
    expect(await ask("reiwa_admin")).toEqual({ s: true, a: true });
    expect(await ask("reiwa_staff")).toEqual({ s: true, a: false });
    expect(await ask("org_user")).toEqual({ s: false, a: false });
    expect(await ask("investor_viewer")).toEqual({ s: false, a: false });
    expect(await ask(null)).toEqual({ s: false, a: false });
  });
});

describe("what staff CAN do: no false refusals on the pipeline side", () => {
  let memoId: string;
  it("creates and edits an opportunity in an organisation they belong to", async () => {
    expect((await getOpportunity(staff, opp))!.name).toBe("Staff Fixture Row");
    await updateOpportunity(staff, opp, { name: "Staff Fixture Row (edited)", summary: "internal note", investorOverview: "For investors." });
    const o = (await getOpportunity(staff, opp))!;
    expect(o.name).toBe("Staff Fixture Row (edited)");
    expect(o.investorOverview).toBe("For investors.");
    expect((await listOpportunities(staff)).map((x) => x.opportunityId)).toContain(opp);
  });

  it("underwrites: new versions, make one current", async () => {
    const v1 = await createVersion(staff, opp, { acquisitionPrice: 6100000, changeRationale: "Staff v1." });
    const v2 = await createVersion(staff, opp, { acquisitionPrice: 6200000, changeRationale: "Staff v2." }, { makeCurrent: false });
    await makeCurrent(staff, v2);
    expect((await listVersions(staff, opp)).length).toBeGreaterThanOrEqual(3);
    expect(v1).toBeTruthy();
  });

  it("works diligence, risks and documents", async () => {
    await addDdItem(staff, opp, { section: "Legal", item: "Title report" });
    expect((await listDdItems(staff, opp)).length).toBeGreaterThan(0);
    await createRisk(staff, opp, { title: "Lease break in year 3" });
    expect((await listRisks(staff, opp)).length).toBeGreaterThan(0);
    await recordDocument(staff, opp, { title: "Broker IM", storagePath: "opportunities/x/im.pdf" });
    expect((await listDocuments(staff, opp)).length).toBeGreaterThan(0);
  });

  it("drafts a memo, writes sections, runs the drafting aids, and finalises", async () => {
    const content = (await composeLive(staff, opp))!;
    memoId = await createMemoDraft(staff, opp, content);
    await setOverride(staff, memoId, "executive_summary", "Written by staff.");
    expect((await getMemo(staff, memoId))!.status).toBe("draft");

    // AI review (0030): a staff run records and reads back.
    const review = await recordReview(staff, memoId, "claude-opus-5", [
      { category: "unresolved_gap", label: "A gap", sections: ["key_metrics"], reason: "Something is not recorded." }]);
    expect(review.findings).toHaveLength(1);
    expect(await listReviews(staff, memoId)).toHaveLength(1);

    // Japanese translation (0031): generate, accept a section, read it back.
    const draft = await recordTranslationDraft(staff, memoId, "claude-opus-5-5",
      { executive_summary: { source: "Written by staff.", draft: "スタッフが作成。" } });
    await acceptTranslatedSection(staff, { memoId, draftId: draft.draftId, key: "executive_summary", text: "スタッフが作成。" });
    expect((await listTranslationDrafts(staff, memoId))[0].acceptedSections).toEqual(["executive_summary"]);

    await finalizeMemo(staff, memoId);
    expect((await getMemo(staff, memoId))!.status).toBe("final");
  });

  it("sees the organisations they belong to, and only those", async () => {
    expect((await listOrgs(staff)).map((o) => o.name)).toEqual(["Meiji Shipping"]);
  });
});

describe("restriction 1: publishing and revoking are refused at the data layer", () => {
  const stateOf = async () => ({
    pub: (await adminQuery<{ status: string; active: string }>("select status, active_version_id as active from investor_publications where publication_id = $1", [publicationId]))[0],
    draft: (await adminQuery<{ status: string; headline: string | null }>("select status, headline from publication_versions where version_id = $1", [draftVersion]))[0],
    ent: (await adminQuery<{ is_visible: boolean; document_access_level: string }>("select is_visible, document_access_level from publication_entitlements where entitlement_id = $1", [entitlementId]))[0],
    versions: await count("select 1 from publication_versions where publication_id = $1", [publicationId]),
  });

  it("every publishing and revoking call is refused or has no effect, and nothing moves", async () => {
    const before = await stateOf();
    await expect(submitVersionForReview(staff, draftVersion, staff.userId)).rejects.toThrow();
    await expect(publishVersion(staff, draftVersion, staff.userId)).rejects.toThrow();
    await expect(publishVersion(staff, liveVersion, staff.userId)).rejects.toThrow();
    await supersedeActiveVersion(staff, publicationId); // withdraw: matches no row
    await revokeEntitlement(staff, entitlementId).catch(() => undefined);
    await updateDraftVersion(staff, draftVersion, { headline: "Staff wrote this" });
    await expect(grantEntitlement(staff, {
      investorOrgId, publicationId, isVisible: true, placement: "featured", documentAccessLevel: "diligence",
    }, staff.userId)).rejects.toThrow();
    await expect(createPublicationFromOpportunity(staff, opp, staff.userId)).rejects.toThrow();
    expect(await stateOf()).toEqual(before);
    expect(before.pub.status).toBe("published");
  });

  it("raw statements against the publication tables change nothing", async () => {
    const before = await stateOf();
    for (const sql of [
      "update publication_versions set status = 'published' where status = 'draft'",
      "update investor_publications set status = 'withdrawn', active_version_id = null",
      "update publication_entitlements set is_visible = false, document_access_level = 'diligence'",
      "delete from publication_entitlements",
    ]) expect(await attempt(staff, sql), sql).toMatch(/^ok:0$|permission denied|row-level security/);
    expect(await attempt(staff, "insert into investor_publications(status) values ('published')")).toMatch(/row-level security|permission denied/);
    expect(await stateOf()).toEqual(before);
  });

  it("the review that precedes publishing is not even readable, and the gate refuses", async () => {
    expect(await getPublishReview(staff, draftVersion)).toBeNull();
    await expect(assertPublishConfirmed(staff, draftVersion, { digest: "x", typed: "publish v2 with 0 changes to 1 organisation" }))
      .rejects.toThrow(/could not be found/);
  });

  it("staff cannot touch exchange rates or prospect links either", async () => {
    expect(await attempt(staff, "update fx_rates set rate_to_gbp = rate_to_gbp * 2")).toMatch(/^ok:0$|row-level security|permission denied/);
    expect(await attempt(staff, "insert into fx_rates(currency, rate_to_gbp, source) values ('USD', 1, 'staff')")).toMatch(/row-level security|permission denied/);
    expect(await attempt(staff, "select 1 from deal_shares")).toBe("ok:0");
    expect(await attempt(staff, `insert into deal_shares(opportunity_id, token_hash, prospect_name, prospect_email, expires_at)
      values ($1, 'h', 'x', 'x@x.example', now() + interval '1 day')`, [opp])).toMatch(/row-level security|permission denied|null value|violates/);
  });
});

describe("restriction 2: no session manages users, roles or access", () => {
  it("staff cannot change their own role, or anyone's", async () => {
    for (const sql of [
      "update profiles set global_role = 'reiwa_admin' where user_id = $1",
      "update profiles set global_role = 'reiwa_admin'",
      "insert into profiles(user_id, email, global_role) values (gen_random_uuid(), 'x@x.example', 'reiwa_admin')",
      "delete from profiles",
    ]) expect(await attempt(staff, sql, sql.includes("$1") ? [staff.userId] : []), sql).toMatch(/permission denied/);
    const role = await adminQuery<{ global_role: string }>("select global_role from profiles where user_id = $1", [staff.userId]);
    expect(role[0].global_role).toBe("reiwa_staff");
  });

  it("staff cannot grant themselves, or anyone, membership of an organisation", async () => {
    const before = await count("select 1 from organization_members");
    for (const sql of [
      "insert into organization_members(org_id, user_id, role) values ($1, $2, 'owner')",
      "update organization_members set role = 'owner'",
      "delete from organization_members",
    ]) expect(await attempt(staff, sql, sql.startsWith("insert") ? [aoyama, staff.userId] : []), sql).toMatch(/permission denied/);
    expect(await count("select 1 from organization_members")).toBe(before);
    expect(await count("select 1 from organization_members where org_id = $1 and user_id = $2", [aoyama, staff.userId])).toBe(0);
  });

  it("staff cannot see other users: only their own profile and their own organisation's members", async () => {
    const profiles = await withSession(staff, (tx) => tx.query<{ user_id: string }>("select user_id from profiles"));
    expect(profiles.rows.map((r) => r.user_id)).toEqual([staff.userId]);
    const members = await withSession(staff, (tx) => tx.query<{ org_id: string }>("select org_id from organization_members"));
    expect(new Set(members.rows.map((r) => r.org_id))).toEqual(new Set([meiji]));
  });

  it("staff cannot rename or delete a client organisation, including one they belong to", async () => {
    const before = (await adminQuery<{ name: string }>("select name from organizations where org_id = $1", [meiji]))[0].name;
    expect(await attempt(staff, "update organizations set name = 'renamed by staff' where org_id = $1", [meiji])).toBe("ok:0");
    expect(await attempt(staff, "delete from organizations where org_id = $1", [meiji])).toBe("ok:0");
    expect(await attempt(staff, "insert into organizations(name) values ('Staff Made This Client')")).toMatch(/row-level security/);
    expect((await adminQuery<{ name: string }>("select name from organizations where org_id = $1", [meiji]))[0].name).toBe(before);
    expect(await count("select 1 from organizations where name = 'Staff Made This Client'")).toBe(0);
  });

  it("not even an administrator's session can write them: it is a privileged-connection act", async () => {
    expect(await attempt(adminSession, "update profiles set global_role = 'reiwa_staff' where email = 'admin@reiwa.com'")).toMatch(/permission denied/);
    expect(await attempt(adminSession, "delete from organization_members")).toMatch(/permission denied/);
  });
});

describe("restriction 3: no investor-facing data, and no organisation they are not assigned to", () => {
  const INVESTOR_TABLES = [
    "investor_organizations", "investor_contacts", "investor_invites", "investor_publications",
    "publication_versions", "publication_documents", "publication_entitlements", "publication_sources",
    "publication_version_sources", "investor_saved", "investor_activity_events", "investor_requests",
    "deal_shares", "deal_share_views",
  ];

  it("every investor table is empty to staff although it is not empty to the database", async () => {
    for (const t of INVESTOR_TABLES) {
      expect(await count(`select 1 from ${t}`), `${t} has rows to be hidden`).toBeGreaterThanOrEqual(t.startsWith("deal_share") || t === "investor_saved" || t === "investor_requests" || t === "investor_activity_events" || t === "investor_invites" ? 0 : 1);
      expect(await attempt(staff, `select 1 from ${t}`), t).toBe("ok:0");
    }
    expect(await attempt(staff, "select 1 from investor_feed")).toBe("ok:0");
    expect(await listInvestorOrganizations(staff)).toEqual([]);
    expect(await getPublication(staff, publicationId)).toBeNull();
    expect(await listPublicationVersions(staff, publicationId)).toEqual([]);
    expect(await listEntitlements(staff, investorOrgId)).toEqual([]);
  });

  it("staff cannot create investor organisations either", async () => {
    await expect(createInvestorOrganization(staff, { name: "Staff Made This", notes: "" })).rejects.toThrow();
    expect(await count("select 1 from investor_organizations where name = 'Staff Made This'")).toBe(0);
  });

  it("an organisation they are not a member of does not exist to them, and cannot be written to", async () => {
    const aoyamaOpp = (await adminQuery<{ opportunity_id: string }>("select opportunity_id from opportunities where org_id = $1 limit 1", [aoyama]))[0]?.opportunity_id;
    const aoyamaAsset = await count("select 1 from assets where org_id = $1", [aoyama]);
    expect(aoyamaAsset).toBeGreaterThan(0);
    expect(await attempt(staff, "select 1 from assets where org_id = $1", [aoyama])).toBe("ok:0");
    expect(await attempt(staff, "select 1 from organizations where org_id = $1", [aoyama])).toBe("ok:0");
    expect((await listOpportunities(staff)).every((o) => o.orgId === meiji)).toBe(true);
    if (aoyamaOpp) expect(await getOpportunity(staff, aoyamaOpp)).toBeNull();
    await expect(createOpportunity(staff, {
      orgId: aoyama, name: "Staff Into Aoyama", city: "Tokyo", country: "Japan", market: "Tokyo",
      assetType: "office", strategy: "core", currency: "JPY",
    })).rejects.toThrow();
    expect(await count("select 1 from opportunities where name = 'Staff Into Aoyama'")).toBe(0);
  });

  it("a staff user with no assignment sees no deal data at all", async () => {
    expect(await listOpportunities(staffNoOrg)).toEqual([]);
    expect(await listOrgs(staffNoOrg)).toEqual([]);
    expect(await attempt(staffNoOrg, "select 1 from memos")).toBe("ok:0");
  });

  it("the drafting aids reach only memos staff can already see", async () => {
    const aoyamaMemo = (await adminQuery<{ memo_id: string }>("select memo_id from memos where org_id = $1 limit 1", [aoyama]))[0]?.memo_id;
    const meijiMemo = (await adminQuery<{ memo_id: string }>("select memo_id from memos where org_id = $1 limit 1", [meiji]))[0]?.memo_id;
    // Write a review row on a memo staff cannot see: refused.
    const anyMemo = aoyamaMemo ?? (await adminQuery<{ memo_id: string }>(
      "select memo_id from memos where org_id <> $1 limit 1", [meiji]))[0]?.memo_id;
    if (anyMemo) {
      await expect(recordReview(staff, anyMemo, "claude-opus-5", [])).rejects.toThrow();
      expect(await listReviews(staff, anyMemo)).toEqual([]);
    }
    // And the same table is closed to a non-staff, non-admin member of the same organisation.
    if (meijiMemo) await expect(recordReview(orgUserSession([meiji]), meijiMemo, "claude-opus-5", [])).rejects.toThrow();
  });
});

describe("control: the same calls succeed for an administrator, so the refusals above are the role", () => {
  it("an admin submits and publishes the very draft staff could not", async () => {
    await submitVersionForReview(adminSession, draftVersion, adminUserId);
    await publishVersion(adminSession, draftVersion, adminUserId);
    const pub = (await adminQuery<{ active: string }>("select active_version_id as active from investor_publications where publication_id = $1", [publicationId]))[0];
    expect(pub.active).toBe(draftVersion);
    await revokeEntitlement(adminSession, entitlementId);
    expect((await adminQuery<{ is_visible: boolean }>("select is_visible from publication_entitlements where entitlement_id = $1", [entitlementId]))[0].is_visible).toBe(false);
  });
});
