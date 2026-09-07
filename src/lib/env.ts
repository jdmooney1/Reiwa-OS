// ============================================================================
// Environment guard (P6) — fail loudly at the boundary, never silently.
// ----------------------------------------------------------------------------
// A missing credential in production must produce one clear error naming what
// is absent, not a confusing failure three layers down (an "invalid URL", an
// empty API key accepted and later rejected, a pool that cannot connect).
//
// There is deliberately NO fallback: nothing here substitutes a local harness,
// a default project or a placeholder key when a variable is missing. An
// environment that is not configured does not start.
// ============================================================================

const SERVER_REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
] as const;

/** Values the browser is allowed to receive. Everything else is server-only. */
const PUBLIC_ALLOWED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

export type ServerEnvVar = (typeof SERVER_REQUIRED)[number];

function missing(names: readonly string[]): string[] {
  return names.filter((n) => !process.env[n] || process.env[n]!.trim() === "");
}

/**
 * Assert the whole server environment. Called by the credential factories, so
 * the first request against a misconfigured deployment says exactly what is
 * wrong instead of failing obscurely.
 */
export function requireServerEnv(): void {
  const absent = missing(SERVER_REQUIRED);
  if (absent.length > 0) {
    throw new Error(
      `Reiwa OS is not configured: missing ${absent.join(", ")}. ` +
      `Set these in the deployment environment — there is no default and no local fallback.`);
  }
}

/** Assert one variable, naming it. */
export function requireEnvVar(name: ServerEnvVar): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Reiwa OS is not configured: ${name} is not set. ` +
      `Set it in the deployment environment — there is no default and no local fallback.`);
  }
  return value;
}

/** The two values that may reach a browser, for the public Supabase client. */
export function publicSupabaseConfig(): { url: string; publishableKey: string } {
  return {
    url: requireEnvVar("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: requireEnvVar("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}

/** Names safe to expose. Used by the environment test, not at runtime. */
export const PUBLIC_ENV_ALLOWLIST: readonly string[] = PUBLIC_ALLOWED;
export const SERVER_ENV_REQUIRED: readonly string[] = SERVER_REQUIRED;
