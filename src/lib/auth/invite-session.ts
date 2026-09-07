// ============================================================================
// Invitation hand-off (P6) — getting the raw token out of the URL.
// ----------------------------------------------------------------------------
// An invitation token is a bearer credential for one step of the sign-in flow.
// It arrives the only way it can — in the link Reiwa emailed, as a path segment
// — and from that moment it is somewhere durable and shared:
//
//   * browser history and the address bar,
//   * the Referer header on anything the page loads or links to,
//   * an access log, a proxy log, an analytics hit, a shoulder,
//   * whatever the recipient pastes when they forward "the link".
//
// So the URL is used ONCE, at /access/<token>, and the token never appears in
// one again. The route handler validates it server-side, moves it into the
// short-lived httpOnly cookie below and redirects to a URL that carries
// nothing. Every later step — rendering the invitation, requesting the code,
// verifying it — reads the cookie, so the browser holds no copy JavaScript can
// read and sends none to any other origin.
//
// This does not replace any of P3's guarantees; it sits in front of them. The
// token is still a random 32-byte value, still stored only as a SHA-256 hash,
// still expiring, still revocable, still one-shot, and it still grants nothing
// on its own — only the OTP to the authorised address signs anyone in.
//
// SERVER-ONLY.
// ============================================================================
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

/** The raw token, for the few minutes the sign-in flow needs it. */
export const INVITE_COOKIE = "reiwa_invite";
/** Why an invitation was refused, so /access can explain without the token. */
export const INVITE_STATUS_COOKIE = "reiwa_invite_status";

/**
 * Long enough to read the page, open the email and type the code; short enough
 * that a shared device does not carry the invitation into someone else's day.
 */
export const INVITE_COOKIE_MAX_AGE_SECONDS = 15 * 60;

interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

/**
 * httpOnly so no script can read it, `secure` outside development so it is
 * never sent in clear, `sameSite: lax` so another site cannot make the browser
 * replay it, and scoped to a short life.
 */
function cookieOptions(maxAge = INVITE_COOKIE_MAX_AGE_SECONDS): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

/** Attach the validated token to a redirect away from the token-bearing URL. */
export function attachInviteToken(response: NextResponse, rawToken: string): NextResponse {
  response.cookies.set(INVITE_COOKIE, rawToken, cookieOptions());
  response.cookies.delete(INVITE_STATUS_COOKIE);
  return response;
}

/**
 * Attach the reason an invitation was refused. The token itself is deliberately
 * NOT carried: /access needs to explain the refusal, not to retry it.
 */
export function attachInviteStatus(response: NextResponse, reason: string): NextResponse {
  response.cookies.set(INVITE_STATUS_COOKIE, reason, cookieOptions(5 * 60));
  response.cookies.delete(INVITE_COOKIE);
  return response;
}

/** The pending invitation token for this request, if any. */
export function readInviteToken(): string | null {
  return cookies().get(INVITE_COOKIE)?.value ?? null;
}

/** The pending refusal reason for this request, if any. */
export function readInviteStatus(): string | null {
  return cookies().get(INVITE_STATUS_COOKIE)?.value ?? null;
}

/**
 * Drop both cookies. Called once the invitation has been accepted (or the flow
 * abandoned): there is no reason for the token to outlive the sign-in it was
 * minted for, and P3 has already made it one-shot in the database.
 */
export function clearInviteSession(): void {
  const jar = cookies();
  jar.delete(INVITE_COOKIE);
  jar.delete(INVITE_STATUS_COOKIE);
}
