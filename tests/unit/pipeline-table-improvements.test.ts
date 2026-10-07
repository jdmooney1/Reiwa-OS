// ============================================================================
// Pipeline table improvements - the pure parts: price and yield filters, sort, the URL, triage.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  NO_FILTERS, applyFilters, hasActiveFilters, parseBound, PRICE_PRESETS, YIELD_PRESETS,
  activePricePreset, activeYieldPreset, nonGbpHiddenByPrice, type FilterableRow, type PipelineFilters,
} from "@/lib/pipeline/filter";
import { sortRows, nextSort, sortValue, ariaSort, type SortableRow, type SortState } from "@/lib/pipeline/sort";
import {
  parseViewState, parseMode, toQueryString, sanitiseViewState, sanitiseFilters, sameView, parseSort, formatSort, DEFAULT_VIEW,
} from "@/lib/pipeline/view-state";
import {
  TRIAGE_DECISIONS, triageFields, cleanReason, buildTriageQueue, resolveTriageKey, REASON_MAX, isTriageDecision,
} from "@/lib/pipeline/triage";

type Row = FilterableRow & SortableRow & { opportunityId: string };
let n = 0;
const row = (o: Partial<Row> = {}): Row => ({
  opportunityId: `id-${++n}`, name: `Deal ${n}`, address: null, brokerName: null, market: "London", assetType: "office", strategy: "core",
  triageStatus: "untriaged", triagePriority: null, currency: "GBP",
  caseAcquisitionPrice: null, caseTotalCost: null, caseEntryYieldPct: null, caseTargetIrr: null, ...o,
});
const f = (over: Partial<PipelineFilters>): PipelineFilters => ({ ...NO_FILTERS, ...over });
const ids = (rs: Row[]) => rs.map((r) => r.name);
const m = (millions: number) => millions * 1_000_000;

describe("price range", () => {
  const ROWS = [
    row({ name: "3m", caseAcquisitionPrice: m(3) }),
    row({ name: "5m", caseAcquisitionPrice: m(5) }),
    row({ name: "14.9m", caseAcquisitionPrice: m(14.9) }),
    row({ name: "15m", caseAcquisitionPrice: m(15) }),
    row({ name: "29m", caseAcquisitionPrice: m(29) }),
    row({ name: "30m", caseAcquisitionPrice: m(30) }),
    row({ name: "80m", caseAcquisitionPrice: m(80) }),
    row({ name: "blank" }),
    row({ name: "yen", currency: "JPY", caseAcquisitionPrice: 5_000_000_000 }),
    row({ name: "euro", currency: "EUR", caseAcquisitionPrice: m(12) }),
  ];

  it("the four presets partition the pounds: every priced GBP deal is in exactly one", () => {
    const priced = ROWS.filter((r) => r.currency === "GBP" && r.caseAcquisitionPrice !== null);
    for (const r of priced) {
      const inBands = PRICE_PRESETS.filter((p) => applyFilters([r], f({ priceMin: p.min, priceMax: p.max })).length === 1);
      expect(inBands.map((p) => p.id), r.name).toHaveLength(1);
    }
  });

  it("each band runs from its minimum (inclusive) up to its maximum (exclusive)", () => {
    const band = (id: string) => {
      const p = PRICE_PRESETS.find((x) => x.id === id)!;
      return ids(applyFilters(ROWS, f({ priceMin: p.min, priceMax: p.max })));
    };
    expect(band("lt5")).toEqual(["3m"]);                          // £5.0m is not "under 5"
    expect(band("5-15")).toEqual(["5m", "14.9m"]);                // £15.0m belongs to the next band
    expect(band("15-30")).toEqual(["15m", "29m"]);
    expect(band("30+")).toEqual(["30m", "80m"]);
  });

  it("a custom range works with either bound alone", () => {
    expect(ids(applyFilters(ROWS, f({ priceMin: "14" })))).toEqual(["14.9m", "15m", "29m", "30m", "80m"]);
    expect(ids(applyFilters(ROWS, f({ priceMax: "5" })))).toEqual(["3m"]);
    expect(ids(applyFilters(ROWS, f({ priceMin: "5.5", priceMax: "15" })))).toEqual(["14.9m"]);
  });

  it("a deal with no price, and a deal not in pounds, are never inside a range", () => {
    const hit = ids(applyFilters(ROWS, f({ priceMin: "0" })));
    expect(hit).not.toContain("blank");
    expect(hit).not.toContain("yen");
    expect(hit).not.toContain("euro");
  });

  it("says how many non-pound deals the range left out, and nothing when there is no range", () => {
    expect(nonGbpHiddenByPrice(ROWS, f({ priceMin: "5", priceMax: "15" }))).toBe(2);
    expect(nonGbpHiddenByPrice(ROWS, NO_FILTERS)).toBe(0);
    // only deals that pass every OTHER filter are counted
    expect(nonGbpHiddenByPrice(ROWS, f({ priceMin: "5", market: "Nowhere" }))).toBe(0);
  });

  it("recognises which preset is on, including none for a custom range", () => {
    expect(activePricePreset(f({ priceMin: "5", priceMax: "15" }))).toBe("5-15");
    expect(activePricePreset(f({ priceMax: "5" }))).toBe("lt5");
    expect(activePricePreset(f({ priceMin: "30" }))).toBe("30+");
    expect(activePricePreset(f({ priceMin: "6", priceMax: "15" }))).toBeNull();
    expect(activePricePreset(NO_FILTERS)).toBeNull();
  });

  it("treats anything that is not a plain non-negative number as no bound", () => {
    for (const bad of ["", " ", "abc", "-5", "1e3", "5m", "1,5", "NaN", "Infinity", "1.23456", "1234567"]) {
      expect(parseBound(bad), bad).toBeNull();
    }
    expect(parseBound("7")).toBe(7);
    expect(parseBound(" 7.5 ")).toBe(7.5);
    expect(applyFilters([row({ caseAcquisitionPrice: m(1) })], f({ priceMin: "abc" }))).toHaveLength(1);
  });
});

describe("minimum entry yield", () => {
  const ROWS = [
    row({ name: "4.9", caseEntryYieldPct: 4.9 }), row({ name: "5", caseEntryYieldPct: 5 }), row({ name: "6.5", caseEntryYieldPct: 6.5 }),
    row({ name: "7", caseEntryYieldPct: 7 }), row({ name: "blank" }), row({ name: "yen 6", currency: "JPY", caseEntryYieldPct: 6 }),
  ];
  it("is inclusive, excludes blanks, and applies to every currency", () => {
    expect(ids(applyFilters(ROWS, f({ yieldMin: "5" })))).toEqual(["5", "6.5", "7", "yen 6"]);
    expect(ids(applyFilters(ROWS, f({ yieldMin: "7" })))).toEqual(["7"]);
    expect(ids(applyFilters(ROWS, f({ yieldMin: "6.25" })))).toEqual(["6.5", "7"]);
  });
  it("offers 5, 6 and 7 percent, and recognises them", () => {
    expect(YIELD_PRESETS).toEqual([5, 6, 7]);
    expect(activeYieldPreset(f({ yieldMin: "6" }))).toBe(6);
    expect(activeYieldPreset(f({ yieldMin: "6.5" }))).toBeNull();
    expect(activeYieldPreset(NO_FILTERS)).toBeNull();
  });
  it("combines with the existing filters and with price (AND)", () => {
    const rows = [
      row({ name: "a", market: "London", caseAcquisitionPrice: m(10), caseEntryYieldPct: 6.5 }),
      row({ name: "b", market: "London", caseAcquisitionPrice: m(10), caseEntryYieldPct: 4 }),
      row({ name: "c", market: "Amsterdam", caseAcquisitionPrice: m(10), caseEntryYieldPct: 6.5 }),
      row({ name: "d", market: "London", caseAcquisitionPrice: m(40), caseEntryYieldPct: 6.5 }),
    ];
    expect(ids(applyFilters(rows, f({ market: "London", priceMin: "5", priceMax: "15", yieldMin: "6" })))).toEqual(["a"]);
    expect(hasActiveFilters(f({ yieldMin: "6" }))).toBe(true);
    expect(hasActiveFilters(f({ priceMax: "5" }))).toBe(true);
  });
});

describe("sorting", () => {
  const A = row({ name: "A", caseAcquisitionPrice: m(10), caseTotalCost: m(11), caseEntryYieldPct: 6, caseTargetIrr: 12 });
  const B = row({ name: "B", caseAcquisitionPrice: m(30), caseTotalCost: m(33), caseEntryYieldPct: 5, caseTargetIrr: 15 });
  const C = row({ name: "C", caseAcquisitionPrice: m(20), caseTotalCost: m(22), caseEntryYieldPct: 7, caseTargetIrr: 9 });
  const BLANK = row({ name: "blank" });
  const BLANK2 = row({ name: "blank2" });
  const YEN = row({ name: "yen", currency: "JPY", caseAcquisitionPrice: 9_000_000_000, caseTotalCost: 9_500_000_000, caseEntryYieldPct: 6.1, caseTargetIrr: 11 });
  const ALL = [BLANK, A, YEN, B, BLANK2, C];
  const by = (key: SortState["key"], dir: SortState["dir"]) => ids(sortRows(ALL, { key, dir }));

  it("sorts all four columns, both ways", () => {
    expect(by("price", "desc").slice(0, 3)).toEqual(["B", "C", "A"]);
    expect(by("price", "asc").slice(0, 3)).toEqual(["A", "C", "B"]);
    expect(by("totalCost", "desc").slice(0, 3)).toEqual(["B", "C", "A"]);
    expect(by("entryYield", "desc").slice(0, 4)).toEqual(["C", "yen", "A", "B"]);
    expect(by("entryYield", "asc").slice(0, 4)).toEqual(["B", "A", "yen", "C"]);
    expect(by("irr", "desc").slice(0, 4)).toEqual(["B", "A", "yen", "C"]);
    expect(by("irr", "asc").slice(0, 4)).toEqual(["C", "yen", "A", "B"]);
  });

  it("blanks are last in BOTH directions, in their original order", () => {
    for (const key of ["price", "totalCost", "entryYield", "irr"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        const out = by(key, dir);
        const tail = out.slice(-(key === "price" || key === "totalCost" ? 3 : 2));
        expect(tail, `${key} ${dir}`).toEqual(key === "price" || key === "totalCost" ? ["yen", "blank", "blank2"].sort((a, b) => ALL.findIndex((r) => r.name === a) - ALL.findIndex((r) => r.name === b)) : ["blank", "blank2"]);
      }
    }
  });

  it("money columns do not compare yen with pounds: a non-pound deal sorts with the blanks", () => {
    expect(sortValue(YEN, "price")).toBeNull();
    expect(sortValue(YEN, "totalCost")).toBeNull();
    expect(sortValue(YEN, "entryYield")).toBe(6.1);   // a percentage is currency-free
    expect(by("price", "desc")[0]).toBe("B");
  });

  it("is stable on ties and does not change its input", () => {
    const t1 = row({ name: "t1", caseTargetIrr: 10 }), t2 = row({ name: "t2", caseTargetIrr: 10 }), t3 = row({ name: "t3", caseTargetIrr: 10 });
    const input = [t2, t3, t1];
    expect(ids(sortRows(input, { key: "irr", dir: "desc" }))).toEqual(["t2", "t3", "t1"]);
    expect(ids(sortRows(input, { key: "irr", dir: "asc" }))).toEqual(["t2", "t3", "t1"]);
    expect(ids(input)).toEqual(["t2", "t3", "t1"]);
    expect(ids(sortRows(ALL, null))).toEqual(ids(ALL));
  });

  it("a header click goes highest first, lowest first, then back to the original order", () => {
    let s: SortState | null = null;
    s = nextSort(s, "price"); expect(s).toEqual({ key: "price", dir: "desc" });
    s = nextSort(s, "price"); expect(s).toEqual({ key: "price", dir: "asc" });
    s = nextSort(s, "price"); expect(s).toBeNull();
    expect(nextSort({ key: "price", dir: "asc" }, "irr")).toEqual({ key: "irr", dir: "desc" });
    expect(ariaSort({ key: "irr", dir: "asc" }, "irr")).toBe("ascending");
    expect(ariaSort({ key: "irr", dir: "desc" }, "irr")).toBe("descending");
    expect(ariaSort({ key: "irr", dir: "desc" }, "price")).toBe("none");
  });
});

describe("the address bar is the view", () => {
  it("round-trips every filter, the sort and the layout", () => {
    const state = {
      filters: f({ triageStatus: "live", triagePriority: "P2", market: "London", assetType: "office", strategy: "core", query: "pollen st", priceMin: "5", priceMax: "15", yieldMin: "6" }),
      sort: { key: "entryYield", dir: "desc" } as SortState, layout: "table" as const,
    };
    const qs = toQueryString(state);
    expect(qs).toBe("triage=live&priority=P2&market=London&type=office&strategy=core&q=pollen+st&pmin=5&pmax=15&ymin=6&sort=-entryYield&view=table");
    expect(parseViewState(new URLSearchParams(qs))).toEqual(state);
  });

  it("the plain pipeline has an empty query string, and an empty one parses to the plain pipeline", () => {
    expect(toQueryString(DEFAULT_VIEW)).toBe("");
    expect(parseViewState(new URLSearchParams(""))).toEqual(DEFAULT_VIEW);
    expect(parseViewState({})).toEqual(DEFAULT_VIEW);
  });

  it("reads Next's searchParams object as well as a URLSearchParams", () => {
    expect(parseViewState({ pmin: "5", market: ["London", "Paris"], view: "table" }).filters.market).toBe("London");
    expect(parseViewState({ pmin: "5", view: "table" })).toMatchObject({ layout: "table", filters: { priceMin: "5" } });
    expect(parseMode({ mode: "triage" })).toBe("triage");
    expect(parseMode({ mode: "anything" })).toBe("browse");
    expect(toQueryString(DEFAULT_VIEW, "triage")).toBe("mode=triage");
  });

  it("drops what is not valid instead of failing: a mangled bookmark opens as an unfiltered pipeline", () => {
    const s = parseViewState(new URLSearchParams("triage=bogus&priority=P9&pmin=abc&pmax=-3&ymin=1e9&sort=password&view=<script>&q=%00%01x&market=" + "L".repeat(500)));
    expect(s.filters.triageStatus).toBe("");
    expect(s.filters.triagePriority).toBe("");
    expect(s.filters.priceMin).toBe("");
    expect(s.filters.priceMax).toBe("");
    expect(s.filters.yieldMin).toBe("");
    expect(s.sort).toBeNull();
    expect(s.layout).toBe("board");
    expect(s.filters.query).toBe("x");
    expect(s.filters.market.length).toBeLessThanOrEqual(120);
  });

  it("a priority is kept only with the live filter, as on screen", () => {
    expect(parseViewState(new URLSearchParams("priority=P1")).filters.triagePriority).toBe("");
    expect(parseViewState(new URLSearchParams("triage=dead&priority=P1")).filters.triagePriority).toBe("");
    expect(parseViewState(new URLSearchParams("triage=live&priority=P1")).filters.triagePriority).toBe("P1");
  });

  it("sort parameter: a leading minus is highest first; unknown keys are no sort", () => {
    expect(parseSort("-price")).toEqual({ key: "price", dir: "desc" });
    expect(parseSort("irr")).toEqual({ key: "irr", dir: "asc" });
    expect(parseSort("-bogus")).toBeNull();
    expect(parseSort(42)).toBeNull();
    expect(formatSort({ key: "totalCost", dir: "desc" })).toBe("-totalCost");
    expect(formatSort(null)).toBe("");
  });

  it("a saved definition of any shape becomes a valid view, never an exception", () => {
    for (const junk of [null, undefined, 5, "x", [], { filters: 3 }, { filters: { priceMin: { evil: 1 } }, sort: "nope", layout: 7 }]) {
      expect(() => sanitiseViewState(junk)).not.toThrow();
      expect(toQueryString(sanitiseViewState(junk))).toBe("");
    }
    expect(sanitiseViewState({ filters: { market: "London", yieldMin: "6" }, sort: { key: "irr", dir: "desc" }, layout: "table" }))
      .toEqual({ filters: f({ market: "London", yieldMin: "6" }), sort: { key: "irr", dir: "desc" }, layout: "table" });
    expect(sanitiseFilters({ extra: "ignored", market: "X" } as never).market).toBe("X");
  });

  it("two views are the same when their filters, sort and layout are", () => {
    const a = parseViewState(new URLSearchParams("market=London&pmin=5"));
    expect(sameView(a, parseViewState(new URLSearchParams("pmin=5.0&market=London")))).toBe(true);
    expect(sameView(a, parseViewState(new URLSearchParams("market=London&pmin=6")))).toBe(false);
  });
});

describe("triage decisions and the queue", () => {
  it("Pursue is live, Pass is dead, Watch is live at the lowest priority and says so", () => {
    expect(triageFields("pursue", "")).toEqual({ status: "live", priority: null, note: null });
    expect(triageFields("pass", "Too thin")).toEqual({ status: "dead", priority: null, note: "Too thin" });
    expect(triageFields("watch", "")).toEqual({ status: "live", priority: "P3", note: "Watching" });
    expect(triageFields("watch", "Price may drop")).toEqual({ status: "live", priority: "P3", note: "Watching: Price may drop" });
  });

  it("every decision stays inside what the database allows: a priority only ever on a live deal", () => {
    for (const d of ["pursue", "watch", "pass"] as const) {
      const r = triageFields(d, "x");
      expect(["live", "dead", "reference"]).toContain(r.status);
      if (r.priority !== null) expect(r.status).toBe("live");
      expect([null, "P1", "P2", "P3"]).toContain(r.priority);
    }
    expect(TRIAGE_DECISIONS.pursue.key + TRIAGE_DECISIONS.watch.key + TRIAGE_DECISIONS.pass.key).toBe("pwx");
  });

  it("cleans the reason: trimmed, control characters out, capped, empty means none", () => {
    expect(cleanReason("  hello \n there  ")).toBe("hello \n there");
    expect(cleanReason("   ")).toBeNull();
    expect(cleanReason(undefined)).toBeNull();
    expect(cleanReason({ not: "a string" })).toBeNull();
    expect(cleanReason("a\u0000b\u0007c")).toBe("a b c");
    expect(cleanReason("x".repeat(REASON_MAX + 100))!.length).toBe(REASON_MAX);
  });

  it("recognises only the three decision names", () => {
    expect(isTriageDecision("pursue")).toBe(true);
    for (const bad of ["live", "dead", "reference", "", null, 5, "PURSUE"]) expect(isTriageDecision(bad)).toBe(false);
  });

  it("the queue is the untriaged deals only, in the order given", () => {
    const rows = [row({ name: "a" }), row({ name: "b", triageStatus: "live" }), row({ name: "c" }), row({ name: "d", triageStatus: "dead" }), row({ name: "e" })];
    expect(ids(buildTriageQueue(rows))).toEqual(["a", "c", "e"]);
    expect(buildTriageQueue([])).toEqual([]);
  });
});

describe("triage keys", () => {
  const k = (key: string, over: Partial<Parameters<typeof resolveTriageKey>[0]> = {}) => resolveTriageKey({ key, inEditable: false, ...over });

  it("P, W and X are Pursue, Watch and Pass, in either case", () => {
    expect([k("p"), k("P"), k("w"), k("W"), k("x"), k("X")]).toEqual(["pursue", "pursue", "watch", "watch", "pass", "pass"]);
  });
  it("the helpers: skip, back, undo, reason, exit", () => {
    expect([k("s"), k("ArrowRight"), k("ArrowLeft"), k("u"), k("r"), k("Escape")]).toEqual(["skip", "skip", "back", "undo", "reason", "exit"]);
  });
  it("typing a reason is not a decision: letters are ignored inside a text field", () => {
    for (const key of ["p", "w", "x", "s", "u", "r", "ArrowLeft", "ArrowRight", "a", "Enter"]) expect(k(key, { inEditable: true }), key).toBeNull();
    expect(k("Escape", { inEditable: true })).toBe("reason");     // Esc leaves the box
  });
  it("a modifier means the browser's shortcut, not ours", () => {
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) expect(k("p", { [mod]: true }), mod).toBeNull();
  });
  it("a held key does not repeat a decision through the queue", () => {
    expect(k("p", { repeat: true })).toBeNull();
    expect(k("x", { repeat: true })).toBeNull();
  });
  it("other keys are not ours", () => {
    for (const key of ["a", "q", "1", " ", "Enter", "Tab", "Delete"]) expect(k(key), key).toBeNull();
  });
});
