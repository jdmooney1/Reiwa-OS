import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatPct, formatMultiple, toFixedHalfUp } from "@/lib/format";
import { figureText, opportunityMetrics, type PublicationFigures } from "@/lib/portal/metrics";
import type { PortalOpportunity } from "@/lib/data/portal-feed";

const base: PublicationFigures = {
  headlinePrice: 8_400_000, currency: "GBP", targetIrr: 13.5, targetNiy: 6.25,
  targetEquityMultiple: 1.9, holdPeriodYears: 5, sizeSqft: 21500, sizeSqm: null,
};

describe("the preview and the portal show the same figures", () => {
  it("an NIY of 6.25 reads 6.25% in the one place figures are formatted", () => {
    expect(figureText(base).targetNiy).toBe("6.25%");
  });

  it("the portal's metrics are built from figureText, value for value", () => {
    const o = { ...base, placement: "secondary" } as unknown as PortalOpportunity;
    const text = figureText(o);
    const byKey = Object.fromEntries(opportunityMetrics(o).map((m) => [m.key, m.value]));
    for (const key of Object.keys(text) as (keyof typeof text)[]) expect(byKey[key]).toBe(text[key]);
    const compact = Object.fromEntries(opportunityMetrics(o, { compact: true }).map((m) => [m.key, m.value]));
    expect(compact.headlinePrice).toBe(figureText(o, { compact: true }).headlinePrice);
  });

  it("the admin 'Investor view' formats nothing itself", () => {
    const src = readFileSync(join(process.cwd(), "src/components/admin/publication-detail.tsx"), "utf8");
    const view = src.slice(src.indexOf("title=\"Headline Figures\""), src.indexOf("Published\" v="));
    expect(view).toContain("figures.targetNiy");
    expect(view).not.toMatch(/formatPct|formatMoney|formatMultiple|formatArea|\.toFixed\(/);
  });

  it("missing figures read as an em dash, as the portal shows them", () => {
    const t = figureText({ ...base, targetNiy: null, holdPeriodYears: null, sizeSqft: null });
    expect([t.targetNiy, t.holdPeriodYears, t.size]).toEqual(["—", "—", "—"]);
  });
});

describe("halves round up as a person reads them", () => {
  it.each([
    [13.35, 1, "13.4"], [4.35, 1, "4.4"], [1.005, 2, "1.01"], [0.285, 2, "0.29"],
    [6.25, 1, "6.3"], [6.25, 2, "6.25"], [12.5, 1, "12.5"], [6.3, 1, "6.3"], [8, 2, "8.00"],
    [-1.25, 1, "-1.3"],
  ])("%s to %s dp is %s", (v, d, out) => expect(toFixedHalfUp(v, d)).toBe(out));

  it("formatPct and formatMultiple use it", () => {
    expect(formatPct(13.35, 1)).toBe("13.4%");
    expect(formatPct(null)).toBe("—");
    expect(formatMultiple(1.005)).toBe("1.01x");
    expect(formatMultiple(undefined)).toBe("—");
  });
});
