// TRANSITIONAL staff credential check (legacy dev sign-in) — replaced by
// Supabase Auth signInWithPassword when connectivity is available (P0 step 5).
// Identity resolution uses adminQuery (privileged direct DB access).
import { adminQuery } from "@/lib/db/client";
import { verifyPassword } from "@/lib/auth/password";
import type { AuthSession } from "@/lib/auth/session";
import type { GlobalRole } from "@/lib/db/client";

interface UserRow {
  user_id: string;
  email: string;
  password_hash: string | null;
  name: string | null;
  global_role: GlobalRole;
}

export async function authenticate(email: string, password: string): Promise<AuthSession | null> {
  const users = await adminQuery<UserRow>(
    "select user_id, email, password_hash, name, global_role from users where lower(email) = lower($1)",
    [email.trim()],
  );
  const user = users[0];
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) return null;

  return {
    kind: "internal",
    userId: user.user_id,
    email: user.email,
    name: user.name,
    role: user.global_role,
    canWrite: await computeCanWrite(user.user_id, user.global_role),
  };
}

/** UI hint only — RLS re-derives write scope per-row via can_write_org(). */
export async function computeCanWrite(userId: string, role: GlobalRole): Promise<boolean> {
  if (role === "reiwa_admin") return true;
  const rows = await adminQuery<{ n: number }>(
    "select count(*)::int as n from organization_members where user_id = $1 and role in ('owner','manager','analyst')",
    [userId],
  );
  return (rows[0]?.n ?? 0) > 0;
}
