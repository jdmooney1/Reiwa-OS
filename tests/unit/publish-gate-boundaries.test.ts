// Structural guards for the two things this change promises, so a later edit that
// quietly undoes either fails here rather than in front of an investor.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("the investor Overview boundary (migration 0033)", () => {
  const migrations = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const definitions = migrations
    .map((f) => ({ f, sql: read(`supabase/migrations/${f}`) }))
    .flatMap(({ f, sql }) => {
      const out: { f: string; body: string }[] = [];
      const re = /create or replace function app\.opportunity_publication_source[\s\S]*?\$fn\$;?[\s\S]*?\$fn\$/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql))) out.push({ f, body: m[0] });
      return out;
    });

  it("the latest definition reads investor_overview and never the internal summary", () => {
    const latest = definitions[definitions.length - 1];
    expect(latest.f).toBe("0033_investor_overview.sql");
    expect(latest.body).toContain("o.investor_overview");
    expect(latest.body).not.toMatch(/o\.summary/);
  });

  it("no later migration redefines the boundary to read the summary again", () => {
    for (const d of definitions.filter((x) => x.f > "0033")) expect(d.body).not.toMatch(/o\.summary/);
  });

  it("the data layer never copies `summary` into an investor-facing column", () => {
    const portal = read("src/lib/data/investor-portal.ts");
    expect(portal).not.toMatch(/\bsummary\b[^\n]*overview|overview[^\n]*\bsummary\b/);
  });
});

describe("publishing goes through the review gate", () => {
  const action = read("src/app/actions/admin-portal.ts");
  const publishBlock = action.slice(action.indexOf("export async function publishVersionAction("),
                                    action.indexOf("export async function saveInvestorOverviewAction"));

  it("the server action checks the confirmation before it publishes", () => {
    expect(publishBlock).toContain("confirmation");
    const gate = publishBlock.indexOf("assertPublishConfirmed(");
    const publish = publishBlock.indexOf("publishVersion(");
    expect(gate).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(gate);
  });

  it("returns a displayable result rather than throwing a message production would redact", () => {
    expect(publishBlock).toContain("runAction(");
  });

  it("only the review form calls the publish action", () => {
    const callers = walk("src").filter((f) => f !== "src/app/actions/admin-portal.ts")
      .filter((f) => read(f).includes("publishVersionAction"));
    expect(callers).toEqual(["src/components/admin/publish-review-form.tsx"]);
  });

  it("no other application code publishes a version directly", () => {
    const callers = walk("src").filter((f) => /\bpublishVersion(On)?\(/.test(read(f)))
      .filter((f) => !["src/lib/data/investor-portal.ts", "src/app/actions/admin-portal.ts", "src/lib/db/seed.ts"].includes(f));
    expect(callers).toEqual([]);
  });

  it("the publication screen links to the review instead of publishing", () => {
    const detail = read("src/components/admin/publication-detail.tsx");
    expect(detail).not.toContain("publishVersionAction");
    expect(detail).toContain("/publish/");
  });
});

describe("destructive admin buttons ask first", () => {
  /** The statement that runs `call` must sit after a window.confirm in the same handler. */
  function confirmedBefore(src: string, call: string): boolean {
    const at = src.indexOf(`${call}(`);
    if (at < 0) return false;
    const handlerStart = src.lastIndexOf("onClick={() => {", at);
    return handlerStart >= 0 && src.slice(handlerStart, at).includes("window.confirm(");
  }
  const detail = read("src/components/admin/publication-detail.tsx");
  const org = read("src/components/admin/investor-org-detail.tsx");

  it.each([
    ["withdraw", detail, "withdrawPublicationAction"],
    ["revoke access (publication)", detail, "revokeEntitlementAction"],
    ["remove document", detail, "removeDocumentAction"],
    ["revoke access (organisation)", org, "revokeEntitlementAction"],
    ["revoke invitation", org, "revokeInviteAction"],
  ])("%s", (_name, src, call) => {
    // The call used in a handler, not the import.
    const handlerCall = src.split("\n").findIndex((l) => l.includes(`${call}(`) && !l.includes("import"));
    expect(handlerCall).toBeGreaterThan(-1);
    expect(confirmedBefore(src, call)).toBe(true);
  });
});
