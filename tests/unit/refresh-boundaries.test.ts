import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("refresh from source keeps what a person wrote", () => {
  const action = read("src/app/actions/admin-portal.ts");
  const block = action.slice(action.indexOf("export async function startDraftFromSourceAction("),
                             action.indexOf("// Documents"));

  it("the action refreshes from a copy of the latest version, not from the whitelist alone", () => {
    expect(block).toContain("createDraftRefreshedFromSource(");
    expect(block).not.toContain("createPublicationFromOpportunity(");
  });

  it("only factual fields may be overwritten; headline, highlights, hold period are not among them", () => {
    const data = read("src/lib/data/admin-portal.ts");
    const fields = data.slice(data.indexOf("export const REFRESH_FIELDS"), data.indexOf("export interface RefreshedDraft"));
    for (const keep of ["headline", "highlights", "hold_period_years", "overview"]) {
      expect(fields).not.toMatch(new RegExp(`\\b${keep}\\b`));
    }
    for (const fact of ["title", "market", "city", "asset_type", "strategy", "currency", "headline_price", "target_niy", "target_irr", "target_equity_multiple"]) {
      expect(fields).toContain(fact);
    }
  });

  it("the overview is taken only when the source offers one, and never from the summary", () => {
    const data = read("src/lib/data/admin-portal.ts");
    const fn = data.slice(data.indexOf("export async function createDraftRefreshedFromSource"));
    expect(fn).toContain('take("overview", "overview")');
    expect(fn).not.toMatch(/\bsummary\b/);
    expect(fn).toContain("if (!(key in source)) return;"); // empty at the source never blanks the draft
  });
});
