"use server";

// ============================================================================
// Investor access actions (P3) — the public face of the OTP gate.
// ----------------------------------------------------------------------------
// Nothing a browser submits here is ever the authority for anything:
//   * on the invitation path the email comes from the validated token, never
//     from the client;
//   * on the direct path the email only addresses the OTP; identity is decided
//     by Supabase Auth's verification and re-resolved server-side;
//   * every refusal on the public path collapses into neutral copy, so these
//     endpoints cannot be used to enumerate authorised addresses.
// ============================================================================
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  requestInvestorOtp, completeInvestorVerification,
} from "@/lib/auth/investor-access";
import { validateInviteToken } from "@/lib/data/investor-invites";
import { readInviteToken, clearInviteSession } from "@/lib/auth/invite-session";
import { recordPortalEvent } from "@/lib/data/portal-feed";

export interface AccessFormState {
  error?: string;
  sent?: boolean;
  email?: string;
}

const NEUTRAL_SENT =
  "If this address is authorised for the Reiwa Capital investment portal, an access code has been emailed to it.";

/**
 * Invitation path: the email is resolved from the token, server-side only.
 *
 * The token is read from the httpOnly cookie the /access/<token> hand-off set,
 * never from an argument the browser could supply and never from the URL — so
 * neither this action's payload nor the redirect it issues carries it.
 */
export async function requestOtpForInviteAction(): Promise<void> {
  const rawToken = readInviteToken();
  const invite = rawToken ? await validateInviteToken(rawToken) : null;
  // An invitation that is missing or no longer valid goes back to the access
  // page, which explains why. Still no token in the URL.
  if (!invite?.ok) redirect("/access");

  const supabase = createSupabaseServerClient();
  await requestInvestorOtp(supabase, invite.contactEmail);
  redirect("/portal/verify");
}

/** Direct path: for people who are already authorised contacts. */
export async function requestOtpDirectAction(
  _prev: AccessFormState, formData: FormData,
): Promise<AccessFormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };

  const supabase = createSupabaseServerClient();
  await requestInvestorOtp(supabase, email);
  // Deliberately identical outcome whether or not the address is authorised.
  return { sent: true, email };
}

export async function verifyOtpAction(
  _prev: AccessFormState, formData: FormData,
): Promise<AccessFormState> {
  const code = String(formData.get("code") ?? "").trim();
  // From the httpOnly cookie, never a hidden form field: the token is not in
  // the page's markup, so it cannot be read, copied or replayed from there.
  const inviteToken = readInviteToken();
  if (!code) return { error: "Enter the access code from your email." };

  // The address the code was sent to: from the invitation when there is one,
  // otherwise the address the visitor asked us to use. Either way it only
  // routes the verification — the verified auth user decides identity.
  let email = String(formData.get("email") ?? "").trim();
  if (inviteToken) {
    const invite = await validateInviteToken(inviteToken);
    if (invite.ok) email = invite.contactEmail;
  }
  if (!email) return { error: "Start again from your invitation link." };

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error || !data.user) {
    return { error: "That code is not valid or has expired. Request a new one.", email };
  }

  const completion = await completeInvestorVerification(data.user.id, inviteToken);
  if (completion.ok) {
    // The invitation has done its whole job. P3 already made it one-shot in the
    // database; drop the browser's copy too rather than leave it to expire.
    clearInviteSession();
    // The one factual sign-in event (P1's `login`). Recorded here, once per
    // verified sign-in, rather than per page view — "last portal login" in the
    // admin surface means exactly this and nothing inferred.
    await recordPortalEvent(data.user.id, "login");
  }
  if (!completion.ok) {
    // Verified with Supabase, but not an active investor contact (or a staff
    // account): no portal session may exist. End the Auth session immediately.
    await supabase.auth.signOut();
    return {
      error: completion.reason === "internal_identity"
        ? "This account belongs to Reiwa staff — use the staff sign-in instead."
        : "This address is not currently authorised for portal access. Contact Reiwa Capital.",
      email,
    };
  }

  redirect("/portal");
}

export async function portalSignOutAction(): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  clearInviteSession();
  redirect("/portal/verify");
}
