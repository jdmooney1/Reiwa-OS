// ============================================================================
// A SEPARATE Playwright configuration, for manual production smoke only.
// ----------------------------------------------------------------------------
// Deliberately not a project inside the main config. A project would be one
// `--project` flag away from a normal run, and these specs talk to a live
// deployment. Two things keep them apart:
//
//   * they are outside the main config's testDir (./e2e), and its testIgnore
//     rejects these file names besides — see tests/unit/playwright-discovery
//     .test.ts, which asserts both;
//   * running them needs this config named explicitly on the command line AND
//     the opt-in in ./guard.ts.
//
// There is no webServer here: the whole point is that the server already exists
// somewhere else. Nothing is started, nothing is reset, and no database is
// touched by the specs themselves.
// ============================================================================
import { defineConfig } from "@playwright/test";
import { requireProductionSmokeOptIn } from "./guard";

// Refuses at config load, before a browser exists.
const baseURL = requireProductionSmokeOptIn();

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // A real deployment over the public internet, and one spec waits for a human
  // to read a code out of a mailbox.
  timeout: 900_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
});
