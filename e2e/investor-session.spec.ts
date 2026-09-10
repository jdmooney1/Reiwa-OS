// ============================================================================
// Investor session persistence, in a REAL persistent browser profile.
// ----------------------------------------------------------------------------
// The claim: an investor enters a one-time code once per browser, not once per
// visit. Everything else in the suite uses Playwright's default context, which
// is effectively a private window — it has no profile on disk and forgets
// everything the moment it closes. That is exactly the wrong instrument for
// proving persistence, because it cannot tell "the cookie was never persistent"
// apart from "the browser was thrown away".
//
// So this spec launches a persistent context against a real user-data
// directory, closes the whole browser, and reopens the same profile. That is
// what "closed my laptop and came back after lunch" actually looks like.
//
// What is NOT relaxed by any of this:
//   * authorisation is re-derived from the database on every protected request
//     (resolveIdentity -> loadPortalIdentity), so a cookie is proof of WHO, and
//     never of WHAT they may see;
//   * a deactivated contact, a suspended organisation or a revoked entitlement
//     takes effect on the very next request, cookie or no cookie — the last
//     test here holds a valid session and proves it.
// ============================================================================
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintOtp } from "./helpers";
import "../scripts/env";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import {
  createInvestorOrganization, createInvestorContact, updateInvestorContact,
} from "@/lib/data/investor-portal";
import { adminQuery } from "@/lib/db/client";

/**
 * These tests launch their OWN browser (a persistent profile), so the project's
 * page fixture and viewport are not used. Running them once is the point —
 * repeating them per viewport would prove nothing new and would race on the
 * shared fixture contact. Responsive coverage of the investor flow lives in
 * responsive.spec.ts, which does run at all three viewports.
 */
test.describe.configure({ mode: "serial" });

const BASE = process.env.UAT_BASE_URL ?? `http://127.0.0.1:${process.env.UAT_PORT ?? 3100}`;
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

/**
 * A fixture investor of this spec's own, so deactivating them at the end
 * cannot disturb the seeded data other specs rely on.
 */
const FIXTURE_EMAIL = "session@p6-session.example";
let fixtureContactId: string;
let profileDir: string;

/** The admin session shape used by the data layer (see tests/helpers.ts). */
const ADMIN = {
  userId: "00000000-0000-0000-0000-000000000000",
  orgIds: [] as string[],
  role: "reiwa_admin" as const,
  canWrite: true,
};

async function openProfile(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir, {
    executablePath: EXECUTABLE,
    viewport: { width: 1440, height: 900 },
  });
}

/** Drive the real OTP flow in whatever page is given. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/portal/verify`);
  await page.getByLabel(/email address/i).fill(FIXTURE_EMAIL);
  await page.getByRole("button", { name: /access code/i }).click();
  const code = page.getByLabel(/access code/i);
  await expect(code).toBeVisible();
  await code.fill(await mintOtp(FIXTURE_EMAIL));
  await page.getByRole("button", { name: /verify/i }).click();
  await page.waitForURL("**/portal", { timeout: 30_000 });
}

test.beforeAll(async () => {
  profileDir = mkdtempSync(join(tmpdir(), "reiwa-investor-profile-"));

  const supabase = createSupabaseAdminClient();
  const authUserId = await ensureAuthUser(supabase, {
    email: FIXTURE_EMAIL, password: "unused-otp-only", name: "S. Session",
  });

  const existing = await adminQuery<{ investor_contact_id: string }>(
    "select investor_contact_id from investor_contacts where lower(email) = lower($1)",
    [FIXTURE_EMAIL]);

  if (existing[0]) {
    fixtureContactId = existing[0].investor_contact_id;
    // A previous run may have left them deactivated.
    await updateInvestorContact(ADMIN, fixtureContactId, { isActive: true });
  } else {
    const orgId = await createInvestorOrganization(ADMIN, {
      name: "P6 Session Partners", notes: "Created by e2e/investor-session.spec.ts.",
    });
    fixtureContactId = await createInvestorContact(ADMIN, {
      investorOrgId: orgId, email: FIXTURE_EMAIL, name: "S. Session", authUserId,
    });
  }
});

test.afterAll(async () => {
  // Leave the fixture active so a re-run starts from a clean state.
  if (fixtureContactId) await updateInvestorContact(ADMIN, fixtureContactId, { isActive: true });
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
});

// ============================================================================
test("1. verifying the one-time code establishes the investor session", async () => {
  const context = await openProfile();
  try {
    const page = await context.newPage();
    await signIn(page);
    await expect(page).toHaveURL(/\/portal$/);

    // The session is a real cookie, and it is PERSISTENT: a cookie with no
    // expiry is discarded when the browser closes, which is the whole
    // difference between "signed in" and "signed in until I come back".
    const cookies = await context.cookies();
    const auth = cookies.filter((c) => /^sb-/.test(c.name));
    expect(auth.length, "no Supabase auth cookie was written").toBeGreaterThan(0);
    for (const cookie of auth) {
      expect({ name: cookie.name, sessionOnly: cookie.expires === -1 })
        .toEqual({ name: cookie.name, sessionOnly: false });
      expect(cookie.path).toBe("/");
      expect(cookie.sameSite).toBe("Lax");
    }
  } finally {
    await context.close();
  }
});

// ============================================================================
test("2. /portal opens on a later request with no second code", async () => {
  const context = await openProfile();
  try {
    const page = await context.newPage();
    // Straight to the portal: no visit to /portal/verify at all.
    await page.goto(`${BASE}/portal`);
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
    // ...and the code field is nowhere on the page.
    await expect(page.getByLabel(/access code/i)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

// ============================================================================
test("3. refreshing the page keeps the investor signed in", async () => {
  const context = await openProfile();
  try {
    const page = await context.newPage();
    await page.goto(`${BASE}/portal`);
    await page.reload();
    await page.reload();
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  } finally {
    await context.close();
  }
});

// ============================================================================
test("4. closing the browser and reopening the same profile still works", async () => {
  // The profile has been closed and reopened three times by now; do it once
  // more explicitly and walk the investor's actual destinations.
  const context = await openProfile();
  try {
    const page = await context.newPage();
    for (const path of ["/portal", "/portal/saved", "/portal/compare"]) {
      await page.goto(`${BASE}${path}`);
      await expect(page, `${path} bounced to the code screen`).not.toHaveURL(/\/portal\/verify/);
      await expect(page.getByLabel(/access code/i)).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});

// ============================================================================
test("5. an inactive investor is refused even though the cookie is still valid", async () => {
  const context = await openProfile();
  try {
    const page = await context.newPage();
    // Still signed in from the persisted profile.
    await page.goto(`${BASE}/portal`);
    await expect(page).toHaveURL(/\/portal$/);

    // Deactivate the contact behind their back. The Auth cookie is untouched
    // and still cryptographically valid — only the database has changed.
    await updateInvestorContact(ADMIN, fixtureContactId, { isActive: false });

    await page.goto(`${BASE}/portal`);
    await expect(page, "a deactivated contact kept portal access").toHaveURL(/\/portal\/verify/);

    // Every investor surface, not just the home page.
    for (const path of ["/portal/saved", "/portal/compare"]) {
      await page.goto(`${BASE}${path}`);
      await expect(page).toHaveURL(/\/portal\/verify/);
    }

    await updateInvestorContact(ADMIN, fixtureContactId, { isActive: true });
  } finally {
    await context.close();
  }
});

// ============================================================================
test("6. signing out ends the session for good", async () => {
  const context = await openProfile();
  try {
    const page = await context.newPage();

    // Test 5 reactivated the contact, and the persisted cookie was never
    // touched — so access is back immediately, with no new code. That is the
    // same re-derivation working in the other direction.
    await page.goto(`${BASE}/portal`);
    await expect(page, "reactivating the contact did not restore access")
      .toHaveURL(/\/portal$/);

    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL("**/portal/verify", { timeout: 30_000 });

    // The portal is closed again...
    await page.goto(`${BASE}/portal`);
    await expect(page).toHaveURL(/\/portal\/verify/);
  } finally {
    await context.close().catch(() => {});
  }

  // ...and it stays closed after reopening the profile, so sign-out really
  // cleared the persisted cookie rather than just this tab's memory.
  const reopened = await openProfile();
  try {
    const later = await reopened.newPage();
    await later.goto(`${BASE}/portal`);
    await expect(later, "sign-out did not clear the persisted session")
      .toHaveURL(/\/portal\/verify/);
  } finally {
    await reopened.close().catch(() => {});
  }
});
