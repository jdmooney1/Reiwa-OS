// ============================================================================
// Manual production smoke: do server actions work on each deployed host?
// ----------------------------------------------------------------------------
// MANUAL ONLY. See ./README.md and ./guard.ts.
//
// The diagnostic this preserves is narrow and was worth the scratch file it was
// written on. A Next.js server action is a POST to the same URL as the page, and
// it fails in a way nothing else does: the page renders perfectly, the form
// submits, and the POST comes back 4xx/5xx because of something between the
// browser and the server — a proxy stripping the action header, a deployment
// alias whose Host does not match what the build expects, a mismatched build id
// between a cached client bundle and the running server.
//
// None of that is reproducible locally, and none of it shows up as a broken
// page. So this records the POST status codes for two genuinely different
// actions — the investor code request and the staff sign-in — on each host it is
// given, and lets you compare a custom domain against a platform alias.
//
// Hosts come from PRODUCTION_SMOKE_HOSTS as a comma-separated list. There is no
// default and nothing is hard-coded: that was the original defect.
// ============================================================================
import { test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireProductionSmokeOptIn, requireFile } from "./guard";

requireProductionSmokeOptIn();

const HOSTS = requireFile("PRODUCTION_SMOKE_HOSTS")
  .split(",").map((h) => h.trim()).filter(Boolean);
const OUT_DIR = process.env.SMOKE_OUT_DIR ?? join(process.cwd(), ".smoke");

/**
 * A real investor address whose mailbox you can read. The code is never
 * redeemed here — this only records whether requesting one was ACCEPTED — but
 * the request does send a real email, so it must be an address you own.
 */
const INVESTOR_EMAIL = requireFile("SMOKE_INVESTOR_EMAIL");
const STAFF_EMAIL = requireFile("SMOKE_STAFF_EMAIL");
const STAFF_PASSWORD = requireFile("SMOKE_STAFF_PASSWORD");

mkdirSync(OUT_DIR, { recursive: true });

test("server actions respond on every deployed host", async ({ page }) => {
  const results: Record<string, unknown>[] = [];

  const postStatuses: number[] = [];
  page.on("response", (res) => {
    if (res.request().method() === "POST") postStatuses.push(res.status());
  });

  for (const host of HOSTS) {
    const record: Record<string, unknown> = { host };

    // 1. The investor one-time-code request.
    await page.goto(`${host}/portal/verify`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email address/i).fill(INVESTOR_EMAIL);
    postStatuses.length = 0;
    await page.getByRole("button", { name: /email me a secure access code/i }).click();
    await page.waitForTimeout(6000);
    record.otpActionPostStatuses = [...postStatuses];
    record.otpBody = (await page.locator("body").innerText()).slice(0, 90).replace(/\s+/g, " ");

    // 2. Staff sign-in — a different action, on a different route.
    await page.goto(`${host}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email/i).first().fill(STAFF_EMAIL);
    await page.getByLabel(/password/i).fill(STAFF_PASSWORD);
    postStatuses.length = 0;
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForTimeout(8000);
    record.signInPostStatuses = [...postStatuses];
    record.signInLanded = page.url();
    record.signInBody = (await page.locator("body").innerText()).slice(0, 90).replace(/\s+/g, " ");

    results.push(record);
    await page.context().clearCookies();
  }

  writeFileSync(join(OUT_DIR, "server-actions.json"), JSON.stringify(results, null, 2));
});
