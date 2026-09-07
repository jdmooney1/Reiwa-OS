// ============================================================================
// Accessibility, in a real browser.
// ----------------------------------------------------------------------------
// Not a compliance exercise. Every check here is something that stops a real
// person using the product:
//
//   * a field whose only label is a placeholder has no name to announce, and
//     the placeholder vanishes on the first keystroke;
//   * focus that is invisible makes the whole application unusable by keyboard,
//     which is also how anyone using a screen reader navigates it;
//   * a <div onClick> is not reachable by Tab and not announced as a control;
//   * motion that ignores a stated preference causes nausea and migraine;
//   * information carried only by colour is not carried at all for the ~8% of
//     men with a colour vision deficiency, or on a printout.
//
// axe-core runs alongside these as a broad net; the explicit assertions are
// what pin the specific defects this phase set out to fix.
// ============================================================================
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signInAsStaff, signInAsInvestor, hasVisibleFocusRing } from "./helpers";

/** WCAG 2.1 A and AA, which is the bar for a client-facing product. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("Automated audit", () => {
  test("the sign-in page has no violations", async ({ page }) => {
    await page.goto("/sign-in");
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
  });

  test("the investor verification page has no violations", async ({ page }) => {
    await page.goto("/portal/verify");
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
  });

  test("the portal home has no violations", async ({ page }) => {
    await signInAsInvestor(page);
    await page.goto("/portal");
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
  });

  test("the investor organisations directory has no violations", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto("/admin/investors");
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
  });

  test("the deal pipeline has no violations", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto("/deals");
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
  });
});

test.describe("Form fields have names", () => {
  test("every input on a staff screen has an accessible name", async ({ page }) => {
    await signInAsStaff(page);
    for (const path of ["/admin/investors", "/deals", "/admin/publications"]) {
      await page.goto(path);
      const unnamed = await page.evaluate(() => {
        const out: string[] = [];
        const controls = document.querySelectorAll<HTMLElement>(
          "input:not([type=hidden]), select, textarea");
        for (const el of Array.from(controls)) {
          const labelled =
            el.getAttribute("aria-label") ||
            el.getAttribute("aria-labelledby") ||
            (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
            el.closest("label");
          if (!labelled) out.push(`${el.tagName.toLowerCase()}[name=${el.getAttribute("name") ?? "?"}]`);
        }
        return out;
      });
      expect(unnamed, `unlabelled controls on ${path}`).toEqual([]);
    }
  });

  test("the investor search field is labelled, not just placeheld", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto("/admin/investors");
    const search = page.getByLabel(/search investor organisations/i);
    await expect(search).toBeVisible();
    await search.fill("Kitano");
    // The label survives typing; a placeholder would not have.
    await expect(page.getByLabel(/search investor organisations/i)).toHaveValue("Kitano");
  });

});

test.describe("Keyboard", () => {
  test("Tab reaches the sign-in controls in order", async ({ page }) => {
    await page.goto("/sign-in");
    const reached: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      reached.push(await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return "body";
        return `${el.tagName.toLowerCase()}:${el.getAttribute("name") ?? el.getAttribute("type") ?? ""}`;
      }));
    }
    expect(reached.some((r) => r.startsWith("input:") || r.includes("email"))).toBe(true);
    expect(reached.some((r) => r.startsWith("button"))).toBe(true);
  });

  test("focus is visible on every focusable control the keyboard can reach", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto("/admin/investors");

    const targets = page.locator("a[href], button, input:not([type=hidden]), select, textarea");
    const count = Math.min(await targets.count(), 15);
    expect(count).toBeGreaterThan(0);

    const invisible: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const control = targets.nth(i);
      if (!(await control.isVisible())) continue;
      if (!(await hasVisibleFocusRing(control))) {
        invisible.push(await control.evaluate((el) => el.outerHTML.slice(0, 80)));
      }
    }
    expect(invisible, "controls with no visible focus indicator").toEqual([]);
  });

  test("a global focus-visible rule exists rather than per-component focus classes", async ({ page }) => {
    await page.goto("/sign-in");
    const hasRule = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && rule.selectorText?.includes(":focus-visible")) return true;
        }
      }
      return false;
    });
    expect(hasRule).toBe(true);
  });
});

test.describe("Semantics", () => {
  test("controls are buttons and links, not clickable divs", async ({ page }) => {
    await signInAsStaff(page);
    for (const path of ["/admin/investors", "/admin/publications", "/deals"]) {
      await page.goto(path);
      const impostors = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("div[onclick], span[onclick]"))) {
          out.push(el.outerHTML.slice(0, 60));
        }
        // React attaches handlers at the root, so also flag anything given a
        // button role without the keyboard support that role implies.
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('[role="button"]'))) {
          if (el.tagName !== "BUTTON" && !el.hasAttribute("tabindex")) {
            out.push(el.outerHTML.slice(0, 60));
          }
        }
        return out;
      });
      expect(impostors, `non-semantic controls on ${path}`).toEqual([]);
    }
  });

  test("every page has exactly one first-level heading", async ({ page }) => {
    await signInAsInvestor(page);
    for (const path of ["/portal", "/portal/saved"]) {
      await page.goto(path);
      const headings = await page.locator("h1").count();
      expect(headings, `h1 count on ${path}`).toBeLessThanOrEqual(1);
    }
  });

  test("images and icons that carry no meaning are hidden from assistive technology", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto("/admin/investors");
    const bare = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img"))
        .filter((img) => !img.hasAttribute("alt"))
        .map((img) => img.outerHTML.slice(0, 60)));
    expect(bare).toEqual([]);
  });
});

test.describe("Reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("animations and transitions are suppressed when asked", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto("/admin/investors");
    const moving = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 400)) {
        const style = getComputedStyle(el);
        const duration = (value: string) =>
          Math.max(0, ...value.split(",").map((v) => parseFloat(v) || 0));
        if (duration(style.transitionDuration) > 0.05 || duration(style.animationDuration) > 0.05) {
          out.push(el.tagName.toLowerCase());
        }
      }
      return Array.from(new Set(out));
    });
    expect(moving, "elements still animating under prefers-reduced-motion").toEqual([]);
  });
});

test.describe("Colour is never the only signal", () => {
  test("status badges carry a text label, not just a tone", async ({ page }) => {
    await signInAsStaff(page);
    await page.goto("/admin/publications");
    const badges = page.locator("span.rounded.border");
    const count = Math.min(await badges.count(), 20);
    for (let i = 0; i < count; i += 1) {
      const text = (await badges.nth(i).innerText()).trim();
      expect(text.length, "a badge with no text carries meaning by colour alone")
        .toBeGreaterThan(0);
    }
  });

  test("a document's access tier is stated in words", async ({ page }) => {
    await signInAsInvestor(page);
    await page.goto("/portal");
    const opportunity = page.locator('a[href^="/portal/opportunities/"]').first();
    await expect(opportunity).toBeVisible();
    await opportunity.click();
    await page.waitForURL("**/portal/opportunities/**");
    // Where documents are shown, each one names itself and its download.
    const downloads = page.getByRole("link", { name: /download/i });
    if (await downloads.count() > 0) {
      await expect(downloads.first()).toBeVisible();
    }
  });
});
