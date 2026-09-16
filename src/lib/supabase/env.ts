// ============================================================================
// Supabase API configuration.
// ----------------------------------------------------------------------------
// These are the HTTP-API credentials (Auth / PostgREST). They are deliberately
// NOT the database credential: privileged Postgres access lives behind
// DATABASE_URL in src/lib/db/client.ts and the two are never interchanged.
//
// ---------------------------------------------------------------------------
// WHY THERE IS AN OVERRIDE, AND WHY IT IS NOT A TEST BRANCH
// ---------------------------------------------------------------------------
// The application reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_
// PUBLISHABLE_KEY and SUPABASE_SECRET_KEY, exactly as it always has, with no
// default and no fallback (see src/lib/env.ts for why).
//
// A harness process needs to talk to a DIFFERENT Supabase project — the
// disposable test one — and there are only two ways to arrange that. It can
// reassign the application's own variables inside its process, which is what
// the database side used to do and which has a nasty property: from that moment
// on, "NEXT_PUBLIC_SUPABASE_URL" means two different things depending on which
// process is asking, and any later check comparing the test project against the
// application project compares a value with itself. A gate that always passes
// is not a gate.
//
// Or the process can SAY which project it is pointed at. That is this: a single
// explicit declaration, made once, by a process that knows it is a harness.
// Nothing in src/ knows the word "test"; there is no NODE_ENV branch, no
// TEST_-prefixed name read here, and no code path in the application that
// reaches useSupabaseProject(). The declaration is made from tests/ and from
// the Playwright config, after the isolation gate in src/lib/db/test-supabase.ts
// has established that the target really is a separate, disposable project.
//
// Unset — which is every deployment and every `next dev` — resolution is
// byte-for-byte what it was before this existed.
// ============================================================================
import { missingEnv, missingEnvMessage, type RequiredEnvName } from "@/lib/env";

/** One Supabase project's HTTP-API credentials. */
export interface SupabaseProjectCredentials {
  url: string;
  publishableKey: string;
  secretKey: string;
}

/**
 * The project this process has been explicitly pointed at, if any.
 *
 * Module-level and process-wide on purpose: every Supabase client built in this
 * process must reach the same project, and a per-call parameter would make
 * "which project is this one going to?" a question with a different answer at
 * every call site.
 */
let declared: SupabaseProjectCredentials | null = null;
let declaredBy: string | null = null;

/**
 * Point this process at a specific Supabase project, overriding the
 * environment.
 *
 * Single-assignment. A second declaration with the same credentials is a no-op
 * — the Vitest per-file setup runs in every worker and would otherwise have to
 * track whether it was first — but a second declaration with DIFFERENT
 * credentials throws. Two answers to "which project is this process talking
 * to?" is precisely the confusion the whole isolation design exists to prevent,
 * and silently keeping one of them would decide it by import order.
 *
 * @param credentials the project to use.
 * @param label who is declaring it, for the error if someone declares twice.
 */
export function useSupabaseProject(
  credentials: SupabaseProjectCredentials, label: string,
): void {
  if (declared) {
    const same =
      declared.url === credentials.url &&
      declared.publishableKey === credentials.publishableKey &&
      declared.secretKey === credentials.secretKey;
    if (same) return;
    throw new Error(
      `Supabase project already declared by ${declaredBy}; ${label} is trying to ` +
      "declare a different one. A process may talk to exactly one Supabase project.",
    );
  }
  declared = { ...credentials };
  declaredBy = label;
}

/** The declared project, or null when resolution falls to the environment. */
export function declaredSupabaseProject(): Readonly<SupabaseProjectCredentials> | null {
  return declared;
}

/** Reset the declaration. Exists for unit tests of this module only. */
export function clearDeclaredSupabaseProject(): void {
  declared = null;
  declaredBy = null;
}

// No defaults and no fallback anywhere below: see src/lib/env.ts for why. A
// missing variable throws with the full list of what is missing and what each
// one is for, rather than the first name it happens to trip over.
function required(name: RequiredEnvName): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(missingEnvMessage(missingEnv()));
  }
  return value;
}

/** Project URL. Safe to expose to the browser. */
export const supabaseUrl = (): string =>
  declared ? declared.url : required("NEXT_PUBLIC_SUPABASE_URL");

/** Publishable (anon) key. Safe to expose; RLS is what protects the data. */
export const supabasePublishableKey = (): string =>
  declared ? declared.publishableKey : required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

/** Secret (service) key. Server-only; grants Admin API access. Never send to a client. */
export const supabaseSecretKey = (): string =>
  declared ? declared.secretKey : required("SUPABASE_SECRET_KEY");

/**
 * The URL and publishable key, or null if either is absent.
 *
 * For the one caller that must not throw: the Edge middleware, whose job is to
 * refresh a session cookie and whose correct behaviour with no Supabase
 * configured is to do nothing and let the request through. Reading through this
 * accessor rather than `process.env.NEXT_PUBLIC_*` also keeps the middleware's
 * resolution at RUNTIME — Next inlines statically-named NEXT_PUBLIC_ variables
 * into the edge bundle at build time, which would freeze the middleware onto
 * whichever project the build was made against while every other client in the
 * process followed the declaration above.
 */
export function optionalSupabaseSessionConfig(): { url: string; key: string } | null {
  if (declared) return { url: declared.url, key: declared.publishableKey };
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;
  return { url, key };
}
