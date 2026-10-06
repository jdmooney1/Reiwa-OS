// ============================================================================
// A deal-share token: minted, hashed, and compared. Pure; SERVER-ONLY (node:crypto).
// ----------------------------------------------------------------------------
// The token is the whole credential for a share link, so it is handled like
// CRON_SECRET in src/lib/cron-auth.ts: only a digest is ever stored, the comparison is
// constant-time, and anything malformed FAILS CLOSED. The raw token is returned once by
// mintShareToken() to the admin who creates the share, travels in the link, and is never
// written to a column or a log (tests/unit/deal-share-boundaries.test.ts greps for it).
//
// There is no code shared with the investor invitation hash on purpose: the two surfaces
// must stay separable.
// ============================================================================
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes as base64url: 256 bits, 43 characters, URL-safe. */
const TOKEN_BYTES = 32;
export const MAX_TOKEN_CHARS = 128;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/** SHA-256 hex of a raw token: what the `token_hash` column holds. */
export const hashShareToken = (raw: string): string => createHash("sha256").update(raw).digest("hex");

export function mintShareToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  return { rawToken, tokenHash: hashShareToken(rawToken) };
}

/** Whether a string could be a token at all. Cheap, and keeps junk away from the database. */
export const looksLikeShareToken = (raw: unknown): raw is string =>
  typeof raw === "string" && raw.length <= MAX_TOKEN_CHARS && TOKEN_SHAPE.test(raw);

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Does this presented token match the stored hash? The shape of authorizeCron(): both sides
 * are hashed again first, so the comparison is constant-length as well as constant-time.
 * A missing or malformed value on either side is a refusal, never a pass.
 */
export function verifyShareToken(presented: string | null | undefined, storedHash: string | null | undefined): boolean {
  if (!looksLikeShareToken(presented)) return false;
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(digest(hashShareToken(presented)), digest(storedHash));
}
