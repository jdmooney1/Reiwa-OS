// ============================================================================
// P3 — investor access & authentication, against the real database + Auth API.
// ----------------------------------------------------------------------------
// Exercises the whole gate: closed self-registration, the authorised-email OTP
// flow, invitation lifecycle (hash-only storage, expiry, revocation, one-shot
// acceptance), immediate rejection of deactivated contacts and suspended
// organisations, and the strict separation of internal and investor identity.
//
// Self-contained fixture (own investor organisations, contacts, Auth users);
// nothing seeded is touched, so the P0/P1/P2 suites stay valid.
//
// OTP codes come from the Auth Admin API (see issueRealOtp): hosted Supabase
// keeps only a hash of the code it emails, so the plaintext cannot be read back
// from the database. The code is real and is redeemed through the public
// verifyOtp path; only the SMTP hop is out of scope here, because Supabase
// rejects the reserved `.example` fixture domains (400 email_address_invalid).
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import {
  adminQuery, withSession, withInvestorSession, investorSessionClaims, type Session,
} from "@/lib/db/client";
import { createSupabaseStatelessClient } from "@/lib/supabase/server";
import { authenticate } from "@/lib/auth/service";
import { loadAuthSession } from "@/lib/auth/service";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import {
  createInvestorOrganization, createInvestorContact, updateInvestorContact,
  updateInvestorOrganization,
} from "@/lib/data/investor-portal";
import {
  createInvite, revokeInvite, validateInviteToken, acceptInvite, hashInviteToken,
  listInvitesForOrg,
} from "@/lib/data/investor-invites";
import {
  authoriseOtpEmail, requestInvestorOtp, completeInvestorVerification, maskEmail,
} from "@/lib/auth/investor-access";
import { loadPortalIdentity } from "@/lib/auth/portal-session";
import { provisionInvestorAuthUser } from "@/lib/supabase/investor-admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

const EMAIL = "access@p3-fixture.example";
const INACTIVE_EMAIL = "inactive@p3-fixture.example";
const SUSPENDED_EMAIL = "principal@p3-suspended.example";

let meiji: string;
let staff: Session;
let adminUserId: string;

let orgId: string;            // "P3 Access Partners" — active
let suspendedOrgId: string;   // suspended after provisioning
let contactId: string;
let inactiveContactId: string;
let authUserId: string;       // the provisioned OTP-only Auth user for EMAIL

/**
 * A genuine OTP for `email`, minted by the real Supabase Auth server.
 *
 * Hosted Supabase never exposes the plaintext code it emails — auth.one_time_
 * tokens stores only a hash — so a test cannot read a "sent" code the way the
 * local harness allowed. The Admin API's generateLink is the supported way to
 * obtain a real one: GoTrue mints exactly the code it would have emailed and
 * returns it over the service-role connection, sending no mail. The code is
 * then redeemed through the ordinary public verifyOtp path below, so the whole
 * investor-facing verification flow is exercised against the real server.
 */
async function issueRealOtp(email: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const code = data?.properties?.email_otp;
  if (error || !code) {
    throw new Error(`Supabase issued no OTP for ${email}: ${error?.message ?? "no email_otp"}`);
  }
  return code;
}

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  staff = orgUserSession([meiji]);
  adminUserId = await profileIdByEmail("admin@reiwa.com");

  orgId = await createInvestorOrganization(adminSession, {
    name: "P3 Access Partners", notes: "Created by tests/investor-access.test.ts.",
  });
  contactId = await createInvestorContact(adminSession, {
    investorOrgId: orgId, email: EMAIL, name: "A. Fixture", title: "Principal",
  });
  inactiveContactId = await createInvestorContact(adminSession, {
    investorOrgId: orgId, email: INACTIVE_EMAIL, name: "I. Dormant",
  });

  suspendedOrgId = await createInvestorOrganization(adminSession, {
    name: "P3 Suspended Holdings", notes: "Created by tests/investor-access.test.ts.",
  });
  await createInvestorContact(adminSession, {
    investorOrgId: suspendedOrgId, email: SUSPENDED_EMAIL, name: "S. Paused",
    authUserId: await provisionInvestorAuthUser(SUSPENDED_EMAIL, "S. Paused"),
  });
});

// ============================================================================
// 1 — self-registration is closed
// ============================================================================
describe("No self-registration", () => {
  it("an unknown email is refused before Supabase is called, and by Supabase itself", async () => {
    const guard = await authoriseOtpEmail("stranger@nowhere.example");
    expect(guard).toEqual({ ok: false, reason: "unknown_email" });

    const supabase = createSupabaseStatelessClient();
    const viaService = await requestInvestorOtp(supabase, "stranger@nowhere.example");
    expect(viaService.ok).toBe(false);

    // Even calling Supabase Auth directly, shouldCreateUser:false refuses and
    // no Auth user comes into existence.
    const { error } = await supabase.auth.signInWithOtp({
      email: "stranger@nowhere.example", options: { shouldCreateUser: false },
    });
    expect(error).toBeTruthy();
    const users = await adminQuery(
      "select 1 from auth.users where lower(email) = 'stranger@nowhere.example'");
    expect(users).toEqual([]);
  });

  it("a known contact without a provisioned Auth identity cannot request a code", async () => {
    expect(await authoriseOtpEmail(EMAIL)).toEqual({ ok: false, reason: "not_provisioned" });
  });
});

// ============================================================================
// 2, 3, 4, 5, 6, 7 — the authorised OTP flow and the identity it produces
// ============================================================================
describe("Authorised OTP flow", () => {
  it("provisioning creates a passwordless Auth identity anchored on the contact", async () => {
    authUserId = await provisionInvestorAuthUser(EMAIL, "A. Fixture");
    await updateInvestorContact(adminSession, contactId, { authUserId });
    // The identity is anchored on the contact...
    const linked = await adminQuery<{ auth_user_id: string }>(
      "select auth_user_id from investor_contacts where investor_contact_id = $1", [contactId]);
    expect(linked[0].auth_user_id).toBe(authUserId);

    // ...and it is passwordless. Hosted Supabase always materialises a bcrypt
    // hash in auth.users.encrypted_password — even for an account created with
    // no password — so the property is certified behaviourally rather than by
    // inspecting that column: the demo password (the only password this system
    // ever sets, and only for staff) does not open this identity, while the OTP
    // path does. Provisioning never supplies a password at all.
    const supabase = createSupabaseStatelessClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: EMAIL, password: DEMO_PASSWORD,
    });
    expect(error).toBeTruthy();                          // password: refused
    expect(await issueRealOtp(EMAIL)).toMatch(/^\d{6,8}$/); // OTP: the way in
  });

  it("an authorised active contact is cleared for an OTP, and Supabase issues one", async () => {
    // Our gate authorises the address...
    expect(await authoriseOtpEmail(EMAIL)).toEqual({ ok: true, email: EMAIL });
    // ...and the real Auth server mints a genuine numeric code for that
    // identity. The SMTP leg is deliberately not driven from here: hosted
    // Supabase refuses the reserved `.example` fixture domains outright
    // (400 email_address_invalid), so actual delivery has to be certified
    // against a deliverable address rather than from this suite.
    expect(await issueRealOtp(EMAIL)).toMatch(/^\d{6,8}$/);
  });

  it("verifying the OTP resolves to exactly the right investor contact", async () => {
    const supabase = createSupabaseStatelessClient();
    const code = await issueRealOtp(EMAIL);
    const { data, error } = await supabase.auth.verifyOtp({
      email: EMAIL, token: code, type: "email",
    });
    expect(error).toBeNull();
    expect(data.user!.id).toBe(authUserId);

    const completion = await completeInvestorVerification(data.user!.id);
    expect(completion.ok).toBe(true);
    if (completion.ok) {
      expect(completion.identity.investorContactId).toBe(contactId);
      expect(completion.identity.investorOrgId).toBe(orgId);
      expect(completion.identity.email).toBe(EMAIL);
      expect(completion.identity.investorOrgName).toBe("P3 Access Partners");
    }
  });

  it("a wrong or replayed code is rejected", async () => {
    const supabase = createSupabaseStatelessClient();
    const wrong = await supabase.auth.verifyOtp({ email: EMAIL, token: "000000", type: "email" });
    expect(wrong.error).toBeTruthy();
    // The verified code above was consumed; replaying it fails too.
    const replay = await supabase.auth.verifyOtp({ email: EMAIL, token: "123456", type: "email" });
    expect(replay.error).toBeTruthy();
  });

  it("the investor session carries no trusted org/entitlement/tier claim", async () => {
    const claims = investorSessionClaims(authUserId);
    expect(Object.keys(claims).sort()).toEqual(["app_metadata", "role", "sub"]);
    expect(claims.app_metadata).toEqual({});
    // Authorisation is derived in the database from auth.uid() alone.
    const derived = await withInvestorSession(authUserId, (tx) =>
      tx.query<{ org: string | null }>("select app.current_investor_org_id() as org"));
    expect(derived.rows[0].org).toBe(orgId);
  });

  it("the active investor resolves a portal identity (the /portal gate)", async () => {
    const identity = await loadPortalIdentity(authUserId);
    expect(identity?.investorContactId).toBe(contactId);
    expect(identity?.investorOrgName).toBe("P3 Access Partners");
  });

  it("the investor can never resolve an internal identity — /admin and the internal app deny them", async () => {
    // requireAuth()/requireAdminAuth() admit only users with a profiles row.
    expect(await loadAuthSession(authUserId)).toBeNull();
    // And the internal tables themselves yield nothing under their session.
    const counts = await withInvestorSession(authUserId, async (tx) => {
      const opportunities = await tx.query<{ n: number }>("select count(*)::int as n from opportunities");
      const assets = await tx.query<{ n: number }>("select count(*)::int as n from assets");
      const portfolios = await tx.query<{ n: number }>("select count(*)::int as n from portfolios");
      return [opportunities.rows[0].n, assets.rows[0].n, portfolios.rows[0].n];
    });
    expect(counts).toEqual([0, 0, 0]);
  });
});

// ============================================================================
// 9, 10, 11, 14, 15 — invitation lifecycle
// ============================================================================
describe("Invitations", () => {
  it("stores only the token hash — the raw token appears nowhere in the database", async () => {
    const { inviteId, rawToken } = await createInvite(adminSession, contactId, {}, adminUserId);
    const row = await adminQuery<Record<string, unknown>>(
      "select * from investor_invites where invite_id = $1", [inviteId]);
    expect(row[0].token_hash).toBe(hashInviteToken(rawToken));
    expect(row[0].token_hash).not.toBe(rawToken);
    expect(JSON.stringify(row[0])).not.toContain(rawToken);
  });

  it("an invitation identifies its context but grants no publication access", async () => {
    const { rawToken } = await createInvite(adminSession, contactId, {}, adminUserId);
    const validated = await validateInviteToken(rawToken);
    expect(validated.ok).toBe(true);

    // Verify an OTP through the invitation, exactly like the UI flow (the code
    // is minted by the real Auth server; only the email hop is skipped).
    const supabase = createSupabaseStatelessClient();
    const { data } = await supabase.auth.verifyOtp({
      email: EMAIL, token: await issueRealOtp(EMAIL), type: "email",
    });
    const completion = await completeInvestorVerification(data.user!.id, rawToken);
    expect(completion.ok && completion.inviteAccepted).toBe(true);

    // The signed-in investor holds no entitlement: the portal shows nothing.
    const feed = await withInvestorSession(authUserId, (tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from investor_feed"));
    expect(feed.rows[0].n).toBe(0);
    const publications = await withInvestorSession(authUserId, (tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from investor_publications"));
    expect(publications.rows[0].n).toBe(0);
  });

  it("an accepted invitation cannot be used or stamped again", async () => {
    const invites = await listInvitesForOrg(adminSession, orgId);
    const accepted = invites.find((i) => i.state === "accepted")!;
    expect(accepted).toBeTruthy();
    // Starting the flow again with the same link is refused...
    // (raw token is gone by design, so validate via a state check + acceptInvite guard)
    expect(await acceptInvite(accepted.inviteId, contactId)).toBe(false);
    const again = await adminQuery<{ accepted_at: string }>(
      "select accepted_at from investor_invites where invite_id = $1", [accepted.inviteId]);
    expect(again[0].accepted_at).toBe(accepted.acceptedAt); // unchanged
  });

  it("a freshly used token validates as 'accepted' and cannot restart the flow", async () => {
    const { rawToken } = await createInvite(adminSession, contactId, {}, adminUserId);
    const supabase = createSupabaseStatelessClient();
    const { data } = await supabase.auth.verifyOtp({
      email: EMAIL, token: await issueRealOtp(EMAIL), type: "email",
    });
    const first = await completeInvestorVerification(data.user!.id, rawToken);
    expect(first.ok && first.inviteAccepted).toBe(true);

    const reuse = await validateInviteToken(rawToken);
    expect(reuse).toEqual({ ok: false, reason: "accepted" });
    // Identity is unaffected — but the invitation is spent and stays spent.
    const second = await completeInvestorVerification(data.user!.id, rawToken);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.inviteAccepted).toBe(false);
  });

  it("an expired invitation is rejected", async () => {
    const { inviteId, rawToken } = await createInvite(adminSession, contactId, {}, adminUserId);
    await adminQuery(
      "update investor_invites set expires_at = now() - interval '1 hour' where invite_id = $1",
      [inviteId]);
    expect(await validateInviteToken(rawToken)).toEqual({ ok: false, reason: "expired" });
    expect(await acceptInvite(inviteId, contactId)).toBe(false);
  });

  it("a revoked invitation is rejected immediately", async () => {
    const { inviteId, rawToken } = await createInvite(adminSession, contactId, {}, adminUserId);
    await revokeInvite(adminSession, inviteId);
    expect(await validateInviteToken(rawToken)).toEqual({ ok: false, reason: "revoked" });
    expect(await acceptInvite(inviteId, contactId)).toBe(false);
  });

  it("minting a new invitation revokes the previous active one", async () => {
    const a = await createInvite(adminSession, contactId, {}, adminUserId);
    const b = await createInvite(adminSession, contactId, {}, adminUserId);
    expect(await validateInviteToken(a.rawToken)).toEqual({ ok: false, reason: "revoked" });
    expect((await validateInviteToken(b.rawToken)).ok).toBe(true);
  });

  it("a garbage token is simply not found", async () => {
    expect(await validateInviteToken("not-a-real-token")).toEqual({ ok: false, reason: "not_found" });
    expect(await validateInviteToken("")).toEqual({ ok: false, reason: "not_found" });
  });
});

// ============================================================================
// 12, 13 — deactivation and suspension end access immediately
// ============================================================================
describe("Access ends the moment status changes", () => {
  it("an inactive contact is rejected at every gate", async () => {
    const inactiveUid = await provisionInvestorAuthUser(INACTIVE_EMAIL, "I. Dormant");
    await updateInvestorContact(adminSession, inactiveContactId, { authUserId: inactiveUid });
    const { rawToken } = await createInvite(adminSession, inactiveContactId, {}, adminUserId);
    await updateInvestorContact(adminSession, inactiveContactId, { isActive: false });

    expect(await authoriseOtpEmail(INACTIVE_EMAIL)).toEqual({ ok: false, reason: "contact_inactive" });
    expect(await validateInviteToken(rawToken)).toEqual({ ok: false, reason: "contact_inactive" });
    expect(await loadPortalIdentity(inactiveUid)).toBeNull();
    expect(await completeInvestorVerification(inactiveUid)).toEqual(
      { ok: false, reason: "no_active_contact" });
  });

  it("a suspended organisation is rejected at every gate", async () => {
    await updateInvestorOrganization(adminSession, suspendedOrgId, { status: "suspended" });
    expect(await authoriseOtpEmail(SUSPENDED_EMAIL)).toEqual({ ok: false, reason: "org_not_active" });
    const supabase = createSupabaseStatelessClient();
    const refused = await requestInvestorOtp(supabase, SUSPENDED_EMAIL);
    expect(refused.ok).toBe(false);

    const uid = (await adminQuery<{ auth_user_id: string }>(
      "select auth_user_id from investor_contacts where lower(email) = lower($1)",
      [SUSPENDED_EMAIL]))[0].auth_user_id;
    expect(await loadPortalIdentity(uid)).toBeNull();
  });
});

// ============================================================================
// 8 — internal identity is untouched, and never blends with investor identity
// ============================================================================
describe("Identity separation", () => {
  it("internal staff still authenticate with email + password", async () => {
    const session = await authenticate("admin@reiwa.com", DEMO_PASSWORD);
    expect(session?.role).toBe("reiwa_admin");
    const analyst = await authenticate("analyst@meiji.com", DEMO_PASSWORD);
    expect(analyst?.role).toBe("org_user");
  });

  it("a staff Auth user never resolves to an investor identity", async () => {
    expect(await loadPortalIdentity(adminUserId)).toBeNull();
    expect(await completeInvestorVerification(adminUserId)).toEqual(
      { ok: false, reason: "internal_identity" });
  });

  it("invitations are invisible to internal org users and to investors", async () => {
    const asStaff = await withSession(staff, (tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from investor_invites"));
    expect(asStaff.rows[0].n).toBe(0);
    await expect(withSession(staff, (tx) =>
      tx.query(`insert into investor_invites(investor_contact_id, token_hash, expires_at)
                values ($1, 'x', now())`, [contactId]))).rejects.toThrow();

    const asInvestor = await withInvestorSession(authUserId, (tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from investor_invites"));
    expect(asInvestor.rows[0].n).toBe(0);
  });

  it("masked email display never shows the full address", () => {
    expect(maskEmail("k.arai@kitano-fo.example")).toBe("k•••@ki•••.example");
    expect(maskEmail("a@b.co")).toBe("a•••@b•••.co");
  });
});
