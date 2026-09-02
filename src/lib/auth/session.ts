// ============================================================================
// Session layer — target shape for Supabase Auth as the single identity
// provider (staff email+password; investors email OTP in P1).
// ----------------------------------------------------------------------------
// TRANSITIONAL: until connectivity to the hosted reiwa-dev Supabase project is
// available from this environment, the ACTIVE mechanism is the legacy signed
// session cookie below. The exported interface (AuthSession / getSession /
// requireAuth) is already the target shape, so swapping the provider to
// @supabase/ssr changes only this module's internals (P0 steps 5/12).
// `role` and `canWrite` are UI hints; RLS re-derives authorisation in the
// database from auth.uid() membership joins.
// ============================================================================
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { GlobalRole, Session } from "@/lib/db/client";

const COOKIE = "reiwa_session";
const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-insecure-secret-change-me-in-production",
);

export interface AuthSession {
  kind: "internal";
  userId: string; // Supabase Auth user id (auth.users.id)
  email: string;
  name: string | null;
  role: GlobalRole;
  canWrite: boolean; // admin, or any membership with a write role
}

export function toDbSession(s: AuthSession): Session {
  return { kind: "internal", userId: s.userId, role: s.role, canWrite: s.canWrite };
}

export async function createSessionCookie(s: AuthSession): Promise<void> {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(): void {
  cookies().set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function requireAuth(): Promise<AuthSession> {
  const s = await getSession();
  if (s) return s;
  const { redirect } = await import("next/navigation");
  redirect("/sign-in"); // throws NEXT_REDIRECT
  throw new Error("unreachable");
}

export async function requireDbSession(): Promise<Session> {
  return toDbSession(await requireAuth());
}

export async function getSession(): Promise<AuthSession | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      kind: "internal",
      userId: String(payload.userId),
      email: String(payload.email),
      name: (payload.name as string) ?? null,
      role: payload.role as GlobalRole,
      canWrite: payload.canWrite === true,
    };
  } catch {
    return null;
  }
}
