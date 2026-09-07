// Shared sign-in and assertion helpers for the real-browser UAT.
//
// Both sign-ins drive the actual UI rather than injecting a cookie: the point
// of this suite is that a person can get in, so the forms, the labels and the
// redirects are part of what is being tested.
import { expect, type Page, type Locator } from "@playwright/test";
import "../scripts/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Seeded staff and investor identities (src/lib/db/seed.ts). */
export const STAFF_EMAIL = "admin@reiwa.com";
export const STAFF_PASSWORD = "reiwa2026";
export const INVESTOR_EMAIL = "principal@kitano-fo.example";

/**
 * A genuine OTP for an address, minted through the Auth Admin API.
 *
 * Hosted Supabase emails the code and keeps only a hash, so a browser test
 * cannot read what "was sent". generateLink is the supported way to obtain a
 * real one; it is then typed into the real form and redeemed through the
 * ordinary verification path.
 */
async function mintOtp(email: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const code = data?.properties?.email_otp;
  if (error || !code) {
    throw new Error(`Could not mint an OTP for ${email}: ${error?.message ?? "no email_otp"}`);
  }
  return code;
}

export async function signInAsStaff(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(STAFF_EMAIL);
  await page.getByLabel(/password/i).fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });
}

export async function signInAsInvestor(page: Page): Promise<void> {
  await page.goto("/portal/verify");
  await page.getByLabel(/email address/i).fill(INVESTOR_EMAIL);
  await page.getByRole("button", { name: /access code/i }).click();

  // The form has moved to the code stage; the code itself comes from Auth.
  const codeField = page.getByLabel(/access code/i);
  await expect(codeField).toBeVisible();
  await codeField.fill(await mintOtp(INVESTOR_EMAIL));
  await page.getByRole("button", { name: /verify/i }).click();
  await page.waitForURL("**/portal", { timeout: 30_000 });
}

/**
 * The page must not scroll sideways. Measured against the documentElement
 * rather than body, and with a pixel of tolerance for sub-pixel rounding.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `page scrolls sideways: ${overflow.scrollWidth}px of content in ${overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/**
 * The offenders, when there are any — reported by name so a failure says what
 * to fix rather than just that something is wrong.
 *
 * An element inside a container that scrolls horizontally on purpose (a wide
 * table, a code block) is excluded: that is the correct treatment for wide
 * content, not a defect.
 */
export async function widestOffenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const describe = (el: Element): string => {
      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    const scrollsOnPurpose = (el: Element): boolean => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
      return false;
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (rect.right > limit + 1 && !scrollsOnPurpose(el)) out.push(describe(el));
    }
    return Array.from(new Set(out)).slice(0, 10);
  });
}

/** Whether an element shows a visible focus indicator when focused. */
export async function hasVisibleFocusRing(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    (el as HTMLElement).focus();
    const style = getComputedStyle(el);
    const outlineVisible =
      style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0;
    const shadowVisible = style.boxShadow !== "none" && style.boxShadow !== "";
    return outlineVisible || shadowVisible;
  });
}
