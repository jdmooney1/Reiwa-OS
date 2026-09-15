// ============================================================================
// The internal staff directory — turning a user id into a person.
// ----------------------------------------------------------------------------
// A thin wrapper over `app.staff_names()` (migration 0011). The authorisation
// is entirely the function's: this file sends ids and renders what comes back,
// and adds no rule of its own, because a rule written here as well would be a
// second, weaker copy of one that already holds.
//
// The call goes through withSession() like every other read, so it carries the
// caller's own claims and the function resolves `auth.uid()` to the real user.
// It is NEVER issued over the privileged connection: that would answer as
// `postgres`, which the function would then treat as an unauthenticated caller
// with no profiles row — the right refusal for the wrong reason, and an
// invitation to "fix" it later by skipping the check.
//
// Batch, not per row. One screen resolves every name it needs in one round trip:
// a diligence framework owned by six people is one call, not fifty-one joins.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";

/** user id → display name. An id absent from the map could not be resolved. */
export type NameDirectory = ReadonlyMap<string, string>;

const EMPTY: NameDirectory = new Map();

/**
 * Resolve display names inside an existing transaction.
 *
 * Preferred over `staffNames()` wherever the caller is already inside
 * withSession(), so the names and the rows they belong to are read in the same
 * transaction under the same claims.
 */
export async function staffNamesOn(
  tx: Queryable, userIds: readonly (string | null | undefined)[],
): Promise<NameDirectory> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return EMPTY;

  const { rows } = await tx.query<{ user_id: string; display_name: string }>(
    "select user_id, display_name from app.staff_names($1::uuid[])", [ids]);

  const out = new Map<string, string>();
  for (const r of rows) out.set(r.user_id, r.display_name);
  return out;
}

/** The same, opening its own session. For callers not already in one. */
export async function staffNames(
  session: Session, userIds: readonly (string | null | undefined)[],
): Promise<NameDirectory> {
  const ids = userIds.filter((id): id is string => !!id);
  if (ids.length === 0) return EMPTY;
  return withSession(session, (tx) => staffNamesOn(tx, ids));
}

/**
 * The name for one id, or null when it could not be resolved.
 *
 * Null is not "nobody": the id is still set on the record. Callers that render
 * an owner must keep those two apart — see `ownerLabel` in the risks and
 * diligence sections.
 */
export function nameOf(directory: NameDirectory, userId: string | null): string | null {
  return userId ? directory.get(userId) ?? null : null;
}
