// ============================================================================
// Layout at the three viewports the audience actually uses.
// ----------------------------------------------------------------------------
// The single most common way a considered desktop layout fails is that one
// element — a wide table, a fixed-width toolbar, a long unbroken string — is
// wider than the screen, and the whole page scrolls sideways. On a phone that
// makes the content unreadable and the design look broken, which for an
// investor-facing document portal is the wrong first impression entirely.
//
// Wide content is allowed to scroll INSIDE its own container; that is the
// correct treatment. What is not allowed is the page scrolling.
// ============================================================================
import { test, expect } from "@playwright/test";
import {
  signInAsStaff, signInAsInvestor, expectNoHorizontalOverflow, widestOffenders,
} from "./helpers";

const INVESTOR_SCREENS = [
  { name: "portal home", path: "/portal" },
  { name: "saved opportunities", path: "/portal/saved" },
  { name: "comparison", path: "/portal/compare" },
];

const STAFF_SCREENS = [
  { name: "portfolio", path: "/portfolio" },
  { name: "pipeline", path: "/pipeline" },
  { name: "opportunities", path: "/opportunities/new" },
  { name: "admin overview", path: "/admin" },
  { name: "investor organisations", path: "/admin/investors" },
  { name: "publications", path: "/admin/publications" },
  { name: "activity", path: "/admin/activity" },
];

test.describe("Investor screens", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsInvestor(page);
  });

  for (const screen of INVESTOR_SCREENS) {
    test(`${screen.name} does not scroll sideways`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.locator("body")).toBeVisible();
      const offenders = await widestOffenders(page);
      expect(offenders, `elements wider than the viewport on ${screen.path}`).toEqual([]);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("an opportunity page does not scroll sideways", async ({ page }) => {
    await page.goto("/portal");
    const firstOpportunity = page.locator('a[href^="/portal/opportunities/"]').first();
    await expect(firstOpportunity).toBeVisible();
    await firstOpportunity.click();
    await page.waitForURL("**/portal/opportunities/**");
    expect(await widestOffenders(page)).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("Staff screens", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsStaff(page);
  });

  for (const screen of STAFF_SCREENS) {
    test(`${screen.name} does not scroll sideways`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.locator("body")).toBeVisible();
      const offenders = await widestOffenders(page);
      expect(offenders, `elements wider than the viewport on ${screen.path}`).toEqual([]);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("a publication detail page does not scroll sideways", async ({ page }) => {
    await page.goto("/admin/publications");
    const first = page.locator('a[href^="/admin/publications/"]').first();
    await expect(first).toBeVisible();
    await first.click();
    await page.waitForURL("**/admin/publications/**");
    expect(await widestOffenders(page)).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("Unauthenticated screens", () => {
  for (const path of ["/sign-in", "/portal/verify", "/access"]) {
    test(`${path} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();
      expect(await widestOffenders(page)).toEqual([]);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("the sign-in page ships no demonstration credentials in a production build", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByText(/demo accounts/i)).toHaveCount(0);
    await expect(page.getByLabel(/email/i)).toHaveValue("");
    await expect(page.getByLabel(/password/i)).toHaveValue("");
  });
});
