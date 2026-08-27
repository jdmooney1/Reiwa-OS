import { adminQuery } from "@/lib/db/client";
import { verifyPassword } from "@/lib/auth/password";
import type { AuthSession } from "@/lib/auth/session";
import type { GlobalRole } from "@/lib/db/client";

interface UserRow {
  user_id: string;
  email: string;
  password_hash: string;
  name: string | null;
  global_role: GlobalRole;
}

/** Verify credentials against the DB (superuser read; bypasses RLS). */
export async function authenticate(email: string, password: string): Promise<AuthSession | null> {
  const users = await adminQuery<UserRow>(
    "select user_id, email, password_hash, name, global_role from users where lower(email) = lower($1)",
    [email.trim()],
  );
  const user = users[0];
  if (!user || !verifyPassword(password, user.password_hash)) return null;

  const memberships = await adminQuery<{ org_id: string }>(
    "select org_id from organization_members where user_id = $1",
    [user.user_id],
  );
  return {
    userId: user.user_id,
    email: user.email,
    name: user.name,
    role: user.global_role,
    orgIds: memberships.map((m) => m.org_id),
  };
}
