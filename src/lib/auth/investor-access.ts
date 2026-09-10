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

/** How many characters of the mask to show. Fixed, so it leaks no length. */
const MASK = "•••••";

/**
 * "jd.mooney@hotmail.com" → "jd.m•••••@hotmail.com"
 *
 * This is shown to somebody who is about to go and look in their inbox, so it
 * has one job: let the right person recognise their own address, and tell
 * nobody else what it is.
 *
 * The domain is kept whole — subdomain and all. A domain is not the secret:
 * "hotmail.com" identifies a mail provider, not a person, and hiding it was
 * what made the old form (`j•••@ho•••.com`) read like a mistake rather than a
 * privacy measure. What matters is the local part, and that is where the
 * masking is.
 *
 * Enough of the local part is revealed to be recognisable — up to four
 * characters — but never all of it, however short the address. The mask is a
 * fixed width, so it does not disclose how many characters follow.
 */
export function maskEmail(email: string): string {
  const at = (email ?? "").lastIndexOf("@");
  // Not an address we can reason about; say nothing rather than guess.
  if (at <= 0 || at === email.length - 1) return MASK;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  // Always leave at least one character hidden, so the full address is never
  // reconstructable from the screen: a two-character local shows one, a
  // one-character local shows none.
  const revealed = Math.max(0, Math.min(4, local.length - 1));
  return `${local.slice(0, revealed)}${MASK}@${domain}`;
}
