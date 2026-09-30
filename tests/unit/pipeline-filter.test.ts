// ============================================================================
// Pipeline filtering - a pure function over rows, no DOM.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  NO_FILTERS, applyFilters, facet, triageFacet, priorityFacet, triageProgress,
  hasActiveFilters, setFilter, type FilterableRow, type PipelineFilters,
} from "@/lib/pipeline/filter";

const row = (o: Partial<FilterableRow> & { name: string }): FilterableRow => ({
  address: null, brokerName: null, market: "London", assetType: "office", strategy: "core",
  triageStatus: "untriaged", triagePriority: null, ...o,
});

const ROWS: FilterableRow[] = [
  row({ name: "5 Pollen Street", address: "5 Pollen Street, Mayfair", brokerName: "Hanover Green", assetType: "mixed_use" }),
  row({ name: "24-26 Spring Street", brokerName: "Knight Frank", triageStatus: "live", triagePriority: "P1" }),
  row({ name: "65 Fenchurch Street", brokerName: "Avison Young", triageStatus: "live", triagePriority: "P2", strategy: "value_add" }),
  row({ name: "Spuistraat 224", market: "Amsterdam", brokerName: "CBRE", assetType: "retail", strategy: null, triageStatus: "dead" }),
  row({ name: "Comparable, 9 Conduit Street", market: "London", triageStatus: "reference" }),
  row({ name: "Unmarked", market: null, strategy: null }),
];
const f = (over: Partial<PipelineFilters>): PipelineFilters => ({ ...NO_FILTERS, ...over });
const names = (rs: FilterableRow[]) => rs.map((r) => r.name);

describe("applyFilters", () => {
  it("returns everything with no filters", () => {
    expect(applyFilters(ROWS, NO_FILTERS)).toHaveLength(ROWS.length);
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
  });

  it("filters by triage status", () => {
    expect(names(applyFilters(ROWS, f({ triageStatus: "dead" })))).toEqual(["Spuistraat 224"]);
    expect(applyFilters(ROWS, f({ triageStatus: "untriaged" }))).toHaveLength(2);
  });

  it("returns nothing for live when nothing has been triaged yet", () => {
    const fresh = ROWS.map((r) => ({ ...r, triageStatus: "untriaged" as const, triagePriority: null }));
    expect(applyFilters(fresh, f({ triageStatus: "live" }))).toEqual([]);
  });

  it("filters by priority, which only a live row can carry", () => {
    expect(names(applyFilters(ROWS, f({ triagePriority: "P1" })))).toEqual(["24-26 Spring Street"]);
    expect(applyFilters(ROWS, f({ triageStatus: "dead", triagePriority: "P1" }))).toEqual([]);
  });

  it("filters by market, asset type and strategy", () => {
    expect(applyFilters(ROWS, f({ market: "Amsterdam" }))).toHaveLength(1);
    expect(applyFilters(ROWS, f({ assetType: "mixed_use" }))).toHaveLength(1);
    expect(names(applyFilters(ROWS, f({ strategy: "value_add" })))).toEqual(["65 Fenchurch Street"]);
  });

  it("combines filters with AND", () => {
    expect(names(applyFilters(ROWS, f({ market: "London", triageStatus: "live", strategy: "core" }))))
      .toEqual(["24-26 Spring Street"]);
    expect(applyFilters(ROWS, f({ market: "Amsterdam", triageStatus: "live" }))).toEqual([]);
  });

  describe("search", () => {
    it("matches name, address and broker, case-insensitively", () => {
      expect(names(applyFilters(ROWS, f({ query: "pollen" })))).toEqual(["5 Pollen Street"]);
      expect(names(applyFilters(ROWS, f({ query: "MAYFAIR" })))).toEqual(["5 Pollen Street"]);
      expect(names(applyFilters(ROWS, f({ query: "knight" })))).toEqual(["24-26 Spring Street"]);
    });

    it("requires every word, in any field", () => {
      expect(names(applyFilters(ROWS, f({ query: "pollen hanover" })))).toEqual(["5 Pollen Street"]);
      expect(applyFilters(ROWS, f({ query: "pollen cbre" }))).toEqual([]);
    });

    it("ignores surrounding whitespace and an empty query", () => {
      expect(applyFilters(ROWS, f({ query: "   " }))).toHaveLength(ROWS.length);
      expect(names(applyFilters(ROWS, f({ query: "  fenchurch  " })))).toEqual(["65 Fenchurch Street"]);
    });

    it("does not throw on a row with no address or broker", () => {
      expect(applyFilters(ROWS, f({ query: "unmarked" }))).toHaveLength(1);
    });
  });
});

describe("facet counts", () => {
  it("lists only values present in the data, never a hardcoded set", () => {
    expect(facet(ROWS, NO_FILTERS, "market").map((o) => o.value)).toEqual(["Amsterdam", "London"]);
    const withTokyo = [...ROWS, row({ name: "Roppongi", market: "Tokyo" })];
    expect(facet(withTokyo, NO_FILTERS, "market").map((o) => o.value)).toContain("Tokyo");
  });

  it("omits an unset value rather than offering it as an option", () => {
    expect(facet(ROWS, NO_FILTERS, "strategy").map((o) => o.value)).toEqual(["core", "value_add"]);
  });

  it("counts each option against the OTHER filters, so options never vanish", () => {
    const opts = facet(ROWS, f({ triageStatus: "live" }), "market");
    expect(opts).toEqual([{ value: "Amsterdam", count: 0 }, { value: "London", count: 2 }]);
  });

  it("does not let a facet be narrowed by its own selection", () => {
    const opts = facet(ROWS, f({ market: "London" }), "market");
    expect(opts.find((o) => o.value === "Amsterdam")!.count).toBe(1);
  });

  it("counts triage statuses, and priorities", () => {
    expect(triageFacet(ROWS, NO_FILTERS)).toEqual({ untriaged: 2, live: 2, dead: 1, reference: 1 });
    expect(triageFacet(ROWS, f({ market: "Amsterdam" }))).toEqual({ untriaged: 0, live: 0, dead: 1, reference: 0 });
    expect(priorityFacet(ROWS, NO_FILTERS)).toEqual({ P1: 1, P2: 1, P3: 0 });
  });
});

describe("triageProgress", () => {
  it("starts at zero reviewed when everything is untriaged", () => {
    const fresh = ROWS.map((r) => ({ ...r, triageStatus: "untriaged" as const, triagePriority: null }));
    expect(triageProgress(fresh)).toEqual({ total: 6, untriaged: 6, reviewed: 0 });
  });

  it("counts reviewed as everything that is not untriaged, ignoring any filter", () => {
    expect(triageProgress(ROWS)).toEqual({ total: 6, untriaged: 2, reviewed: 4 });
  });
});

describe("setFilter", () => {
  it("clears a priority when the status moves away from live", () => {
    const live = setFilter(setFilter(NO_FILTERS, "triageStatus", "live"), "triagePriority", "P1");
    expect(live.triagePriority).toBe("P1");
    expect(setFilter(live, "triageStatus", "dead").triagePriority).toBe("");
    expect(setFilter(live, "triageStatus", "").triagePriority).toBe("");
  });

  it("clearing everything returns the unfiltered view", () => {
    const busy = f({ market: "London", query: "x", triageStatus: "live", triagePriority: "P2" });
    expect(hasActiveFilters(busy)).toBe(true);
    expect(applyFilters(ROWS, NO_FILTERS)).toHaveLength(ROWS.length);
  });
});
