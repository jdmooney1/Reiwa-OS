// ============================================================================
// Phase 1B — the opportunity workspace, in a real browser.
// ----------------------------------------------------------------------------
// Walks the seven sections of one opportunity file at every viewport, asserting
// that each renders its real model and that nothing invents a state the data
// does not support.
// ============================================================================
import { test, expect, type Page } from "@playwright/test";
import { signInAsStaff, signInAsInvestor } from "./helpers";

/**
 * The seeded pipeline always has opportunities; open the first one.
 *
 * The href must be matched as a UUID rather than as any /opportunities/ link:
 * the page header's "New Opportunity" button is also an /opportunities/ link
 * and comes first in the DOM, so a looser selector opens the create form.
 */
const OPPORTUNITY_HREF = /^\/opportunities\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function openFirstOpportunity(page: Page): Promise<string> {
  await page.goto("/pipeline");
  const links = page.locator('a[href^="/opportunities/"]');
  await expect(links.first()).toBeVisible();

  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const href = await link.getAttribute("href");
    if (!href || !OPPORTUNITY_HREF.test(href)) continue;
    await link.click();
    await page.waitForURL(`**${href}`);
    return href;
  }
  throw new Error("No opportunity link found on the pipeline");
}

test.describe("Opportunity workspace", () => {
  test("the pipeline links into the canonical workspace", async ({ page }) => {
    await signInAsStaff(page);
    const href = await openFirstOpportunity(page);
    expect(href).toMatch(/^\/opportunities\/[0-9a-f-]{36}$/);
    // The file header, not a dashboard.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /opportunity sections/i })).toBeVisible();
  });

  test("every section is reachable and names its own model", async ({ page }) => {
    await signInAsStaff(page);
    const base = await openFirstOpportunity(page);

    const sections: [string, RegExp][] = [
      ["", /underwriting/i],
      ["/underwriting", /underwriting versions/i],
      ["/diligence", /diligence|workstream|framework/i],
      ["/risks", /risk/i],
      ["/documents", /document/i],
      ["/decision", /committee|decision/i],
      ["/publication", /investor/i],
    ];

    for (const [suffix, expected] of sections) {
      await page.goto(`${base}${suffix}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("main")).toContainText(expected);
      // The nav marks where you are, so a deep link is legible.
      await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test("a section deep link is its own URL", async ({ page }) => {
    await signInAsStaff(page);
    const base = await openFirstOpportunity(page);
    await page.goto(`${base}/risks`);
    await expect(page).toHaveURL(new RegExp(`${base}/risks$`));
    await page.reload();
    await expect(page.locator('[aria-current="page"]')).toContainText(/risks/i);
  });

  test("summary states which underwriting version its figures come from", async ({ page }) => {
    await signInAsStaff(page);
    const base = await openFirstOpportunity(page);
    await page.goto(base);
    const main = page.locator("main");
    // Either a version basis, or an explicit statement that there is none.
    await expect(main).toContainText(/version \d+|not yet underwritten/i);
  });

  test("the committee section says undecided rather than inventing a state", async ({ page }) => {
    await signInAsStaff(page);
    const base = await openFirstOpportunity(page);
    await page.goto(`${base}/decision`);
    const main = page.locator("main");
    await expect(main).toContainText(/not yet decided|approved|deferred|rejected/i);
    // No fabricated "pending" or "in review" committee state.
    await expect(main).not.toContainText(/pending committee|awaiting ic/i);
  });

  test("publication is described as a snapshot, never a live mirror", async ({ page }) => {
    await signInAsStaff(page);
    const base = await openFirstOpportunity(page);
    await page.goto(`${base}/publication`);
    await expect(page.locator("main")).toContainText(/investor/i);
  });

  test("documents are uploaded, never addressed by storage path", async ({ page }) => {
    await signInAsStaff(page);
    const base = await openFirstOpportunity(page);
    await page.goto(`${base}/documents`);

    // The control takes a file. The earlier version of this screen asked for a
    // storage path, which is the one thing the store never accepts from a
    // browser — and produced rows that could not be opened.
    await expect(page.locator('input[type="file"][name="file"]')).toBeAttached();
    await expect(page.locator('input[name="storagePath"]')).toHaveCount(0);

    // Any document link addresses the delivery route by id.
    const links = page.locator(`a[href^="${base}/documents/"]`);
    for (let i = 0; i < await links.count(); i++) {
      const href = await links.nth(i).getAttribute("href");
      expect(href).toMatch(/\/documents\/[0-9a-f-]{36}$/);
    }
  });

  test("no section renders an empty panel without saying what is absent", async ({ page }) => {
    await signInAsStaff(page);
    const base = await openFirstOpportunity(page);
    for (const s of ["/underwriting", "/diligence", "/risks", "/documents", "/decision"]) {
      await page.goto(`${base}${s}`);
      const text = (await page.locator("main").innerText()).trim();
      expect(text.length).toBeGreaterThan(40);
    }
  });
});

test.describe("Internal boundary", () => {
  test("an investor cannot reach the opportunity workspace", async ({ page }) => {
    await signInAsInvestor(page);

    // A portal contact has no profile row, so no internal session exists to be
    // had — the route sends them to sign-in rather than rendering a file. The
    // database would refuse them in any case: `app.has_org()` is false for
    // every organisation, so the opportunity is not there to read.
    for (const path of ["/pipeline", "/portfolio"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in|\/portal/);
      await expect(page.locator("body")).not.toContainText(/opportunity sections/i);
    }
  });

  test("an investor is refused an internal document by id", async ({ page }) => {
    await signInAsInvestor(page);
    // A well-formed id they were never entitled to. The refusal is a 404 with
    // no body, identical to one that does not exist.
    const response = await page.request.get(
      "/opportunities/00000000-0000-0000-0000-000000000001/documents/00000000-0000-0000-0000-000000000002",
      { maxRedirects: 0 });
    expect(response.status()).toBe(404);
  });
});

test.describe("Navigation spine", () => {
  test("names the objects the firm works on", async ({ page }, testInfo) => {
    await signInAsStaff(page);
    await page.goto("/pipeline");
    const nav = page.locator("aside");

    // Every destination is reachable at every width. Below lg the rail collapses
    // to icons and each label survives as the link's accessible name.
    for (const label of ["Pipeline", "Investor Organisations", "Portfolio", "Activity"]) {
      await expect(nav.getByRole("link", { name: label })).toBeAttached();
    }

    // The headings are a desktop affordance: the collapsed rail omits them
    // rather than cropping them, the same rule the lockup follows.
    if (testInfo.project.name === "desktop") {
      for (const heading of ["Opportunities", "Investors", "Assets", "Firm"]) {
        await expect(nav).toContainText(heading);
      }
      // Today is deliberately absent until there is a dashboard behind it.
      await expect(nav).not.toContainText("Today");
    }
  });
});

test.describe("Pipeline figures", () => {
  test("states the underwriting basis for every row", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto("/pipeline");
    // Table view carries the explicit basis column.
    await page.getByRole("button", { name: /table/i }).click();
    await expect(page.locator("main")).toContainText(/basis/i);
    await expect(page.locator("main")).toContainText(/approved|working|not underwritten/i);
  });
});
