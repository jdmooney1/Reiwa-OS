// ============================================================================
// The portfolio is never valued at an invented exchange rate.
// ----------------------------------------------------------------------------
// `portfolioAggregate()` refuses to value a portfolio whose rate is missing —
// "load the rate into fx_rates rather than assuming one". That refusal is only
// worth anything if nothing upstream quietly supplies a rate on its behalf, and
// `getFxContext` used to do exactly that: `num(r.rate_to_gbp) ?? 1`, which is a
// silent claim that a euro is a pound applied to every valuation in euros.
//
// These run without a database, which is the point: the rule is a property of
// the mapping, not of the query.
// ============================================================================
import { describe, it, expect } from "vitest";
import { fxContextFrom, type FxRateRow } from "@/lib/data/portfolio";
import { portfolioAggregate } from "@/lib/asset-intelligence/metrics";
import type { AssetFile } from "@/lib/asset-intelligence/types";

const row = (over: Partial<FxRateRow>): FxRateRow => ({
  currency: "EUR", rate_to_gbp: "0.850000", as_of_date: "2026-08-27",
  source: "Demo static rates", ...over,
});

describe("An unusable rate is omitted, never defaulted", () => {
  it("drops a null rate rather than valuing the currency at parity", () => {
    const fx = fxContextFrom([row({ currency: "EUR", rate_to_gbp: null })]);
    expect(fx.rates.EUR).toBeUndefined();
    // The distinction that matters: absent, so the aggregate can refuse.
    expect("EUR" in fx.rates).toBe(false);
  });

  it("drops rates that are not finite positive numbers", () => {
    for (const bad of ["", "   ", "not-a-number", "0", "-1.5", "NaN"]) {
      const fx = fxContextFrom([row({ currency: "EUR", rate_to_gbp: bad })]);
      expect({ bad, eur: fx.rates.EUR }).toEqual({ bad, eur: undefined });
    }
  });

  it("keeps a genuine rate", () => {
    expect(fxContextFrom([row({ rate_to_gbp: "0.850000" })]).rates.EUR).toBe(0.85);
  });

  it("still treats GBP against GBP as one, which is a definition not a guess", () => {
    expect(fxContextFrom([]).rates.GBP).toBe(1);
  });

  it("lets the aggregate refuse, instead of silently mis-valuing", () => {
    // An asset in euros, and a euro rate that could not be read.
    const asset = {
      asset: { asset_id: "a1", currency: "EUR", name: "Herengracht 124" },
      plans: [], periods: [], valuations: [], risks: [], decisions: [],
    } as unknown as AssetFile;
    const fx = fxContextFrom([row({ currency: "EUR", rate_to_gbp: null })]);

    // Before the fix this returned a number computed at 1:1. Now it throws,
    // which is what metrics.ts was always trying to do.
    expect(() => portfolioAggregate([asset], fx.rates, "GBP"))
      .toThrow(/No FX rate for EUR/);
  });
});

describe("Staleness is reported deterministically", () => {
  const mixed: FxRateRow[] = [
    // Ordered oldest first, as the query now orders them.
    row({ currency: "JPY", rate_to_gbp: "0.005200", as_of_date: "2026-06-01", source: "Stale feed" }),
    row({ currency: "EUR", rate_to_gbp: "0.850000", as_of_date: "2026-08-27", source: "Demo static rates" }),
    row({ currency: "USD", rate_to_gbp: "0.790000", as_of_date: "2026-08-27", source: "Demo static rates" }),
  ];

  it("reports the OLDEST date, because the caveat describes the weakest input", () => {
    // Previously this was whichever row the database returned last, so the same
    // data could describe itself differently between two requests.
    expect(fxContextFrom(mixed).asOf).toBe("2026-06-01");
  });

  it("names every distinct source rather than the last one seen", () => {
    expect(fxContextFrom(mixed).source).toBe("Stale feed, Demo static rates");
  });

  it("says so plainly when there are no rates at all", () => {
    const fx = fxContextFrom([]);
    expect(fx.source).toBe("—");
    expect(fx.asOf).toBeNull();
  });

  it("is stable: the same rows always produce the same context", () => {
    expect(fxContextFrom(mixed)).toEqual(fxContextFrom(mixed));
  });
});
