// ============================================================================
// Investor invitations — P3 data layer.
// ----------------------------------------------------------------------------
// Two strictly separated halves:
//
//   ADMIN (RLS-gated) — create / list / revoke, running inside withSession()
//   under the Reiwa admin's own claims. Only the SHA-256 hash of a token is
//   ever written; the raw token is returned once to the caller and forgotten.
//
//   SIGN-IN SUPPORT (privileged) — validating a token presented by an
//   UNAUTHENTICATED visitor and stamping acceptance after a successful OTP.
//   Like P0's session assembly, this runs on the privileged connection because
//   there is no session yet to run under. It reads nothing the visitor chose
//   beyond the token itself, which is matched only by hash.
//
// An invitation grants no database access anywhere: no RLS policy, helper or
// claim reads this table. It only identifies the intended access context; the
// investor still has to pass Supabase Auth OTP to the authorised email, and
// what they can then see is derived from auth.uid() by the P1 helpers.
// ============================================================================
import { createHash, randomBytes } from "node:crypto";
import { adminQuery, withSession, type Session } from "@/lib/db/client";

export const INVITE_TTL_DAYS_DEFAULT = 14;

export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export type InviteState = "active" | "expired" | "revoked" | "accepted";

export interface InvestorInvite {
  inviteId: string;
  investorContactId: string;
  state: InviteState;
  expiresAt: string;
  revokedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

function inviteState(r: {
  expires_at: string; revoked_at: string | null; accepted_at: string | null;
}): InviteState {
  if (r.revoked_at) return "revoked";
  if (r.accepted_at) return "accepted";
  if (new Date(r.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

function mapInvite(r: Record<string, any>): InvestorInvite {
  return {
    inviteId: r.invite_id,
    investorContactId: r.investor_contact_id,
    state: inviteState({
      expires_at: r.expires_at, revoked_at: r.revoked_at ?? null, accepted_at: r.accepted_at ?? null,
    }),
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at ?? null,
    acceptedAt: r.accepted_at ?? null,
    createdAt: r.created_at,
  };
}

// ============================================================================
// Admin side (RLS-gated)
// ============================================================================

/**
 * Mint an invitation for a contact. Returns the RAW token exactly once — it is
 * never stored, and this module never sees it again except as a hash to match.
 * Any previously active invitation for the contact is revoked in the same
 * transaction, so exactly one link is live per contact.
 */
export async function createInvite(
  session: Session, investorContactId: string,
  options: { ttlDays?: number } = {}, actorUserId?: string | null,
): Promise<{ inviteId: string; rawToken: string; expiresAt: string }> {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashInviteToken(rawToken);
  const ttlDays = options.ttlDays ?? INVITE_TTL_DAYS_DEFAULT;

  return withSession(session, async (tx) => {
    await tx.query(
      `update investor_invites set revoked_at = now()
        where investor_contact_id = $1 and revoked_at is null and accepted_at is null`,
      [investorContactId]);
    const { rows } = await tx.query<{ invite_id: string; expires_at: string }>(
      `insert into investor_invites(investor_contact_id, token_hash, expires_at, created_by)
       values ($1, $2, now() + make_interval(days => $3), $4)
       returning invite_id, expires_at`,
      [investorContactId, tokenHash, ttlDays, actorUserId ?? null]);
    return { inviteId: rows[0].invite_id, rawToken, expiresAt: rows[0].expires_at };
  });
}

export async function revokeInvite(session: Session, inviteId: string): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("update investor_invites set revoked_at = now() where invite_id = $1 and revoked_at is null",
             [inviteId]));
}

/** All invitations for an organisation's contacts, newest first per contact. */
export async function listInvitesForOrg(
  session: Session, investorOrgId: string,
): Promise<InvestorInvite[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `select i.* from investor_invites i
        join investor_contacts c on c.investor_contact_id = i.investor_contact_id
       where c.investor_org_id = $1
       order by i.created_at desc`,
      [investorOrgId]);
    return rows.map(mapInvite);
  });
}

/** One contact, for the admin provisioning flow. RLS-gated: admin only. */
export async function getInvestorContactForAdmin(
  session: Session, investorContactId: string,
): Promise<{ investorContactId: string; investorOrgId: string; email: string;
             name: string; authUserId: string | null; isActive: boolean } | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      "select * from investor_contacts where investor_contact_id = $1", [investorContactId]);
    const r = rows[0];
    if (!r) return null;
    return {
      investorContactId: r.investor_contact_id,
      investorOrgId: r.investor_org_id,
      email: r.email,
      name: r.name,
      authUserId: r.auth_user_id ?? null,
      isActive: Boolean(r.is_active),
    };
  });
}

// ============================================================================
// Sign-in support (privileged — no session exists yet)
// ============================================================================

export type InviteValidation =
  | {
      ok: true;
      inviteId: string;
      investorContactId: string;
      contactEmail: string;
      contactName: string;
      investorOrgName: string;
      expiresAt: string;
    }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "accepted"
                       | "contact_inactive" | "org_not_active" | "not_provisioned" };

/**
 * Validate a raw invitation token presented by an unauthenticated visitor.
 * Every check is server-side: hash match, expiry, revocation, prior
 * acceptance, contact active, organisation active, auth identity provisioned.
 */
export async function validateInviteToken(rawToken: string): Promise<InviteValidation> {
  if (!rawToken || rawToken.length > 128) return { ok: false, reason: "not_found" };
  const rows = await adminQuery<{
    invite_id: string; investor_contact_id: string;
    expires_at: string; revoked_at: string | null; accepted_at: string | null;
    email: string; name: string; is_active: boolean; auth_user_id: string | null;
    org_status: string; org_name: string;
  }>(
    `select i.invite_id, i.investor_contact_id, i.expires_at, i.revoked_at, i.accepted_at,
            c.email, c.name, c.is_active, c.auth_user_id,
            o.status as org_status, o.name as org_name
       from investor_invites i
       join investor_contacts c on c.investor_contact_id = i.investor_contact_id
       join investor_organizations o on o.investor_org_id = c.investor_org_id
      where i.token_hash = $1`,
    [hashInviteToken(rawToken)]);
  const r = rows[0];
  if (!r) return { ok: false, reason: "not_found" };
  if (r.revoked_at) return { ok: false, reason: "revoked" };
  if (r.accepted_at) return { ok: false, reason: "accepted" };
  if (new Date(r.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (!r.is_active) return { ok: false, reason: "contact_inactive" };
  if (r.org_status !== "active") return { ok: false, reason: "org_not_active" };
  if (!r.auth_user_id) return { ok: false, reason: "not_provisioned" };
  return {
    ok: true,
    inviteId: r.invite_id,
    investorContactId: r.investor_contact_id,
    contactEmail: r.email,
    contactName: r.name,
    investorOrgName: r.org_name,
    expiresAt: r.expires_at,
  };
}

/**
 * Stamp an invitation accepted — called only after Supabase Auth verified the
 * OTP and the resolved contact matches the invitation's contact. Guarded so a
 * revoked/expired/foreign invitation can never be stamped.
 */
export async function acceptInvite(inviteId: string, investorContactId: string): Promise<boolean> {
  const rows = await adminQuery<{ invite_id: string }>(
    `update investor_invites set accepted_at = now()
      where invite_id = $1 and investor_contact_id = $2
        and accepted_at is null and revoked_at is null and expires_at > now()
      returning invite_id`,
    [inviteId, investorContactId]);
  return rows.length > 0;
}
