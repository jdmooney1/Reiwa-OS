import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { GlobalRole, Session } from "@/lib/db/client";

const COOKIE = "reiwa_session";
const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-insecure-secret-change-me-in-production",
);

export interface AuthSession {
  userId: string;
  email: string;
  name: string | null;
  role: GlobalRole;
  orgIds: string[];
}

export function canWrite(role: GlobalRole): boolean {
  return role !== "investor_viewer";
}

/** DB session (role + org scope) derived from the auth session. */
export function toDbSession(s: AuthSession): Session {
  return { userId: s.userId, orgIds: s.orgIds, role: s.role, canWrite: canWrite(s.role) };
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

/** For server actions/pages: the auth session or a redirect to sign-in. */
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
      userId: String(payload.userId),
      email: String(payload.email),
      name: (payload.name as string) ?? null,
      role: payload.role as GlobalRole,
      orgIds: (payload.orgIds as string[]) ?? [],
    };
  } catch {
    return null;
  }
}
