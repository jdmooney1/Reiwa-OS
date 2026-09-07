// ============================================================================
// Supabase API configuration.
// ----------------------------------------------------------------------------
// These are the HTTP-API credentials (Auth / PostgREST). They are deliberately
// NOT the database credential: privileged Postgres access lives behind
// DATABASE_URL in src/lib/db/client.ts and the two are never interchanged.
// ============================================================================
import { missingEnv, missingEnvMessage, type RequiredEnvName } from "@/lib/env";

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
export const supabaseUrl = (): string => required("NEXT_PUBLIC_SUPABASE_URL");

/** Publishable (anon) key. Safe to expose; RLS is what protects the data. */
export const supabasePublishableKey = (): string => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

/** Secret (service) key. Server-only; grants Admin API access. Never send to a client. */
export const supabaseSecretKey = (): string => required("SUPABASE_SECRET_KEY");
