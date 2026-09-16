// ============================================================================
// The opt-in every tool in this directory passes through.
// ----------------------------------------------------------------------------
// What lives here talks to a REAL DEPLOYMENT. It signs in, requests one-time
// codes that are really emailed, downloads real documents and — in the case of
// provision-contact.ts — writes a real investor contact and a real invitation
// token into whatever database it is pointed at.
//
// These began life as three untracked scratch specs inside e2e/, with the
// production hostname compiled into them. That is a bad place for them twice
// over: Playwright discovers everything in its testDir, so `npm run test:e2e`
// would have run them against production; and a hard-coded host means the
// safest possible mistake — running the wrong file — is also the most damaging.
//
// So both properties are inverted here. Nothing in this directory is reachable
// from the normal suite (it is outside e2e/, and playwright.config.ts ignores
// these names besides), and nothing runs without being told, explicitly and
// twice: once that production smoke is permitted at all, and once which origin
// to talk to. There is no default origin and there is no fallback.
// ============================================================================

/** The opt-in flag, and the only value that counts as set. */
export const OPT_IN = "ALLOW_PRODUCTION_SMOKE";

/** The origin to exercise. No default: naming the target is part of the opt-in. */
export const TARGET = "PRODUCTION_SMOKE_BASE_URL";

/**
 * Refuse unless this run was asked for deliberately, and return the origin.
 *
 * Called at module scope by every spec and script here, so a refusal happens
 * before a browser is launched or a connection is opened.
 */
export function requireProductionSmokeOptIn(): string {
  if (process.env[OPT_IN] !== "true") {
    throw new Error(
      [
        "Refusing to run production smoke tooling: it was not asked for.",
        "",
        `  Reason: ${OPT_IN} is not "true".`,
        "",
        "This tooling drives a real deployment: it signs in, triggers real",
        "one-time-code emails and can create real invitation data. It is never",
        "part of `npm run test:e2e` and is never run automatically.",
        "",
        "To run it deliberately:",
        `  ${OPT_IN}=true ${TARGET}=https://<origin> \\`,
        "    npx playwright test --config scripts/manual-production-smoke/playwright.config.ts",
        "",
        "See scripts/manual-production-smoke/README.md.",
      ].join("\n"),
    );
  }

  const target = (process.env[TARGET] ?? "").trim();
  if (target === "") {
    throw new Error(
      [
        "Refusing to run production smoke tooling: no target origin.",
        "",
        `  Reason: ${TARGET} is not set.`,
        "",
        "The origin is never hard-coded here and has no default: naming the",
        "deployment you mean to touch is part of asking for the run.",
      ].join("\n"),
    );
  }

  let origin: URL;
  try {
    origin = new URL(target);
  } catch {
    throw new Error(`${TARGET} is not a valid absolute URL.`);
  }
  if (origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") {
    throw new Error(`${TARGET} must be a bare origin, with no path, query or fragment.`);
  }
  return origin.origin;
}

/** A required file path argument, so a spec fails at start rather than at the end. */
export function requireFile(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value === "") throw new Error(`${name} is not set (see README.md).`);
  return value;
}
