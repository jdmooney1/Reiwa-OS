// ============================================================================
// Which profile is a load attributed to?
// ----------------------------------------------------------------------------
// `profiles` is keyed by user_id (the Supabase Auth uuid) and carries a unique
// email, so an operator can name a person either way. The loader's --user flag
// takes both and this file decides which one it was, without a database, so the
// rule is testable and a typo is refused before any connection is opened.
// ============================================================================

export type UserRef =
  | { kind: "id"; value: string }
  | { kind: "email"; value: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately loose: the database is the authority on whether the address
// exists. This only separates "an email" from "something that is neither".
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Classify a --user value. A uuid is a profile id; anything shaped like an
 * address is an email, compared case-insensitively by the caller. Anything else
 * is refused, so a half-pasted id cannot silently fall through to a lookup that
 * matches nothing.
 */
export function parseUserRef(input: string): UserRef {
  const value = input.trim();
  if (UUID.test(value)) return { kind: "id", value: value.toLowerCase() };
  if (EMAIL.test(value)) return { kind: "email", value: value.toLowerCase() };
  throw new Error(
    `--user must be a profile id (a uuid) or an email address; got "${input}".`,
  );
}
