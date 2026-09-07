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

const PORT = Number(process.env.UAT_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * This sandbox ships a Chromium that predates the one this Playwright pins, so
 * the browser is named explicitly rather than downloaded. On a machine with a
 * matching browser, PLAYWRIGHT_CHROMIUM_PATH is simply unset and Playwright
 * uses its own.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

const viewports = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
};

export default defineConfig({
  testDir: "./e2e",
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
  })),
  webServer: {
    // A production build, not `next dev`: dev serves unminified bundles, an
    // error overlay and no route headers, none of which ship.
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
