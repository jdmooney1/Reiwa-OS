// ============================================================================
// Cron authorisation. Pure.
// ----------------------------------------------------------------------------
// Vercel invokes a cron route with `Authorization: Bearer $CRON_SECRET` when a
// CRON_SECRET environment variable exists. This is the whole of the gate, so it
// FAILS CLOSED: no secret configured means nobody is authorised, not everybody.
// A short secret is refused as well, because a guessable one is no gate.
// ============================================================================
import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_CRON_SECRET_CHARS = 16;

const digest = (s: string) => createHash("sha256").update(s).digest();

export function authorizeCron(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || secret.length < MIN_CRON_SECRET_CHARS) return false;
  if (!header) return false;
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) return false;
  // Hashing first makes the comparison constant-length as well as constant-time.
  return timingSafeEqual(digest(m[1]), digest(secret));
}
