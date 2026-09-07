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
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  requestInvestorOtp, completeInvestorVerification,
} from "@/lib/auth/investor-access";
import { validateInviteToken } from "@/lib/data/investor-invites";
import { recordPortalEvent } from "@/lib/data/portal-feed";


/**
 * The invitation token is carried from the access page to the code screen in
 * an httpOnly cookie rather than in the URL (P6).
 *
 * The emailed link must contain the token — that is what a link is. What it
 * must not do is keep re-appearing: a token in /portal/verify?invite=... would
 * land in reverse-proxy access logs, browser history and any Referer sent from
 * that page. Moving it into a short-lived, httpOnly, SameSite cookie removes
 * every one of those copies without weakening the token itself: it is still
 * validated server-side on each use, still single-use, still revocable.
 */
const INVITE_COOKIE = "reiwa_invite";
const INVITE_COOKIE_MAX_AGE = 15 * 60; // long enough to read an email, no longer

function rememberInvite(token: string): void {
  cookies().set(INVITE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE,
  });
}

function rememberedInvite(): string | null {
  return cookies().get(INVITE_COOKIE)?.value ?? null;
}

function forgetInvite(): void {
  cookies().set(INVITE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export interface AccessFormState {
  error?: string;
  sent?: boolean;
  email?: string;
}

const NEUTRAL_SENT =
  "If this address is authorised for the Reiwa Capital investment portal, an access code has been emailed to it.";

/** Invitation path: the email is resolved from the token, server-side only. */
export async function requestOtpForInviteAction(rawToken: string): Promise<void> {
  const invite = await validateInviteToken(rawToken);
  // An invalid token just re-renders the access page, which explains why.
  if (!invite.ok) redirect(`/access/${encodeURIComponent(rawToken)}`);

  const supabase = createSupabaseServerClient();
  await requestInvestorOtp(supabase, invite.contactEmail);
  rememberInvite(rawToken);
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
  const inviteToken = rememberedInvite() ?? (String(formData.get("invite") ?? "").trim() || null);
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

  forgetInvite();
  const completion = await completeInvestorVerification(data.user.id, inviteToken);
  if (completion.ok) {
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
  redirect("/portal/verify");
}
