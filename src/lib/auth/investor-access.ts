// ============================================================================
// Investor access service (P3) — the OTP gate in front of the portal.
// ----------------------------------------------------------------------------
// The flow: invitation link (context only) → authorised email → Supabase OTP
// → verified auth.uid() → active investor contact → investor session.
//
// Guarantees enforced here, server-side:
//   * shouldCreateUser is ALWAYS false — no OTP request can mint an Auth user;
//   * an OTP is only ever requested for an email that is an active, provisioned
//     investor contact of an active organisation (checked before Supabase is
//     even called, so unknown emails learn nothing);
//   * verification is completed only when the VERIFIED auth.uid() resolves to
//     an active contact — the email a client typed is never the authority;
//   * an invitation is stamped accepted only when it belongs to the very
//     contact that just verified, and never grants anything by itself.
//
// SERVER-ONLY. Uses the privileged connection exactly the way P0 sign-in
// support does: to resolve identity before a session exists.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminQuery } from "@/lib/db/client";
import { loadAuthSession } from "@/lib/auth/service";
import { loadPortalIdentity, type PortalIdentity } from "@/lib/auth/portal-session";
import { validateInviteToken, acceptInvite } from "@/lib/data/investor-invites";

export type OtpRefusal =
  | "unknown_email" | "not_provisioned" | "contact_inactive" | "org_not_active";

export type OtpAuthorisation =
  | { ok: true; email: string }
  | { ok: false; reason: OtpRefusal };

/**
 * May an OTP be sent to this email at all? Active contact, active
 * organisation, provisioned Auth identity — otherwise refused before any call
 * to Supabase. Callers on the public direct-login path must collapse every
 * refusal into one neutral message so addresses cannot be enumerated.
 */
export async function authoriseOtpEmail(email: string): Promise<OtpAuthorisation> {
  const cleaned = email.trim();
  if (!cleaned || cleaned.length > 320) return { ok: false, reason: "unknown_email" };
  const rows = await adminQuery<{
    email: string; is_active: boolean; auth_user_id: string | null; org_status: string;
  }>(
    `select c.email, c.is_active, c.auth_user_id, o.status as org_status
       from investor_contacts c
       join investor_organizations o on o.investor_org_id = c.investor_org_id
      where lower(c.email) = lower($1)`,
    [cleaned]);
  const r = rows[0];
  if (!r) return { ok: false, reason: "unknown_email" };
  if (!r.is_active) return { ok: false, reason: "contact_inactive" };
  if (r.org_status !== "active") return { ok: false, reason: "org_not_active" };
  if (!r.auth_user_id) return { ok: false, reason: "not_provisioned" };
  return { ok: true, email: r.email };
}

/**
 * Request an OTP for an authorised investor email. `shouldCreateUser: false`
 * always: even if a guard were somehow bypassed, Supabase Auth itself refuses
 * to create an account from this path.
 */
export async function requestInvestorOtp(
  supabase: SupabaseClient, email: string,
): Promise<OtpAuthorisation> {
  const authorised = await authoriseOtpEmail(email);
  if (!authorised.ok) return authorised;
  const { error } = await supabase.auth.signInWithOtp({
    email: authorised.email,
    options: { shouldCreateUser: false },
  });
  if (error) {
    // The guard said yes but Auth said no (e.g. identity deleted out-of-band).
    return { ok: false, reason: "not_provisioned" };
  }
  return authorised;
}

export type VerificationCompletion =
  | { ok: true; identity: PortalIdentity; inviteAccepted: boolean }
  | { ok: false; reason: "no_active_contact" | "internal_identity" };

/**
 * After Supabase verified the OTP: turn the PROVEN auth user id into an
 * investor identity. A staff Auth user is refused outright — an internal
 * identity is never converted into an investor session. If an invitation
 * token accompanied the flow, it is consumed only when it belongs to this
 * exact contact; a stale or foreign token changes nothing.
 */
export async function completeInvestorVerification(
  authUserId: string, rawInviteToken?: string | null,
): Promise<VerificationCompletion> {
  if (await loadAuthSession(authUserId)) return { ok: false, reason: "internal_identity" };

  const identity = await loadPortalIdentity(authUserId);
  if (!identity) return { ok: false, reason: "no_active_contact" };

  let inviteAccepted = false;
  if (rawInviteToken) {
    const invite = await validateInviteToken(rawInviteToken);
    if (invite.ok && invite.investorContactId === identity.investorContactId) {
      inviteAccepted = await acceptInvite(invite.inviteId, identity.investorContactId);
    }
  }
  return { ok: true, identity, inviteAccepted };
}

/** "j.mooney@acme.example" → "j•••@ac•••.example" — safe on-screen display. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  const keep = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n)) + "•••";
  return `${keep(local, 1)}@${keep(host, 2)}${tld}`;
}
