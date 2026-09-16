// ============================================================================
// Which Supabase project does this credential belong to?
// ----------------------------------------------------------------------------
// A hosted Supabase project is identified by its PROJECT REF — the subdomain of
// its API URL (`https://<ref>.supabase.co`) and the suffix of its Postgres
// username (`postgres.<ref>`). Two credentials belong to the same project if
// and only if those refs match.
//
// This module is pure and offline: it derives refs from strings and compares
// them. It never opens a connection, never calls the Supabase API, and — the
// point of keeping it separate — it never logs, echoes or returns a key. A
// caller that wants to report a mismatch gets refs and variable names, which
// are safe to print; the secret it was checking stays where it was.
//
// WHAT CAN AND CANNOT BE DERIVED OFFLINE, because it shapes the whole gate:
//
//   API URL          https://<ref>.supabase.co          ref is RIGHT THERE
//   Postgres URL     postgres.<ref>@...pooler...        ref is in the username
//   Legacy anon/service key (a JWT)                     ref is a payload claim
//   Modern sb_publishable_* / sb_secret_* key           NO ref, by design
//
// The modern key formats are opaque random strings. There is no offline way to
// learn which project one belongs to, and pretending otherwise would be the
// dangerous kind of check — one that returns "consistent" because it could not
// find a contradiction.
//
// So the gate in src/lib/db/test-supabase.ts does not rely on being able to
// read a ref out of a key. It relies on something stronger: a key is only ever
// SENT to the URL it was configured alongside. The URL decides which project is
// contacted, the URL's ref is checked against the test database's ref, and a
// key belonging to some other project therefore cannot reach that other
// project — it can only be rejected by the test one. Where a ref IS derivable
// (a legacy JWT) it is checked as well, because a free contradiction is worth
// catching.
// ============================================================================

/** How a key is shaped. Used for diagnostics and to decide if a ref is readable. */
export type SupabaseKeyFormat = "publishable" | "secret" | "legacy-jwt" | "unrecognised";

/**
 * The project ref in an API URL: the first label of `<ref>.supabase.co`.
 *
 * Returns null for anything that is not a hosted Supabase project URL, which
 * the caller treats as a refusal rather than as "no opinion".
 */
export function projectRefFromApiUrl(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let host: string;
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return null;
  }
  // `<ref>.supabase.co`, and also `<ref>.supabase.in`/`.red` style hosts used by
  // some regions. The ref itself is the leading label.
  const match = host.match(/^([a-z0-9]{8,})\.supabase\.(co|in|red|net)$/);
  return match ? match[1] : null;
}

/**
 * The project ref in a Postgres connection string: the suffix of the username.
 *
 * Every project in a region shares the pooler hostname and the database name
 * `postgres`; the username is the only part that says which project. A direct
 * (non-pooler) connection uses a bare `postgres` username and carries no ref —
 * that returns null, and the gate refuses rather than guessing.
 */
export function projectRefFromDatabaseUrl(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let user: string;
  try {
    user = decodeURIComponent(new URL(trimmed).username).toLowerCase();
  } catch {
    return null;
  }
  const dot = user.indexOf(".");
  if (dot < 0) return null;
  const ref = user.slice(dot + 1);
  return /^[a-z0-9]{8,}$/.test(ref) ? ref : null;
}

/** Classify a key by its prefix. Does not validate it and does not return it. */
export function supabaseKeyFormat(raw: string | undefined): SupabaseKeyFormat {
  const key = (raw ?? "").trim();
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  if (/^ey[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return "legacy-jwt";
  return "unrecognised";
}

/**
 * The `ref` claim of a legacy JWT key, when there is one.
 *
 * The signature is NOT verified and deliberately so: this is an identity hint
 * used to catch an obvious misconfiguration offline, not an authentication
 * decision. Authentication is the Supabase project's job, and it happens when
 * the key is used. Returns null for a modern opaque key, which carries no ref
 * at all — see the header note.
 */
export function projectRefFromKey(raw: string | undefined): string | null {
  const key = (raw ?? "").trim();
  if (supabaseKeyFormat(key) !== "legacy-jwt") return null;
  try {
    const payload = key.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const ref = (JSON.parse(json) as { ref?: unknown }).ref;
    return typeof ref === "string" && ref.trim() !== "" ? ref.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}
