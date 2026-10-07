// ============================================================================
// What an investor reads: one standard figures line, no internal voice, no
// placeholder exchange rate.
// ----------------------------------------------------------------------------
// Two decisions, applied everywhere rather than case by case:
//
//   1. A rate that is still a demonstration value is never shown to an investor, not
//      even labelled "indicative". The yen figures that rest on it are dropped.
//   2. Every investor-facing figure carries ONE line, "Indicative, subject to final
//      underwriting", in place of any description of how the figure was produced
//      ("based on unapproved underwriting", "working version", a committee).
//
// The string checks below are textual and run over the source, the way the
// earlier boundary tests do: the literals that were removed must not come back
// onto an investor surface, and a new investor surface must be added to the list.
// ============================================================================
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  composeMemo, composeSnapshot, resolveSection, withoutPlaceholderFx, showsFigures, figuresLine,
  type ComposedSnapshot, type MemoSource,
} from "@/lib/memo/compose";
import { isPlaceholderFxSource } from "@/lib/fx";
import { INVESTOR_FIGURES_DISCLAIMER } from "@/lib/investor-copy";
import { AssetSnapshot } from "@/components/memo/asset-snapshot";
import { SectionBody } from "@/components/memo/memo-blocks";
import { ProspectDocument } from "@/components/deal-share/prospect-document";
import { prospectSnapshot, prospectTeaser } from "@/lib/deal-share/document";
import { buildTranslationSource } from "@/lib/memo-translation/source";
import { SNAP_CASE, snapshotSource } from "./memo-source.fixture";

const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const read = (r: string) => readFileSync(join(ROOT, r), "utf8").replace(/\r\n/g, "\n");
/** Source with comments and import lines removed: what could be rendered or sent. */
const code = (r: string) => read(r)
  .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
  .replace(/^\s*import\b[\s\S]*?;\s*$/gm, "");
const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(rel(p));
  }
  return out;
}

/** Every file whose output an investor, or a prospect, reads. Add a new surface here. */
const INVESTOR_SURFACES = [
  ...walk(join(ROOT, "src/app/(portal)")),
  ...walk(join(ROOT, "src/app/(prospect)")),
  ...walk(join(ROOT, "src/components/portal")),
  ...walk(join(ROOT, "src/components/deal-share")),
  ...walk(join(ROOT, "src/lib/portal")),
  ...walk(join(ROOT, "src/lib/deal-share")),
  ...walk(join(ROOT, "src/lib/email")),
  "src/components/memo/asset-snapshot.tsx",
  "src/components/memo/memo-blocks.tsx",
  "src/components/shared/figure-disclaimer.tsx",
  "src/lib/memo/render.ts",
  "src/lib/memo-translation/source.ts",
  "src/lib/portal-labels.ts",
  "src/lib/investor-copy.ts",
];

describe("the standard line", () => {
  it("is exactly the wording that was decided, in one place", () => {
    expect(INVESTOR_FIGURES_DISCLAIMER).toBe("Indicative, subject to final underwriting");
    const definitions = walk(join(ROOT, "src")).filter((f) => code(f).includes("Indicative, subject to final underwriting"));
    expect(definitions).toEqual(["src/lib/investor-copy.ts"]);
  });
});

describe("the internal-voice originals are gone from every investor surface", () => {
  const INTERNAL_VOICE =
    /unapproved|not (yet )?approved|working version|committee|underwriting v\d|\(approved\)|demonstration|demo static|\bTBC\b|\bTBD\b|approved investment|approved for release|approved investment publication/i;

  it.each(INVESTOR_SURFACES)("%s says nothing about approval state, underwriting versions or committees", (f) => {
    expect(code(f)).not.toMatch(INTERNAL_VOICE);
  });

  it("the only underwriting wording an investor surface can reach is the standard line, imported not retyped", () => {
    for (const f of INVESTOR_SURFACES.filter((s) => s !== "src/lib/investor-copy.ts")) {
      expect(code(f), f).not.toMatch(/underwrit/i);
    }
  });

  it("the removed literals survive only in the internal places that still need them", () => {
    const where = (literal: string) => walk(join(ROOT, "src")).filter((f) => read(f).includes(literal)).sort();
    // A flag on the INTERNAL memo (and the composed record behind it) and the staff banner above the document.
    expect(where("Based on unapproved underwriting")).toEqual(["src/components/memo/memo-workspace.tsx", "src/lib/memo/compose.ts"]);
    // ...and the staff-only AI review prompt, which reads the internal memo.
    expect(where("working version, not approved")).toEqual(
      ["src/components/memo/memo-workspace.tsx", "src/lib/memo-review/prompt.ts", "src/lib/memo/compose.ts"]);
    expect(where("working version, not yet approved")).toEqual(["src/lib/memo/compose.ts"]);
    // Gone altogether.
    for (const gone of [
      "approved investment publication", "figures approved for release", "Approved investment metrics",
      "Source: {data.basisLabel}", "Source: {b.source}{b.audience", "finalised ${formatDate(teaser.finalizedAt)}",
    ]) {
      const hits = where(gone).filter((f) => f !== "src/components/memo/memo-blocks.tsx" || gone !== "Source: {b.source}{b.audience");
      expect(hits, gone).toEqual([]);
    }
  });

  it("the snapshot never draws the stored source label", () => {
    expect(code("src/components/memo/asset-snapshot.tsx")).not.toContain("basisLabel");
  });
});

describe("every surface that shows an investor a figure carries the line", () => {
  const uses = (f: string) => code(f).includes("<FigureDisclaimer") || code(f).includes("INVESTOR_FIGURES_DISCLAIMER");
  it.each([
    "src/app/(portal)/portal/opportunities/[publicationId]/page.tsx",   // the investment snapshot
    "src/components/portal/opportunity-cards.tsx",                       // featured figures and card figures
    "src/app/(portal)/portal/compare/page.tsx",                          // the comparison table
    "src/components/admin/publication-detail.tsx",                       // the preview of what the portal shows
    "src/components/memo/asset-snapshot.tsx",                            // the snapshot sheet
    "src/components/memo/memo-blocks.tsx",                               // teaser sections that print figures
    "src/components/deal-share/prospect-document.tsx",                   // the prospect's footer
    "src/app/(print)/opportunities/[opportunityId]/memo/print/page.tsx", // the printed footer
  ])("%s", (f) => {
    expect(uses(f), f).toBe(true);
  });

  it("opportunity-cards puts it under both the featured column and each card", () => {
    expect(code("src/components/portal/opportunity-cards.tsx").match(/<FigureDisclaimer/g)).toHaveLength(2);
  });
});

describe("a section that shows a figure says so; one that does not, does not", () => {
  const working = composeMemo(snapshotSource({ basis: { kind: "working", case: { ...SNAP_CASE, status: "current" } } }));
  const html = (key: "key_metrics" | "executive_summary", fmt: "teaser" | "ic") =>
    textOf(renderToStaticMarkup(createElement(SectionBody, {
      resolved: resolveSection(working.sections[key], null, fmt), currency: "GBP", format: fmt, surface: "print",
    })));

  it("the teaser's key metrics carry the line and never the working-version flag", () => {
    const t = html("key_metrics", "teaser");
    expect(t).toContain("Indicative, subject to final underwriting");
    expect(t).not.toMatch(/unapproved|working version|committee/i);
    expect(showsFigures(resolveSection(working.sections.key_metrics, null, "teaser"))).toBe(true);
    expect(figuresLine(resolveSection(working.sections.key_metrics, null, "teaser"))).toBe(INVESTOR_FIGURES_DISCLAIMER);
  });

  it("the line does not depend on the underwriting state: an approved basis gets the same one", () => {
    const approved = composeMemo(snapshotSource());
    const section = (m: typeof approved) => textOf(renderToStaticMarkup(createElement(SectionBody, {
      resolved: resolveSection(m.sections.key_metrics, null, "teaser"), currency: "GBP", format: "teaser", surface: "print",
    })));
    expect(section(approved)).toContain("Indicative, subject to final underwriting");
    expect(section(approved)).toBe(section(working));
  });

  it("the internal memo does not carry the investor line", () => {
    expect(html("key_metrics", "ic")).not.toContain("Indicative, subject to final underwriting");
  });

  it("a section a person wrote by hand is not inspected; the document footer carries the line for it", () => {
    const edited = resolveSection(working.sections.key_metrics, "Written by hand.", "teaser");
    expect(showsFigures(edited)).toBe(false);
    expect(code("src/app/(print)/opportunities/[opportunityId]/memo/print/page.tsx")).toContain("INVESTOR_FIGURES_DISCLAIMER");
  });

  it("the Japanese translation is handed the same line, in place of a flag", () => {
    const src = buildTranslationSource(working, {});
    const metrics = src.sections.find((s) => s.key === "key_metrics")!;
    expect(metrics.text).toContain("Indicative, subject to final underwriting");
    expect(JSON.stringify(src)).not.toMatch(/unapproved|working version/i);
  });
});

describe("a demonstration exchange rate never reaches an investor", () => {
  const DEMO = (currency: string, rate: number) => ({ currency, rateToGbp: rate, asOf: "2026-08-27", source: "Demo static rates" });
  const LIVE_JPY = { currency: "JPY", rateToGbp: 0.0052, asOf: "2026-08-27", source: "ECB reference rate (auto)" };
  const render = (data: ComposedSnapshot) => textOf(renderToStaticMarkup(createElement(AssetSnapshot, { data, surface: "print" })));

  it("recognises a placeholder source, and an empty one", () => {
    for (const s of ["Demo static rates", "static", "TBC", "n/a", "placeholder rate", "Unknown", "", "  ", null, undefined]) {
      expect(isPlaceholderFxSource(s as string | null | undefined), String(s)).toBe(true);
    }
    for (const s of ["ECB reference rate (auto)", "Bloomberg close", "Base currency", "Treasury desk, 27 Aug"]) {
      expect(isPlaceholderFxSource(s), s).toBe(false);
    }
  });

  it("composing with a demo JPY rate leaves no yen figure, no rate line, and tells the author why", () => {
    const snap = composeSnapshot(snapshotSource({ fxJpy: DEMO("JPY", 0.0052) }));
    expect(snap.priceJpy).toBeNull();
    expect(snap.fx).toBeNull();
    expect(snap.gaps.find((g) => g.key === "jpy")?.why).toMatch(/demonstration values/);
    const t = render(snap);
    expect(t).not.toContain("¥");
    expect(t).not.toMatch(/Demo|static|FX /);
    expect(t).toContain("Indicative, subject to final underwriting");
  });

  it("a demo rate on the deal's own currency is just as disqualifying (EUR deal, live JPY)", () => {
    const base = snapshotSource();
    const eur = snapshotSource({
      opportunity: { ...base.opportunity, currency: "EUR" },
      fx: DEMO("EUR", 0.85), fxJpy: LIVE_JPY,
    });
    const snap = composeSnapshot(eur);
    expect(snap.priceJpy).toBeNull();
    expect(snap.fx).toBeNull();
  });

  it("a placeholder GBP row says nothing about a GBP deal: the base rate is 1, and a missing JPY rate is reported as missing", () => {
    const seeded = DEMO("GBP", 1);
    const withYen = composeSnapshot(snapshotSource({ fx: seeded, fxJpy: LIVE_JPY }));
    expect(withYen.priceJpy).not.toBeNull();
    const noYen = composeSnapshot(snapshotSource({ fx: seeded, fxJpy: null }));
    expect(noYen.priceJpy).toBeNull();
    expect(noYen.gaps.find((g) => g.key === "jpy")?.why).toMatch(/No JPY exchange rate/);
  });

  it("a live source is untouched: the yen figure and the rate line stay", () => {
    const snap = composeSnapshot(snapshotSource({ fxJpy: LIVE_JPY }));
    expect(snap.priceJpy).not.toBeNull();
    expect(snap.fx?.jpySource).toBe("ECB reference rate (auto)");
    expect(withoutPlaceholderFx(snap)).toBe(snap);
    const t = render(snap);
    expect(t).toContain("¥");
    expect(t).toContain("ECB reference rate (auto)");
    expect(t).toContain("Indicative, subject to final underwriting");
  });

  it("a memo already finalised with a demo rate is cleaned at render, and its record is not touched", () => {
    // The stored Snapshot as it was composed before this rule: yen figures resting on the demo rate.
    const stored: ComposedSnapshot = {
      ...composeSnapshot(snapshotSource({ fxJpy: LIVE_JPY })),
    };
    const old: ComposedSnapshot = {
      ...stored,
      fx: { ...stored.fx!, jpySource: "Demo static rates" },
      allocation: { land: 20_000_000, building: 44_000_000, landPct: 31.25, buildingPct: 68.75, landJpy: 3_846_153_846, buildingJpy: 8_461_538_461,
        depreciation: { years: 47, method: "straight_line", annual: 936_170, annualJpy: 180_032_000 } } as ComposedSnapshot["allocation"],
    };
    const cleaned = withoutPlaceholderFx(old);
    expect(cleaned.priceJpy).toBeNull();
    expect(cleaned.fx).toBeNull();
    expect(cleaned.allocation?.landJpy).toBeNull();
    expect(cleaned.allocation?.buildingJpy).toBeNull();
    expect(cleaned.allocation?.depreciation?.annualJpy).toBeNull();
    expect(old.priceJpy).not.toBeNull();                      // the stored object is not mutated

    const t = render(old);
    expect(t).not.toContain("¥");
    expect(t).not.toMatch(/Demo static/);
    // The non-yen figures are all still there.
    expect(t).toContain("£64.0M");
    expect(t).toContain("Indicative, subject to final underwriting");
  });

  it("the prospect link cuts a demo rate out of a stored Snapshot too", () => {
    const stored = composeMemo(snapshotSource({ fxJpy: LIVE_JPY }));
    const doc = JSON.parse(JSON.stringify(stored));
    doc.snapshot.fx.jpySource = "Demo static rates";
    const prospect = prospectSnapshot(doc)!;
    expect(prospect.data.priceJpy).toBeNull();
    expect(prospect.data.fx).toBeNull();
    const html = textOf(renderToStaticMarkup(createElement(ProspectDocument, {
      token: "T", view: { prospectName: "Hanako Sato", snapshot: prospect, teaser: prospectTeaser(doc, {}, "2026-09-01T00:00:00Z") },
    })));
    expect(html).not.toContain("¥");
    expect(html).not.toMatch(/Demo static|unapproved|working version|finalised/i);
    expect(html).toContain("Indicative, subject to final underwriting");
  });

  it("no investor surface of the portal or the publication preview converts a currency at all", () => {
    for (const f of INVESTOR_SURFACES.filter((s) => s.startsWith("src/app/(portal)") || s.startsWith("src/components/portal") || s.startsWith("src/lib/portal/"))) {
      expect(code(f), f).not.toMatch(/fx_rates|rateToGbp|convertViaGbp|jpyPerGbp|priceJpy/);
    }
    expect(code("src/components/admin/publication-detail.tsx")).not.toMatch(/fx_rates|rateToGbp|convertViaGbp|priceJpy/);
  });
});

describe("a printed or shared investor copy leaves out a section with nothing in it", () => {
  it("the print page and the prospect document drop empty sections for an external format", () => {
    expect(code("src/app/(print)/opportunities/[opportunityId]/memo/print/page.tsx")).toMatch(/external && resolved\.state === "empty"/);
    const none: MemoSource = snapshotSource({ basis: { kind: "none", case: null } });
    const memo = composeMemo(none);
    const t = prospectTeaser(JSON.parse(JSON.stringify(memo)), {}, null)!;
    expect(t.sections.every((s) => s.resolved.state !== "empty")).toBe(true);
    const html = textOf(renderToStaticMarkup(createElement(ProspectDocument, {
      token: "T", view: { prospectName: "Hanako Sato", snapshot: null, teaser: t },
    })));
    expect(html).not.toContain("No data recorded");
  });
});
