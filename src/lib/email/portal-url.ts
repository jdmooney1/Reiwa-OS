// ============================================================================
// The canonical investor portal address.
// ----------------------------------------------------------------------------
// An invitation email carries a bearer credential in a URL, and that URL is
// composed on the server and clicked, days later, by somebody who has no way
// to tell a right domain from a wrong one. So the domain is a decision Reiwa
// makes once, in configuration, and it is NEVER derived from the request.
//
// Not from `Host`, not from `Origin`, not from `X-Forwarded-Host`. Those are
// headers — supplied by a client, forwarded by a proxy, and rewritable by
// anything in between. A single poisoned header would put a working invitation
// link to an attacker's domain into an investor's inbox, signed with Reiwa's
// name and sent from Reiwa's mail server. There is no benefit that justifies
// that risk when one environment variable removes the class of problem.
//
// INVESTOR_PORTAL_URL is SEND-required, not boot-required: the portal runs
// perfectly well without it, and only the act of sending an invitation is
// refused, with a message that says exactly what to set. That keeps a
// misconfiguration loud at the moment it matters without preventing every
// other deployment, test and build from starting.
//
// SERVER-ONLY.
// ============================================================================
import { AppError } from "@/lib/errors";

/** Hosts permitted to be served over plain http — development and tests only. */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

/**
 * The configured portal origin, validated, with no trailing slash.
 *
 * Validation happens HERE, at the point of use, rather than at boot: a value
 * that is wrong in a way that only matters when composing a link should fail
 * where the link is composed, with a message about invitations.
 *
 * The raw value is a parameter so the rules can be tested directly; in
 * production nothing passes it and it reads the environment.
 */
export function investorPortalUrl(
  raw: string | undefined = process.env.INVESTOR_PORTAL_URL,
): string {
  const value = (raw ?? "").trim();
  if (!value) {
    throw new AppError(
      "The investor portal address is not configured, so no invitation was sent. " +
      "Set INVESTOR_PORTAL_URL (for example https://portal.reiwa-capital.com) and try again.",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      `INVESTOR_PORTAL_URL is not a valid URL (${value}), so no invitation was sent.`,
    );
  }

  // Plain http would put the token on the wire in clear. Only a local host may
  // be served without TLS, and only because that is where tests run.
  const isLocal = LOCAL.test(url.hostname);
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new AppError(
      "INVESTOR_PORTAL_URL must be an https:// address, so no invitation was sent.",
    );
  }

  // An origin, not a page. A path here would silently produce a link like
  // https://host/some/path/access/<token>, which 404s for the investor and
  // looks like Reiwa's mistake — because it is one.
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new AppError(
      "INVESTOR_PORTAL_URL must be an origin with no path, query or fragment " +
      `(for example https://portal.reiwa-capital.com), so no invitation was sent.`,
    );
  }

  // `URL.origin` is already the scheme, host and any non-default port, with no
  // trailing slash — which is exactly what a link is joined onto.
  return url.origin;
}
