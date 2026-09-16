// ============================================================================
// What a normal Playwright run must never pick up.
// ----------------------------------------------------------------------------
// Shared by playwright.config.ts, which enforces it, and by
// tests/unit/playwright-discovery.test.ts, which proves it — a rule and its test
// reading the same constant rather than two copies that can drift apart.
//
// The history: three scratch specs with a production hostname compiled into them
// were written directly into e2e/. Playwright discovers everything under its
// testDir, and those specs overrode `baseURL`, so the test-database redirect
// that protects every other spec did not apply to them. `npm run test:e2e` would
// have driven production.
//
// Manual production-smoke tooling now lives in scripts/manual-production-smoke/,
// outside testDir entirely, which is the real fix. This is the second lock: a
// file dropped into e2e/ under one of these names is ignored, and the unit test
// fails the build for putting it there in the first place.
// ============================================================================

/** Names a normal run ignores, wherever they appear. */
export const NEVER_DISCOVER: readonly RegExp[] = [
  // Any leading-underscore file: the convention every one of the scratch specs
  // happened to follow, and a cheap way to mark something as not-a-real-spec.
  /(^|[\\/])_/,
  // Anything that names itself production smoke.
  /production-smoke/,
];

/** True if a normal Playwright run must refuse to discover this path. */
export function isUndiscoverable(path: string): boolean {
  return NEVER_DISCOVER.some((pattern) => pattern.test(path));
}
