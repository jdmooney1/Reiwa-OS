// ============================================================================
// A normal Playwright run cannot discover production-smoke tooling.
// ----------------------------------------------------------------------------
// Three untracked specs — e2e/_prod.spec.ts, e2e/_prod2.spec.ts and
// e2e/_diag.spec.ts — sat inside Playwright's testDir with a production hostname
// compiled into them, and each one overrode `baseURL`. Playwright discovers
// everything under testDir, so `npm run test:e2e` would have driven production;
// and because they set their own baseURL, the test-database redirect that
// protects every other spec did not apply to them.
//
// The fix is structural: that tooling lives in scripts/manual-production-smoke/,
// outside testDir, behind an explicit opt-in. This test is what stops the fix
// decaying — the same three files could be written again tomorrow, by the same
// route, for the same reason, and the pressure to put them "just for now" in
// e2e/ is exactly what produced them the first time.
//
// No browser, no network, no Playwright run: this reads the repository.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isUndiscoverable, NEVER_DISCOVER } from "../../playwright.discovery";

const ROOT = join(__dirname, "..", "..");
const E2E = join(ROOT, "e2e");
const SMOKE = join(ROOT, "scripts", "manual-production-smoke");

/** Playwright's default: a file is a spec if it is named like one. */
const SPEC = /\.spec\.ts$/;

function filesIn(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts")) : [];
}

describe("the never-discover patterns", () => {
  it("reject every name the scratch specs actually used", () => {
    // The real file names, from the branch this was found on.
    for (const name of ["_prod.spec.ts", "_prod2.spec.ts", "_diag.spec.ts"]) {
      expect(isUndiscoverable(`e2e/${name}`), `${name} would be discovered`).toBe(true);
      expect(isUndiscoverable(`e2e\\${name}`), `${name} would be discovered on Windows`).toBe(true);
    }
  });

  it("reject anything that names itself production smoke", () => {
    expect(isUndiscoverable("e2e/production-smoke.spec.ts")).toBe(true);
    expect(isUndiscoverable("scripts/manual-production-smoke/investor-journey.spec.ts")).toBe(true);
  });

  it("do not reject the real suite", () => {
    for (const name of filesIn(E2E)) {
      expect(isUndiscoverable(`e2e/${name}`), `${name} is ignored but should run`).toBe(false);
    }
  });

  it("are a non-empty rule, so an empty list cannot pass this file silently", () => {
    expect(NEVER_DISCOVER.length).toBeGreaterThan(0);
  });
});

describe("the e2e directory itself", () => {
  it("contains no file a normal run must not discover", () => {
    const offenders = filesIn(E2E).filter((name) => isUndiscoverable(`e2e/${name}`));
    expect(offenders, "scratch files are in e2e/ again").toEqual([]);
  });

  it("contains no spec that points itself at an external origin", () => {
    // The property that made the scratch specs dangerous was not their name. It
    // was that they replaced the baseURL the config sets — the single place the
    // suite is aimed at a server the harness started.
    const offenders: string[] = [];
    for (const name of filesIn(E2E).filter((f) => SPEC.test(f))) {
      const source = readFileSync(join(E2E, name), "utf8");
      if (/test\.use\(\s*\{[^}]*baseURL/s.test(source)) offenders.push(`${name}: overrides baseURL`);
      // Any absolute http(s) origin that is not loopback.
      for (const [url] of source.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
        if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) offenders.push(`${name}: ${url}`);
      }
    }
    expect(offenders, "an e2e spec names a deployment").toEqual([]);
  });
});

describe("the manual production-smoke tooling", () => {
  it("lives outside the e2e directory", () => {
    expect(existsSync(SMOKE), "scripts/manual-production-smoke/ is missing").toBe(true);
    const specs = filesIn(SMOKE).filter((f) => SPEC.test(f));
    expect(specs.length, "there are no smoke specs to protect").toBeGreaterThan(0);
    for (const name of filesIn(E2E)) {
      expect(name).not.toMatch(/smoke/);
    }
  });

  it("would be ignored even if it were moved into e2e/", () => {
    for (const name of filesIn(SMOKE).filter((f) => SPEC.test(f))) {
      expect(isUndiscoverable(`e2e/${name}`) || isUndiscoverable(`scripts/manual-production-smoke/${name}`))
        .toBe(true);
    }
  });

  it("refuses to run without an explicit opt-in", () => {
    // Every runnable file here must pass through the guard at module scope, or
    // the directory's protection is a convention rather than a mechanism.
    const runnable = filesIn(SMOKE).filter((f) => f !== "guard.ts");
    expect(runnable.length).toBeGreaterThan(0);
    for (const name of runnable) {
      const source = readFileSync(join(SMOKE, name), "utf8");
      expect(source, `${name} does not require the opt-in`)
        .toMatch(/requireProductionSmokeOptIn/);
    }
  });

  it("hard-codes no deployment hostname", () => {
    // The original defect: the origin was in the source, so running the wrong
    // file was enough to reach production.
    for (const name of filesIn(SMOKE)) {
      const source = readFileSync(join(SMOKE, name), "utf8");
      const urls = [...source.matchAll(/https?:\/\/[^\s"'`)<]+/g)].map(([u]) => u)
        .filter((u) => !/^https?:\/\/(127\.0\.0\.1|localhost|<)/.test(u));
      expect(urls, `${name} hard-codes an origin`).toEqual([]);
    }
  });
});
