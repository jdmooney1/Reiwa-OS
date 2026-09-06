// ============================================================================
// P5 — investor engagement & commercial intelligence, against the real database.
// ----------------------------------------------------------------------------
// Two halves, and the boundary between them is the point:
//
//   the investor writes  — their own events, for themselves, append-only;
//   Reiwa reads          — the whole record, but only from an admin session.
//
// Neither can do the other's job. An investor cannot forge, read across, amend
// or erase; an investor session reading the intelligence layer gets nothing at
// all, and neither does an ordinary internal org user.
//
// Self-contained fixture; nothing seeded is touched, so P0-P4 stay valid.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withInvestorSession, withSession, type Session } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import { createOpportunity } from "@/lib/data/opportunities";
import {
  createInvestorOrganization, createInvestorContact, updateInvestorContact,
  updateInvestorOrganization, createPublicationFromOpportunity, updateDraftVersion,
  publishVersion, grantEntitlement, setInvestorRequestStatus,
} from "@/lib/data/investor-portal";
import {
  saveOpportunity, unsaveOpportunity, submitRequest, recordPortalEvent, loadComparison,
} from "@/lib/data/portal-feed";
import {
  listActivity, getOrgActivity, getPublicationActivity, listRequests,
  getActivitySignals, getActivityFilterOptions,
} from "@/lib/data/admin-activity";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

const ALPHA = "alpha@p5-fixture.example";   // P5 Signal Partners
const BETA = "beta@p5-fixture.example";     // P5 Signal Partners, same org
const OTHER = "other@p5-fixture.example";   // P5 Quiet House, a different org

let staff: Session;
let adminUserId: string;

let orgId: string;
let otherOrgId: string;
let alphaUid: string, betaUid: string, otherUid: string;
let alphaContactId: string, betaContactId: string, otherContactId: string;
let pubOne: string, pubTwo: string;
let pubOneVersion: string;
let requestId: string;

async function publish(name: string): Promise<{ publicationId: string; versionId: string }> {
  const opportunityId = await createOpportunity(staff, {
    orgId: await orgIdByName("Meiji Shipping"),
    name, city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "core", currency: "GBP",
    targetPrice: 30_000_000, niy: 4.25, targetIrr: 10.5,
    summary: `${name} — internal summary.`,
  });
  const created = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
  await updateDraftVersion(adminSession, created.versionId, { headline: `${name} headline` });
  await publishVersion(adminSession, created.versionId, adminUserId);
  return { publicationId: created.publicationId, versionId: created.versionId };
}

beforeAll(async () => {
  staff = orgUserSession([await orgIdByName("Meiji Shipping")]);
  adminUserId = await profileIdByEmail("admin@reiwa.com");

  const supabase = createSupabaseAdminClient();
  alphaUid = await ensureAuthUser(supabase, { email: ALPHA, password: DEMO_PASSWORD, name: "A. Signal" });
  betaUid = await ensureAuthUser(supabase, { email: BETA, password: DEMO_PASSWORD, name: "B. Signal" });
  otherUid = await ensureAuthUser(supabase, { email: OTHER, password: DEMO_PASSWORD, name: "O. Quiet" });

  orgId = await createInvestorOrganization(adminSession, {
    name: "P5 Signal Partners", notes: "Created by tests/activity-intelligence.test.ts.",
  });
  otherOrgId = await createInvestorOrganization(adminSession, {
    name: "P5 Quiet House", notes: "Created by tests/activity-intelligence.test.ts.",
  });

  alphaContactId = await createInvestorContact(adminSession, {
    investorOrgId: orgId, email: ALPHA, name: "A. Signal", title: "Principal", authUserId: alphaUid,
  });
  betaContactId = await createInvestorContact(adminSession, {
    investorOrgId: orgId, email: BETA, name: "B. Signal", authUserId: betaUid,
  });
  otherContactId = await createInvestorContact(adminSession, {
    investorOrgId: otherOrgId, email: OTHER, name: "O. Quiet", authUserId: otherUid,
  });

  const one = await publish("P5 Signal Tower");
  pubOne = one.publicationId;
  pubOneVersion = one.versionId;
  pubTwo = (await publish("P5 Signal Wharf")).publicationId;

  for (const publicationId of [pubOne, pubTwo]) {
    await grantEntitlement(adminSession, {
      investorOrgId: orgId, publicationId, isVisible: true,
      placement: publicationId === pubOne ? "featured" : "secondary",
      sortOrder: 0, documentAccessLevel: "standard",
    }, adminUserId);
  }
  // The other organisation is entitled to nothing, and does nothing.

  // ---- The activity the rest of the suite reads ---------------------------
  await recordPortalEvent(alphaUid, "login");
  await recordPortalEvent(alphaUid, "opportunity_viewed",
    { publicationId: pubOne, versionId: pubOneVersion });
  await recordPortalEvent(alphaUid, "opportunity_viewed",
    { publicationId: pubOne, versionId: pubOneVersion });
  await recordPortalEvent(alphaUid, "opportunity_viewed", { publicationId: pubTwo });
  await saveOpportunity(alphaUid, pubOne);
  await recordPortalEvent(alphaUid, "saved", { publicationId: pubOne });
  await unsaveOpportunity(alphaUid, pubOne);
  await recordPortalEvent(alphaUid, "unsaved", { publicationId: pubOne });
  await loadComparison(alphaUid, [pubOne, pubTwo]);
  await recordPortalEvent(alphaUid, "compared",
    { context: { publication_ids: [pubOne, pubTwo] } });

  requestId = (await submitRequest(alphaUid, pubOne, "diligence_access", "Please release diligence."))!;
  await recordPortalEvent(alphaUid, "information_requested",
    { publicationId: pubOne, versionId: pubOneVersion, context: { request_type: "diligence_access" } });

  // Beta signs in but does nothing else — so "by contact" has something to say.
  await recordPortalEvent(betaUid, "login");
});

// ============================================================================
// 1, 2, 4, 9, 10 — what an investor may write
// ============================================================================
describe("Investor-written activity", () => {
  it("records an allowed event for the acting contact, bound to their organisation", async () => {
    await recordPortalEvent(alphaUid, "opportunity_viewed", { publicationId: pubTwo });
    const rows = await adminQuery<{ investor_contact_id: string; investor_org_id: string }>(
      `select investor_contact_id, investor_org_id from investor_activity_events
        where investor_contact_id = $1 order by occurred_at desc limit 1`, [alphaContactId]);
    expect(rows[0].investor_contact_id).toBe(alphaContactId);
    expect(rows[0].investor_org_id).toBe(orgId);
  });

  it("cannot forge an event for another contact, or another organisation", async () => {
    // Naming a colleague's contact id...
    await expect(withInvestorSession(alphaUid, (tx) =>
      tx.query(`insert into investor_activity_events(investor_contact_id, investor_org_id, event_type)
                values ($1, $2, 'opportunity_viewed')`, [betaContactId, orgId]))).rejects.toThrow();

    // ...and another organisation's contact entirely.
    await expect(withInvestorSession(alphaUid, (tx) =>
      tx.query(`insert into investor_activity_events(investor_contact_id, investor_org_id, event_type)
                values ($1, $2, 'login')`, [otherContactId, otherOrgId]))).rejects.toThrow();

    // ...and their own contact against someone else's organisation.
    await expect(withInvestorSession(alphaUid, (tx) =>
      tx.query(`insert into investor_activity_events(investor_contact_id, investor_org_id, event_type)
                values ($1, $2, 'login')`, [alphaContactId, otherOrgId]))).rejects.toThrow();

    const forged = await adminQuery<{ n: string }>(
      `select count(*)::text as n from investor_activity_events
        where investor_contact_id = $1`, [otherContactId]);
    expect(Number(forged[0].n)).toBe(0);
  });

  it("is append-only: an investor can neither amend nor erase the record", async () => {
    const before = await adminQuery<{ event_id: string; event_type: string }>(
      `select event_id, event_type from investor_activity_events
        where investor_contact_id = $1 order by occurred_at limit 1`, [alphaContactId]);
    const target = before[0];

    // No update or delete policy exists for investors, so both change nothing.
    const updated = await withInvestorSession(alphaUid, (tx) =>
      tx.query("update investor_activity_events set event_type = 'login' where event_id = $1 returning event_id",
        [target.event_id]));
    expect(updated.rows).toEqual([]);

    const deleted = await withInvestorSession(alphaUid, (tx) =>
      tx.query("delete from investor_activity_events where event_id = $1 returning event_id",
        [target.event_id]));
    expect(deleted.rows).toEqual([]);

    const after = await adminQuery<{ event_type: string }>(
      "select event_type from investor_activity_events where event_id = $1", [target.event_id]);
    expect(after[0].event_type).toBe(target.event_type);
  });

  it("stops recording once the contact is deactivated", async () => {
    const before = await countFor(alphaContactId);
    await updateInvestorContact(adminSession, alphaContactId, { isActive: false });
    try {
      // recordPortalEvent never throws; the row simply is not written, because
      // app.current_investor_contact_id() resolves to null for them now.
      await recordPortalEvent(alphaUid, "opportunity_viewed", { publicationId: pubOne });
      expect(await countFor(alphaContactId)).toBe(before);
    } finally {
      await updateInvestorContact(adminSession, alphaContactId, { isActive: true });
    }
    await recordPortalEvent(alphaUid, "opportunity_viewed", { publicationId: pubOne });
    expect(await countFor(alphaContactId)).toBe(before + 1);
  });

  it("stops recording once the organisation is suspended", async () => {
    const before = await countFor(alphaContactId);
    await updateInvestorOrganization(adminSession, orgId, { status: "suspended" });
    try {
      await recordPortalEvent(alphaUid, "login");
      expect(await countFor(alphaContactId)).toBe(before);
    } finally {
      await updateInvestorOrganization(adminSession, orgId, { status: "active" });
    }
  });
});

async function countFor(contactId: string): Promise<number> {
  const rows = await adminQuery<{ n: string }>(
    "select count(*)::text as n from investor_activity_events where investor_contact_id = $1",
    [contactId]);
  return Number(rows[0].n);
}

// ============================================================================
// 3 — the intelligence layer is internal only
// ============================================================================
describe("The intelligence layer is internal", () => {
  it("an investor reads no organisation-wide log, and no colleague's events", async () => {
    // Their own events, and only their own.
    const own = await withInvestorSession(alphaUid, (tx) =>
      tx.query<{ investor_contact_id: string }>(
        "select investor_contact_id from investor_activity_events"));
    expect(own.rows.length).toBeGreaterThan(0);
    expect(own.rows.every((r) => r.investor_contact_id === alphaContactId)).toBe(true);

    // Beta's login is invisible to Alpha, though they share an organisation.
    const colleague = await withInvestorSession(alphaUid, (tx) =>
      tx.query("select event_id from investor_activity_events where investor_contact_id = $1",
        [betaContactId]));
    expect(colleague.rows).toEqual([]);
  });

  it("an investor driving the admin layer still only ever reaches their own rows", async () => {
    // /admin is closed to them by requireAdminAuth, but the guarantee that
    // matters is the one underneath: even calling the intelligence functions
    // with their own session, RLS narrows every query to their own events. They
    // gain no organisation-wide view — only the rows they could already read.
    const asInvestor: Session = {
      userId: alphaUid, orgIds: [], role: "investor_viewer", canWrite: false,
    };

    const feed = await listActivity(asInvestor);
    expect(feed.rows.every((r) => r.investorContactId === alphaContactId)).toBe(true);
    expect(feed.rows.some((r) => r.investorContactId === betaContactId)).toBe(false);
    expect(feed.rows.some((r) => r.investorOrgId === otherOrgId)).toBe(false);

    // Asking for a colleague's or another organisation's activity by id
    // returns nothing, not a filtered-down version of it.
    expect((await listActivity(asInvestor, { investorContactId: betaContactId })).rows).toEqual([]);
    expect((await listActivity(asInvestor, { investorOrgId: otherOrgId })).rows).toEqual([]);

    // The organisation summary collapses to just them: their colleague's
    // sign-in is absent from the counts and from the per-contact breakdown.
    const asAdmin = await getOrgActivity(adminSession, orgId);
    const asThem = await getOrgActivity(asInvestor, orgId);
    expect(asThem.counts.login).toBeLessThan(asAdmin.counts.login);
    expect(asThem.contacts.map((c) => c.investorContactId)).toEqual([alphaContactId]);
    expect(asThem.recent.every((r) => r.investorContactId === alphaContactId)).toBe(true);

    // Requests: their own only, never a colleague's or another organisation's.
    const requests = await listRequests(asInvestor);
    expect(requests.every((r) => r.investorContactId === alphaContactId)).toBe(true);
    expect(await listRequests(asInvestor, { investorOrgId: otherOrgId })).toEqual([]);

    // A publication's cross-investor aggregate shows them only themselves.
    const pub = await getPublicationActivity(asInvestor, pubOne);
    expect(pub.byOrganisation.every((o) => o.investorOrgId === orgId)).toBe(true);
    expect(pub.recent.every((r) => r.investorContactId === alphaContactId)).toBe(true);
  });

  it("an ordinary internal org user reads nothing either", async () => {
    const feed = await listActivity(staff);
    expect(feed.rows).toEqual([]);
    expect(feed.total).toBe(0);
    expect(await listRequests(staff)).toEqual([]);
    expect((await getPublicationActivity(staff, pubOne)).recent).toEqual([]);
  });
});

// ============================================================================
// 5, 6, 7, 8, 11 — the admin record is accurate
// ============================================================================
describe("The admin activity record", () => {
  it("records an opportunity view against the right publication and contact", async () => {
    const { rows } = await listActivity(adminSession, {
      investorContactId: alphaContactId, eventTypes: ["opportunity_viewed"], publicationId: pubOne,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.eventType).toBe("opportunity_viewed");
      expect(r.publicationId).toBe(pubOne);
      expect(r.investorContactId).toBe(alphaContactId);
      expect(r.investorOrgId).toBe(orgId);
      expect(r.investorOrgName).toBe("P5 Signal Partners");
      expect(r.publicationTitle).toBe("P5 Signal Tower");
    }
  });

  it("distinguishes a save from an unsave", async () => {
    const saved = await listActivity(adminSession, { investorContactId: alphaContactId, eventTypes: ["saved"] });
    const unsaved = await listActivity(adminSession, { investorContactId: alphaContactId, eventTypes: ["unsaved"] });
    expect(saved.total).toBeGreaterThan(0);
    expect(unsaved.total).toBeGreaterThan(0);
    expect(saved.rows.every((r) => r.publicationId === pubOne)).toBe(true);
    expect(unsaved.rows.every((r) => r.publicationId === pubOne)).toBe(true);
  });

  it("records a comparison with the number of opportunities it actually held", async () => {
    const { rows } = await listActivity(adminSession, {
      investorContactId: alphaContactId, eventTypes: ["compared"],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].comparedCount).toBe(2);
  });

  it("records the information request against the right opportunity", async () => {
    const { rows } = await listActivity(adminSession, {
      investorContactId: alphaContactId, eventTypes: ["information_requested"],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].publicationId).toBe(pubOne);
    expect(rows[0].contactEmail).toBe(ALPHA);
  });

  it("filters by organisation, contact, publication, type and date", async () => {
    const byOrg = await listActivity(adminSession, { investorOrgId: orgId });
    expect(byOrg.rows.every((r) => r.investorOrgId === orgId)).toBe(true);
    expect(byOrg.rows.some((r) => r.investorContactId === betaContactId)).toBe(true);

    const byContact = await listActivity(adminSession, { investorContactId: betaContactId });
    expect(byContact.rows.every((r) => r.investorContactId === betaContactId)).toBe(true);
    expect(byContact.rows.every((r) => r.eventType === "login")).toBe(true);

    const byPublication = await listActivity(adminSession, { publicationId: pubTwo });
    expect(byPublication.rows.every((r) => r.publicationId === pubTwo)).toBe(true);

    // The quiet organisation has done nothing at all.
    const quiet = await listActivity(adminSession, { investorOrgId: otherOrgId });
    expect(quiet.rows).toEqual([]);
    expect(quiet.total).toBe(0);

    // A window that ended before the fixture ran contains none of it.
    const past = await listActivity(adminSession, { investorOrgId: orgId, to: "2020-01-01" });
    expect(past.total).toBe(0);

    // Paging reports the full total, not the page size.
    const paged = await listActivity(adminSession, { investorOrgId: orgId, limit: 2 });
    expect(paged.rows.length).toBeLessThanOrEqual(2);
    expect(paged.total).toBe(byOrg.total);

    const options = await getActivityFilterOptions(adminSession);
    expect(options.organisations.some((o) => o.investorOrgId === orgId)).toBe(true);
    expect(options.contacts.some((c) => c.investorContactId === alphaContactId)).toBe(true);
    expect(options.publications.some((p) => p.publicationId === pubOne)).toBe(true);
  });
});

// ============================================================================
// 12, 13 — the aggregations
// ============================================================================
describe("Aggregations", () => {
  it("summarises one investor organisation from its recorded events alone", async () => {
    const summary = await getOrgActivity(adminSession, orgId);
    expect(summary.lastLoginAt).not.toBeNull();
    expect(summary.lastActivityAt).not.toBeNull();
    expect(summary.counts.login).toBeGreaterThanOrEqual(2);   // alpha + beta
    expect(summary.counts.opportunity_viewed).toBeGreaterThan(0);
    expect(summary.counts.compared).toBeGreaterThan(0);
    expect(summary.counts.information_requested).toBeGreaterThan(0);

    // Both opportunities were opened, and the counts are real.
    const titles = summary.opportunitiesViewed.map((o) => o.title).sort();
    expect(titles).toEqual(["P5 Signal Tower", "P5 Signal Wharf"]);
    const tower = summary.opportunitiesViewed.find((o) => o.publicationId === pubOne)!;
    expect(tower.views).toBeGreaterThanOrEqual(2);

    // Per contact, including the colleague who only signed in.
    const beta = summary.contacts.find((c) => c.investorContactId === betaContactId)!;
    expect(beta.lastLoginAt).not.toBeNull();
    expect(beta.events).toBe(1);
    const alpha = summary.contacts.find((c) => c.investorContactId === alphaContactId)!;
    expect(alpha.events).toBeGreaterThan(beta.events);

    // Nothing derived is present anywhere in the summary.
    const keys = JSON.stringify(summary);
    expect(/score|ranking|suitab|duration|dwell|intent/i.test(keys)).toBe(false);

    // A quiet organisation summarises to nothing, not to zeroed-out inference.
    const quiet = await getOrgActivity(adminSession, otherOrgId);
    expect(quiet.lastLoginAt).toBeNull();
    expect(quiet.recent).toEqual([]);
    expect(quiet.opportunitiesViewed).toEqual([]);
  });

  it("aggregates a publication from only the activity actually recorded", async () => {
    const activity = await getPublicationActivity(adminSession, pubOne);
    expect(activity.totals.opportunity_viewed).toBeGreaterThan(0);
    expect(activity.totals.saved).toBeGreaterThan(0);
    expect(activity.totals.information_requested).toBeGreaterThan(0);

    // Exactly one organisation has touched it — the quiet one is absent.
    expect(activity.byOrganisation.map((o) => o.name)).toEqual(["P5 Signal Partners"]);
    const row = activity.byOrganisation[0];
    expect(row.views).toBeGreaterThanOrEqual(2);
    expect(row.saves).toBe(1);
    expect(row.requests).toBe(1);
    expect(row.investorOrgId).toBe(orgId);

    // Every event listed genuinely belongs to this publication.
    expect(activity.recent.every((r) => r.publicationId === pubOne)).toBe(true);

    // The comparison event carries no publication_id, so it is not attributed
    // to either opportunity — recorded facts only.
    expect(activity.recent.some((r) => r.eventType === "compared")).toBe(false);
  });

  it("reports operational signals as counts and timestamps only", async () => {
    const signals = await getActivitySignals(adminSession);
    expect(signals.openRequests).toBeGreaterThan(0);
    expect(signals.activeOrganisations.some((o) => o.investorOrgId === orgId)).toBe(true);
    expect(signals.activePublications.some((p) => p.publicationId === pubOne)).toBe(true);
    // The quiet organisation is not "0% engaged" — it is simply not there.
    expect(signals.activeOrganisations.some((o) => o.investorOrgId === otherOrgId)).toBe(false);
  });
});

// ============================================================================
// 14, 15 — requests and follow-up
// ============================================================================
describe("Requests and follow-up", () => {
  it("surfaces open requests with the organisation, contact and opportunity resolved", async () => {
    const open = await listRequests(adminSession, { openOnly: true });
    const mine = open.find((r) => r.requestId === requestId)!;
    expect(mine).toBeTruthy();
    expect(mine.status).toBe("new");
    expect(mine.requestType).toBe("diligence_access");
    expect(mine.investorOrgName).toBe("P5 Signal Partners");
    expect(mine.contactEmail).toBe(ALPHA);
    expect(mine.publicationTitle).toBe("P5 Signal Tower");
    expect(mine.message).toBe("Please release diligence.");

    // Scoped lookups agree with the unscoped one.
    expect((await listRequests(adminSession, { investorOrgId: orgId }))
      .some((r) => r.requestId === requestId)).toBe(true);
    expect((await listRequests(adminSession, { publicationId: pubOne }))
      .some((r) => r.requestId === requestId)).toBe(true);
    expect(await listRequests(adminSession, { investorOrgId: otherOrgId })).toEqual([]);
  });

  it("persists a status change, and keeps triage out of investor hands", async () => {
    await setInvestorRequestStatus(adminSession, requestId, "in_progress", adminUserId);

    const after = (await listRequests(adminSession)).find((r) => r.requestId === requestId)!;
    expect(after.status).toBe("in_progress");
    const handled = await adminQuery<{ handled_by: string | null }>(
      "select handled_by from investor_requests where request_id = $1", [requestId]);
    expect(handled[0].handled_by).toBe(adminUserId);

    // Still open, so it stays on the follow-up list.
    expect((await listRequests(adminSession, { openOnly: true }))
      .some((r) => r.requestId === requestId)).toBe(true);

    // The investor who submitted it cannot re-open, re-classify or close it:
    // there is no update policy for them on investor_requests.
    const attempt = await withInvestorSession(alphaUid, (tx) =>
      tx.query("update investor_requests set status = 'closed' where request_id = $1 returning request_id",
        [requestId]));
    expect(attempt.rows).toEqual([]);
    const unchanged = await adminQuery<{ status: string }>(
      "select status from investor_requests where request_id = $1", [requestId]);
    expect(unchanged[0].status).toBe("in_progress");

    // Closing removes it from the open list, and leaves the record intact.
    await setInvestorRequestStatus(adminSession, requestId, "closed", adminUserId);
    expect((await listRequests(adminSession, { openOnly: true }))
      .some((r) => r.requestId === requestId)).toBe(false);
    expect((await listRequests(adminSession)).some((r) => r.requestId === requestId)).toBe(true);
  });

  it("an ordinary internal org user cannot triage a request", async () => {
    await setInvestorRequestStatus(staff, requestId, "new", adminUserId);
    const still = await adminQuery<{ status: string }>(
      "select status from investor_requests where request_id = $1", [requestId]);
    expect(still[0].status).toBe("closed"); // the update matched no row
  });
});

// ============================================================================
// The record itself is never mutated by the application
// ============================================================================
describe("The activity record is an audit trail", () => {
  it("no application code path updates or deletes an activity event", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const src = readFileSync(full, "utf8");
        // Strip comments so prose about the rule does not trip it.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        if (/(update|delete\s+from)\s+investor_activity_events/i.test(code)) {
          offenders.push(full);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });

  it("records no device, browser or network fingerprint", async () => {
    const contexts = await adminQuery<{ context: Record<string, unknown> }>(
      "select context from investor_activity_events");
    expect(contexts.length).toBeGreaterThan(0);
    for (const row of contexts) {
      for (const key of Object.keys(row.context ?? {})) {
        expect({ key, sensitive: /ip|agent|browser|device|fingerprint|referer|session_id/i.test(key) })
          .toEqual({ key, sensitive: false });
      }
    }
    // ...and there is no column for one either.
    const columns = await adminQuery<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'investor_activity_events'`);
    const names = columns.map((c) => c.column_name);
    for (const banned of ["ip_address", "user_agent", "device_id", "fingerprint", "duration_seconds", "score"]) {
      expect({ banned, present: names.includes(banned) }).toEqual({ banned, present: false });
    }
  });
});
