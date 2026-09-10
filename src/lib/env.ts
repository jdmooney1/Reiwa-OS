// ============================================================================
// Environment configuration (P6).
// ----------------------------------------------------------------------------
// Four variables are required and none has a default. That is the whole design.
//
// A fallback here would be the most dangerous line in the codebase: a default
// database URL, a default project URL, or a "if unset, use the local harness"
// branch means a misconfigured deployment does not fail — it comes up, looks
// healthy, and serves or writes the wrong data. Missing configuration must be
// loud, immediate and specific, not something discovered later from the data.
//
// So: no defaults, no `??` fallback, no development-only branch, and no
// reference anywhere in src/ to the local test harness. The harness in
// scripts/ is reached only by pointing these same variables at it deliberately,
// and it refuses to run against anything but localhost.
// ============================================================================

/** Every variable the application requires, and what it is for. */
export const REQUIRED_ENV = {
  DATABASE_URL:
    "Supabase PostgreSQL connection string (transaction pooler, port 6543).",
  NEXT_PUBLIC_SUPABASE_URL:
    "Supabase project URL, e.g. https://<project-ref>.supabase.co.",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    "Supabase publishable (anon) key. Safe in the browser; RLS protects the data.",
  SUPABASE_SECRET_KEY:
    "Supabase secret (service) key. SERVER ONLY — never expose to a client.",
} as const;

export type RequiredEnvName = keyof typeof REQUIRED_ENV;

/** The variables that must never reach a browser bundle. */
export const SERVER_ONLY_ENV: readonly string[] = [
  "DATABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_DB_CA_CERT",
  "DATABASE_POOL_MAX",
  // Outbound application email (investor invitations). Deliberately separate
  // from the Supabase credentials: revoking a mail key must not require
  // rotating database access.
  "RESEND_API_KEY",
  // The canonical portal origin used to compose invitation links. Server-only
  // and send-required: never derived from a request header, never public.
  "INVESTOR_PORTAL_URL",
];

/** Any environment-shaped map: process.env, or one a test constructs. */
export type EnvSource = Record<string, string | undefined>;

/** Which required variables are absent or blank. */
export function missingEnv(source: EnvSource = process.env): RequiredEnvName[] {
  return (Object.keys(REQUIRED_ENV) as RequiredEnvName[])
    .filter((name) => !source[name] || source[name]!.trim() === "");
}

/**
 * The message shown when configuration is incomplete. It lists EVERY missing
 * variable rather than the first, so a deployment is fixed in one pass instead
 * of one restart per variable, and it says what each one is for.
 */
export function missingEnvMessage(missing: RequiredEnvName[]): string {
  const lines = missing.map((name) => `  - ${name}: ${REQUIRED_ENV[name]}`);
  return [
    `Reiwa OS is not configured: ${missing.length} required environment ` +
    `variable${missing.length === 1 ? " is" : "s are"} missing.`,
    ...lines,
    "",
    "Set them in .env.local (development) or in the deployment's environment.",
    "There is no default and no fallback: the application will not start without them.",
  ].join("\n");
}

/**
 * Assert the environment is complete. Throws with the full list.
 *
 * Deliberately not "warn and continue": a half-configured deployment that keeps
 * running is how the wrong database gets written to.
 */
export function requireEnvironment(source: EnvSource = process.env): void {
  const missing = missingEnv(source);
  if (missing.length > 0) throw new Error(missingEnvMessage(missing));
}
