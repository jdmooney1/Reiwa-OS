// ============================================================================
// Manual production smoke: the investor journey against a live deployment.
// ----------------------------------------------------------------------------
// MANUAL ONLY. See ./README.md and ./guard.ts. This is not part of
// `npm run test:e2e` and must never become part of it.
//
// What makes this worth keeping rather than deleting with the rest of the
// scratch work: it checks things the sandboxed UAT suite structurally cannot.
// The UAT suite drives a server it started itself, against a database it seeded
// itself, so it can prove the product behaves — but it cannot prove that a
// deployed build serves the markup you think you deployed, that server actions
// survive the real proxy, that a one-time code actually arrives in a real
// mailbox, that a signed document URL points at the storage host and carries a
// real token, or that internal surfaces stay closed to an investor session on
// the deployment rather than on localhost.
//
// The one-time code cannot be read by a machine: hosted Supabase emails it and
// keeps only a hash. So these specs WAIT for a human to drop the code into
// OTP_FILE. That is the manual part, and it is why this cannot be automated.
// ============================================================================
import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireProductionSmokeOptIn, requireFile } from "./guard";

const BASE = requireProductionSmokeOptIn();
const OUT_DIR = process.env.SMOKE_OUT_DIR ?? join(process.cwd(), ".smoke");
const OTP_FILE = requireFile("OTP_FILE");

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

mkdirSync(OUT_DIR, { recursive: true });

/** Findings are written continuously: a run that fails half way still reports. */
function recorder(name: string) {
  const findings: Record<string, unknown> = {};
  const path = join(OUT_DIR, `${name}.json`);
  return {
    findings,
    save: () => writeFileSync(path, JSON.stringify(findings, null, 2)),
  };
}

/** Wait for a human to paste the emailed code into OTP_FILE. */
async function waitForEmailedCode(timeoutMs = 600_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(OTP_FILE) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (!existsSync(OTP_FILE)) {
    throw new Error(
      `No one-time code appeared in ${OTP_FILE} within ${Math.round(timeoutMs / 1000)}s. ` +
      "Read it out of the mailbox and write it to that file.",
    );
  }
  return readFileSync(OTP_FILE, "utf8").trim();
}

/**
 * The full journey, entered the way a new investor enters it: through an
 * invitation link. ACCESS_URL comes from ./provision-contact.ts.
 */
test("investor journey, entered through an invitation", async ({ page }) => {
  const accessUrl = requireFile("ACCESS_URL");
  const { findings: r, save } = recorder("investor-journey");
  const shot = (name: string) => page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: true });

  // Any 5xx anywhere in the journey is a finding in itself.
  const serverErrors: string[] = [];
  page.on("response", (res) => {
    if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
  });

  await page.setViewportSize(DESKTOP);

  // ---- Invitation ----------------------------------------------------------
  await page.goto(accessUrl, { waitUntil: "domcontentloaded" });
  r.inviteUrl = page.url();
  r.inviteHeading = (await page.locator("h1").first().textContent())?.trim();
  r.inviteHasLockup = (await page.locator('img[alt="Reiwa Capital"]').count()) > 0;
  r.inviteBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await shot("1-invitation");
  save();

  // ---- One-time code, requested through the product ------------------------
  await page.getByRole("button", { name: /email me a secure access code/i }).click();
  const codeField = page.getByLabel(/access code/i);
  await expect(codeField).toBeVisible({ timeout: 60_000 });
  r.otpRequestedAt = new Date().toISOString();
  await shot("2-otp");
  save();

  await codeField.fill(await waitForEmailedCode());
  await page.getByRole("button", { name: /verify/i }).click();
  await page.waitForURL(
    (u) => u.pathname.startsWith("/portal") && !u.pathname.includes("verify"),
    { timeout: 90_000 });
  r.landedOn = page.url();
  save();

  // ---- Deployment fingerprint ---------------------------------------------
  // Markup that only exists at a known commit, so "is what I deployed what is
  // serving?" has an answer that is not a guess.
  await page.goto("/portal/saved", { waitUntil: "domcontentloaded" });
  r.savedRuleCount = await page.locator("article.border-t").count();
  await shot("3-saved");

  await page.goto("/portal", { waitUntil: "domcontentloaded" });
  r.opportunityLinks = await page.locator("a[href*='/portal/opportunities/']").count();
  r.portalTitle = await page.title();
  await shot("4-opportunities");
  save();

  // ---- Opportunity detail and secure document delivery ---------------------
  const href = await page.locator("a[href*='/portal/opportunities/']").first().getAttribute("href");
  expect(href, "the portal listed no opportunities").toBeTruthy();
  await page.goto(href!, { waitUntil: "domcontentloaded" });
  r.detailHeading = (await page.locator("h1").first().textContent())?.trim();
  r.documentCount = await page
    .locator("a[href*='/portal/documents/'], a:has-text('Download')").count();
  await shot("5-detail");

  const docHref = await page.locator("a[href*='/portal/documents/']").first()
    .getAttribute("href").catch(() => null);
  if (docHref) {
    const res = await page.request.get(`${BASE}${docHref}`, { maxRedirects: 0 });
    r.documentStatus = res.status();
    const location = res.headers()["location"] ?? "";
    r.documentSignedUrlHost = location ? new URL(location).host : "(none)";
    r.documentTokenIsJwt = location.includes("token=")
      ? (new URL(location).searchParams.get("token") ?? "").split(".").length === 3
      : false;
    if (location) {
      const file = await page.request.get(location);
      r.documentFetchStatus = file.status();
      r.documentBytes = (await file.body()).length;
    }
  }
  save();

  // ---- Compare, seeded the way the product seeds it ------------------------
  const ids = await page.locator("a[href*='/portal/opportunities/']").evaluateAll((els) => [
    ...new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!.split("/").pop()!)),
  ]);
  await page.addInitScript(
    (v) => window.localStorage.setItem("reiwa.portal.compare", JSON.stringify(v)), ids);
  await page.goto("/portal/compare", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("table")).toBeVisible({ timeout: 40_000 });
  r.compareColumns = await page.locator("thead th").count();
  await shot("6-compare");
  save();

  // ---- Internal surfaces must stay closed to this session ------------------
  const internal: Record<string, unknown>[] = [];
  for (const path of ["/admin", "/admin/publications", "/portfolio", "/pipeline"]) {
    const res = await page.goto(path, { waitUntil: "domcontentloaded" });
    internal.push({
      path,
      status: res?.status() ?? 0,
      landedOn: page.url(),
      text: (await page.locator("body").innerText()).slice(0, 80).replace(/\s+/g, " "),
    });
  }
  r.internal = internal;
  save();

  // ---- Horizontal overflow at both viewports -------------------------------
  const overflow: Record<string, unknown>[] = [];
  for (const [tag, viewport] of [["desktop", DESKTOP], ["mobile", MOBILE]] as const) {
    await page.setViewportSize(viewport);
    for (const path of ["/portal", "/portal/saved", "/portal/compare", href!]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
      overflow.push({
        viewport: tag,
        path,
        overflows: await page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth),
      });
    }
    if (tag === "mobile") await shot("7-compare-mobile");
  }
  r.overflow = overflow;
  r.serverErrors = serverErrors;
  save();

  expect(serverErrors, "the deployment returned 5xx responses").toEqual([]);
});

/**
 * The same sign-in, entered WITHOUT an invitation — straight at /portal/verify.
 *
 * A separate entry path, not a duplicate: an investor who already has an account
 * comes back this way, and it exercises the verify page's own server action
 * rather than the invitation route's.
 */
test("one-time code requested from the verify page alone", async ({ page }) => {
  const email = requireFile("SMOKE_INVESTOR_EMAIL");
  const { findings: r, save } = recorder("otp-only");

  await page.setViewportSize(DESKTOP);
  await page.goto("/portal/verify", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email address/i).fill(email);
  r.requestedAt = new Date().toISOString();
  await page.getByRole("button", { name: /email me a secure access code/i }).click();

  const codeField = page.getByLabel(/access code/i);
  await expect(codeField).toBeVisible({ timeout: 60_000 });
  save();

  await codeField.fill(await waitForEmailedCode());
  await page.getByRole("button", { name: /verify/i }).click();
  await page
    .waitForURL((u) => u.pathname.startsWith("/portal") && !u.pathname.includes("verify"),
      { timeout: 90_000 })
    .catch(() => { /* recorded below rather than thrown, so the finding is written */ });

  r.landedOn = page.url();
  r.verified = page.url().includes("/portal") && !page.url().includes("verify");
  r.pageText = (await page.locator("body").innerText()).slice(0, 200).replace(/\s+/g, " ");
  save();

  expect(r.verified, "the one-time code did not establish a session").toBe(true);
});
