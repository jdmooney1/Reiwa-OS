// ============================================================================
// The Asset Snapshot as rendered. The point of these is the thing JD asked for by
// name: a template's placeholder text must never reach an investor copy. Rendered
// HTML, text content only (Tailwind's arbitrary-value classes contain brackets).
// ============================================================================
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetSnapshot } from "@/components/memo/asset-snapshot";
import { composeSnapshot, type ComposedSnapshot, type MemoSource } from "@/lib/memo/compose";
import { NO_ASSET, NO_PROJECTION, snapshotSource } from "./memo-source.fixture";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const render = (data: ComposedSnapshot, surface: "workspace" | "print") =>
  renderToStaticMarkup(createElement(AssetSnapshot, { data, surface }));

const FULL = composeSnapshot(snapshotSource());
const EMPTY = composeSnapshot(snapshotSource({
  basis: { kind: "none", case: null },
  opportunity: { ...snapshotSource().opportunity, sizeSqft: null, sizeSqm: null, projected: NO_PROJECTION },
  asset: NO_ASSET, fx: null, fxJpy: null,
}));
const PARTIAL = composeSnapshot(snapshotSource({
  basis: { kind: "working", case: { ...snapshotSource().basis.case!, occupancyPct: null, erv: null, capex: null, grossRentalIncome: null, status: "current" } },
  asset: { reference: null, addressLine: null, photoId: null },
  fxJpy: null,
}));

describe("no placeholder ever reaches the page", () => {
  const cases: [string, ComposedSnapshot][] = [["full", FULL], ["partial", PARTIAL], ["empty", EMPTY]];
  for (const surface of ["print", "workspace"] as const) {
    it.each(cases)(`${surface}: the %s snapshot has no bracket character and never says TBC`, (_n, data) => {
      const t = textOf(render(data, surface));
      expect(t).not.toMatch(/[\[\]]/);
      expect(t).not.toMatch(/TBC/i);
      expect(t).not.toMatch(/drop, or|browse files|Source:\s*$/);
    });
  }

  it("the composed data carries none either", () => {
    for (const [, d] of cases) {
      expect(JSON.stringify(d)).not.toMatch(/[\[\]]\s*[A-Za-z£¥0]|TBC/);
    }
  });
});

describe("a printed copy claims only what is recorded", () => {
  const t = textOf(render(FULL, "print"));

  it("shows every real figure, in the template's units, with the Japanese labels", () => {
    expect(t).toContain("£64.0M");
    expect(t).toContain("¥12.31B");                 // 64m / 0.0052
    expect(t).toContain("2.97%");
    expect(t).toContain("£2.05M");                   // passing rent
    expect(t).toContain("£2.20M");                   // ERV
    expect(t).toContain("93.1%");
    expect(t).toContain("£1.00M");                   // capex
    expect(t).toMatch(/42,000/);                     // sq ft
    expect(t).toMatch(/3,902/);                      // sq m
    expect(t).toMatch(/1,180/);                      // tsubo
    for (const ja of ["想定価格", "円換算", "純初期利回り", "現行賃料", "総面積", "想定賃料", "稼働率", "資本的支出", "所在地"]) expect(t).toContain(ja);
  });

  it("shows the header, the address and the FX line with its source and date", () => {
    expect(t).toContain("58 Queens Gate");
    expect(t).toContain("London, United Kingdom");
    expect(t).toContain("South Kensington");
    expect(t).toContain("Office");
    expect(t).toContain("Ref RC-LON-0012");
    expect(t).toContain("58 Queens Gate, London, SW7 5JW");
    expect(t).toMatch(/FX ¥192\.3 \/ £1\.00 \(ECB reference rate \(auto\), 27 Aug 2026\)/);
    expect(t).toContain("Source: Reiwa underwriting v3 (approved)");
    expect(t).toContain("Reiwa Capital does not provide tax or legal advice.");
  });

  it("does not claim anything the record cannot back: no WAULT, facts, notes, transport, map, allocation, or gap list", () => {
    for (const absent of ["WAULT", "REV. YIELD", "Property Facts", "Property Notes", "Transport", "Map", "Value Allocation", "Land Value", "Depreciation", "Not yet captured", "Build Year", "Tenure"]) {
      expect(t.toLowerCase(), absent).not.toContain(absent.toLowerCase());
    }
  });

  it("draws the cleared photograph from the staff-only delivery route", () => {
    const html = render(FULL, "print");
    expect(html).toContain('src="/api/asset-photos/11111111-1111-4111-8111-111111111111"');
  });

  it("the photograph block is simply absent when none is cleared", () => {
    const html = render({ ...FULL, photoId: null }, "print");
    expect(html).not.toContain("/api/asset-photos/");
    expect(html).not.toContain('data-block="photo"');
  });

  it("flags a stale rate in the FX line", () => {
    const stale = composeSnapshot(snapshotSource({ today: "2026-10-05" }));
    expect(textOf(render(stale, "print"))).toContain("This rate is 39 days old.");
    expect(textOf(render(FULL, "print"))).not.toContain("days old");
  });
});

describe("a sparse record prints as a shorter page, not a broken one", () => {
  it("drops every cell it has no figure for, and keeps the header, name and disclaimer", () => {
    const t = textOf(render(EMPTY, "print"));
    for (const dropped of ["PRICE GUIDANCE", "JPY EQUIVALENT", "NIY", "PASSING RENT", "TOTAL AREA", "ERV", "OCCUPANCY", "CAPEX", "Address", "Not yet captured"]) {
      expect(t, dropped).not.toContain(dropped);
    }
    expect(t).toContain("Asset Snapshot");
    expect(t).toContain("58 Queens Gate");
    expect(t).toContain("preliminary discussion purposes only");
    expect(t).not.toContain("FX ");
  });

  it("a partial record prints only the cells it has", () => {
    const t = textOf(render(PARTIAL, "print"));
    expect(t).toContain("PRICE GUIDANCE");
    expect(t).toContain("NIY");
    expect(t).not.toContain("JPY EQUIVALENT");
    expect(t).not.toContain("ERV");
    expect(t).not.toContain("OCCUPANCY");
    expect(t).toContain("working version, not yet approved");
  });
});

describe("the workspace shows the gaps so an author can see them", () => {
  it("marks each missing cell 'Not yet captured' and lists what the template wants and the record lacks", () => {
    const t = textOf(render(EMPTY, "workspace"));
    expect(t).toContain("Not yet captured");
    for (const label of ["Reversionary yield", "WAULT", "Property facts", "Property notes", "Transport", "Map", "Photograph", "Street address"]) {
      expect(t, label).toContain(label);
    }
  });

  it("explains why reversionary yield is not shown rather than substituting the exit yield", () => {
    const t = textOf(render(FULL, "workspace"));
    expect(t).toContain("exit yield, a different quantity");
    expect(t).not.toContain("4.50%");
  });
});
