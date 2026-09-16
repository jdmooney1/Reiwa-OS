// ============================================================================
// Real-browser UAT (P6).
// ----------------------------------------------------------------------------
// The integration suite proves the database and the server behave. It says
// nothing about whether the result is usable: whether a table forces a phone
// sideways, whether a keyboard can reach a control, whether focus is visible
// when it gets there, whether a field a sighted user infers from an icon has a
// name a screen reader can announce.
//
// So these run against a PRODUCTION BUILD in a real Chromium, at the three
// viewports the audience actually uses:
//
//   Desktop 1440x900   the internal team's screen
//   Tablet   834x1112  an investor reading on an iPad
//   Mobile   390x844   an investor opening the emailed link on a phone
//
// Every spec runs at all three. A layout that only breaks at one width is the
// normal case, not the exception.
// ============================================================================
import { defineConfig, devices } from "@playwright/test";
import { useTestEnvironment } from "./tests/test-environment";
import { NEVER_DISCOVER } from "./playwright.discovery";

const PORT = Number(process.env.UAT_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * This sandbox ships a Chromium that predates the one this Playwright pins, so
 * the browser is named explicitly rather than downloaded. On a machine with a
 * matching browser, PLAYWRIGHT_CHROMIUM_PATH is simply unset and Playwright
 * uses its own.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

/**
 * Arm the dedicated test environment for THIS process, and refuse to define a
 * configuration at all if it is not available.
 *
 * Two processes matter here and both used to be wrong in a way that was easy to
 * miss, because the one that was handled looked like the only one.
 *
 *   The SERVER under test is started below, and its DATABASE_URL was already
 *   overridden. That part was right.
 *
 *   The RUNNER — this process, where the specs themselves execute — was not
 *   touched at all. e2e/helpers.ts mints one-time codes through the Auth Admin
 *   API, and e2e/investor-session.spec.ts creates Auth users, investor
 *   organisations and contacts directly. Both loaded .env.local and used the
 *   APPLICATION's project and the APPLICATION's database, so every UAT run wrote
 *   fixture identities into reiwa-dev.
 *
 * Playwright loads this config in the runner AND in each worker, so arming it at
 * module scope covers every process that executes a spec. The gate refuses
 * before any of it if the four test variables are missing or disagree.
 *
 * The reset opt-in is deliberately NOT required: Playwright never resets. It
 * expects a database the integration suite has already seeded. Demanding
 * ALLOW_TEST_DATABASE_RESET here would train everybody to export the destructive
 * flag permanently, which is the habit the gate exists to prevent.
 */
const testEnvironment = useTestEnvironment("connect");

const viewports = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
};

export default defineConfig({
  testDir: "./e2e",
  // Spread: the shared constant is readonly so nothing can append to the rule,
  // and Playwright's option type is a mutable array.
  testIgnore: [...NEVER_DISCOVER],
  // One shared database and one signed-in session per project.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "line" : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath },
  },
  projects: (Object.keys(viewports) as (keyof typeof viewports)[]).map((name) => ({
    name,
    use: { ...devices["Desktop Chrome"], viewport: viewports[name] },
    // The session spec launches its own persistent browser profile, so the
    // project viewport does not apply to it. Running it once is the point:
    // repeating it per viewport would prove nothing new and would race three
    // browsers on one fixture contact.
    //
    // A project-level testIgnore replaces the top-level one for that project, so
    // the never-discover patterns are repeated rather than assumed.
    testIgnore: name === "desktop"
      ? [...NEVER_DISCOVER]
      : [...NEVER_DISCOVER, /investor-session\.spec\.ts$/],
  })),
  webServer: {
    // A production build, not `next dev`: dev serves unminified bundles, an
    // error overlay and no route headers, none of which ship.
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    env: {
      ...process.env,
      // The server under test talks to the TEST database and the TEST Supabase
      // project, not the ones in .env.local. Next loads .env.local itself, but
      // variables already present in a child's environment win over a .env file,
      // so these overrides are what stop a UAT run writing rows to a development
      // database or creating Auth users and Storage objects in a development
      // project.
      //
      // This is the one place the application's own variable NAMES carry test
      // values, and it is not the same thing as a test rewriting the developer's
      // environment: this is the environment of a server process the harness is
      // starting, which exists only for the duration of the run and is a test
      // instance by construction. Nothing in .env.local is touched, and the
      // parent process keeps reading the application's values, which is what
      // lets the gate compare the two.
      DATABASE_URL: testEnvironment.databaseUrl,
      NEXT_PUBLIC_SUPABASE_URL: testEnvironment.supabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: testEnvironment.supabase.publishableKey,
      SUPABASE_SECRET_KEY: testEnvironment.supabase.secretKey,
    } as Record<string, string>,
    // A server already running on this port was started by somebody else and may
    // be pointed anywhere, so it is never reused: correctness of the target
    // database outranks a few seconds of start-up.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
