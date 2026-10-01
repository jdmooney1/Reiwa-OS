// ============================================================================
// Underwriting auto-calc: fill when empty, never overwrite.
// Pure arithmetic and a pure reducer, so no database and no DOM.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  DERIVABLE, applyDerivation, deriveReducer, initDerive, isAutoFilled, reconcile,
  type DeriveAction, type DeriveState,
} from "@/lib/underwriting/derive";

const BLANK: Record<string, string> = {
  acquisitionPrice: "", acquisitionCosts: "", capex: "", equity: "",
  grossRentalIncome: "", noi: "", erv: "", occupancyPct: "",
  debt: "", ltvPct: "", debtCostPct: "",
  valuation: "", exitValue: "", entryYieldPct: "", exitYieldPct: "",
  holdPeriodYears: "", targetIrr: "", targetEquityMultiple: "",
};

/** A form with these fields filled in, all of them the person's own. */
function start(fields: Record<string, string>): DeriveState {
  return initDerive({ ...BLANK, ...fields });
}
const run = (s: DeriveState, ...actions: DeriveAction[]) => actions.reduce(deriveReducer, s);
const type = (name: string, raw: string): DeriveAction => ({ type: "edit", name, raw });
const leave = (name: string): DeriveAction => ({ type: "blur", name });

describe("equity and debt", () => {
  it("equity = total cost - debt", () => {
    const s = start({ acquisitionPrice: "64000000", acquisitionCosts: "600000", capex: "1000000", debt: "30000000" });
    expect(s.values.equity).toBe("35600000");
    expect(isAutoFilled(s, "equity")).toBe(true);
  });

  it("reverse: debt = total cost - equity when equity is typed first", () => {
    const s = start({ acquisitionPrice: "64000000", acquisitionCosts: "600000", capex: "1000000", equity: "35600000" });
    expect(s.values.debt).toBe("30000000");
    expect(isAutoFilled(s, "debt")).toBe(true);
  });

  it("treats missing costs and capex as zero, like the generated column", () => {
    expect(start({ acquisitionPrice: "10000000", debt: "6000000" }).values.equity).toBe("4000000");
  });

  it("derives nothing without a price: total cost is null in Postgres too", () => {
    expect(start({ debt: "6000000" }).values.equity).toBe("");
  });

  it("does not fill a negative equity when debt exceeds cost", () => {
    expect(start({ acquisitionPrice: "10000000", debt: "12000000" }).values.equity).toBe("");
  });
});

describe("LTV", () => {
  it("LTV = debt / total cost when there is no valuation", () => {
    const s = start({ acquisitionPrice: "64000000", acquisitionCosts: "600000", capex: "1000000", debt: "30000000" });
    expect(s.values.ltvPct).toBe("45.73");
  });

  it("LTV = debt / valuation when there is one", () => {
    const s = start({ acquisitionPrice: "64000000", valuation: "70000000", debt: "35000000" });
    expect(s.values.ltvPct).toBe("50");
  });

  it("reverse: debt = LTV x anchor, then equity follows from that debt", () => {
    const s = start({ acquisitionPrice: "100000000", ltvPct: "60" });
    expect(s.values.debt).toBe("60000000");
    expect(s.values.equity).toBe("40000000");
  });

  it("reverse debt uses valuation as the anchor when present", () => {
    expect(start({ acquisitionPrice: "100000000", valuation: "120000000", ltvPct: "50" }).values.debt)
      .toBe("60000000");
  });
});

describe("occupancy", () => {
  it("occupancy = GRI / ERV", () => {
    expect(start({ grossRentalIncome: "900000", erv: "1000000" }).values.occupancyPct).toBe("90");
  });

  it("reverse: GRI = ERV x occupancy", () => {
    expect(start({ erv: "1000000", occupancyPct: "92.5" }).values.grossRentalIncome).toBe("925000");
  });

  it("reverse: ERV = GRI / occupancy", () => {
    expect(start({ grossRentalIncome: "900000", occupancyPct: "90" }).values.erv).toBe("1000000");
  });

  it("does not fill an occupancy above 100%, which the server would refuse", () => {
    expect(start({ grossRentalIncome: "1200000", erv: "1000000" }).values.occupancyPct).toBe("");
  });
});

describe("entry yield", () => {
  it("is NOI / price, not gross rent / price", () => {
    // The live error: 3.20% was GRI / price. NOI / price is 2.97%.
    const s = start({ acquisitionPrice: "64000000", grossRentalIncome: "2048000", noi: "1900800" });
    expect(s.values.entryYieldPct).toBe("2.97");
  });

  it("anchors on valuation when there is one", () => {
    expect(start({ acquisitionPrice: "64000000", valuation: "50000000", noi: "2000000" }).values.entryYieldPct)
      .toBe("4");
  });

  it("reverse: valuation = NOI / yield when valuation is blank", () => {
    const s = start({ acquisitionPrice: "64000000", noi: "2000000", entryYieldPct: "4" });
    expect(s.values.valuation).toBe("50000000");
    expect(isAutoFilled(s, "valuation")).toBe(true);
  });

  it("a typed yield with a typed valuation leaves both as typed", () => {
    const s = start({ noi: "2000000", entryYieldPct: "4", valuation: "60000000" });
    expect(s.values.valuation).toBe("60000000");
    expect(s.values.entryYieldPct).toBe("4");
  });
});

describe("acquisition costs from a percentage of price", () => {
  it("fills only on commit, and only when costs is not the person's", () => {
    let s = start({ acquisitionPrice: "64000000" });
    s = run(s, { type: "costsPctDraft", raw: "1.5" });
    expect(s.values.acquisitionCosts).toBe("");
    s = run(s, { type: "costsPctCommit" });
    expect(s.values.acquisitionCosts).toBe("960000");
    expect(isAutoFilled(s, "acquisitionCosts")).toBe(true);
    // ...and total cost, hence equity, follows it.
    s = run(s, type("debt", "30000000"), leave("debt"));
    expect(s.values.equity).toBe("34960000");
  });

  it("does not replace costs that were typed or carried forward", () => {
    let s = start({ acquisitionPrice: "64000000", acquisitionCosts: "600000" });
    s = run(s, { type: "costsPctDraft", raw: "5" }, { type: "costsPctCommit" });
    expect(s.values.acquisitionCosts).toBe("600000");
  });

  it("refuses a nonsense percentage rather than guessing", () => {
    let s = start({ acquisitionPrice: "64000000" });
    s = run(s, { type: "costsPctDraft", raw: "250" }, { type: "costsPctCommit" });
    expect(s.values.acquisitionCosts).toBe("");
  });
});

describe("a touched field is never overwritten", () => {
  it("keeps typed equity when debt changes, and clearing hands it back", () => {
    let s = start({ acquisitionPrice: "100000000" });
    s = run(s, type("debt", "60000000"), leave("debt"));
    expect(s.values.equity).toBe("40000000");

    // Typing over the auto-filled value keeps it ...
    s = run(s, type("equity", "38000000"), leave("equity"));
    expect(s.values.equity).toBe("38000000");
    expect(isAutoFilled(s, "equity")).toBe(false);
    s = run(s, type("debt", "50000000"), leave("debt"));
    expect(s.values.equity).toBe("38000000");
    expect(s.values.ltvPct).toBe("50");

    // ... until it is cleared, when the engine takes over again.
    s = run(s, type("equity", ""));
    expect(s.values.equity).toBe(""); // not refilled mid-edit
    s = run(s, leave("equity"));
    expect(s.values.equity).toBe("50000000");
    expect(isAutoFilled(s, "equity")).toBe(true);
  });

  it("never writes to anything carried forward from the last version", () => {
    const s = start({
      acquisitionPrice: "64000000", acquisitionCosts: "600000", capex: "1000000",
      debt: "30000000", equity: "25000000", ltvPct: "40", entryYieldPct: "3.2", noi: "1900800",
    });
    expect(s.values.equity).toBe("25000000");
    expect(s.values.ltvPct).toBe("40");
    expect(s.values.entryYieldPct).toBe("3.2");
  });

  it("an auto-filled debt does not come back after the person clears it", () => {
    let s = start({ acquisitionPrice: "100000000", equity: "40000000" });
    expect(s.values.debt).toBe("60000000");
    s = run(s, type("equity", ""), leave("equity"));
    expect(s.values.debt).toBe(""); // its only source is gone
    expect(s.values.equity).toBe(""); // and equity cannot be derived from an empty debt
  });

  it("whatever the inputs, a touched field comes back exactly as typed", () => {
    const touched = new Set(["acquisitionPrice", "debt", "equity", "ltvPct", "valuation"]);
    const values = {
      ...BLANK, acquisitionPrice: "100000000", debt: "55555555", equity: "1",
      ltvPct: "12.34", valuation: "7", noi: "1000000", entryYieldPct: "",
    };
    const out = applyDerivation({ values, touched });
    for (const k of touched) expect(out[k]).toBe(values[k as keyof typeof values]);
  });

  it("derives only the fields it is allowed to", () => {
    // Exit yield, exit value, debt cost, IRR, multiple and hold period stay manual.
    const s = start({
      acquisitionPrice: "64000000", noi: "1900800", debt: "30000000",
      grossRentalIncome: "2000000", erv: "2200000",
    });
    for (const k of ["exitValue", "exitYieldPct", "debtCostPct", "targetIrr", "targetEquityMultiple", "holdPeriodYears"]) {
      expect(s.values[k]).toBe("");
    }
    expect(DERIVABLE).not.toContain("exitYieldPct");
  });
});

describe("the real v-next revision", () => {
  const seed = {
    acquisitionPrice: "64000000", acquisitionCosts: "600000", capex: "1000000",
    debt: "30000000", grossRentalIncome: "2048000", noi: "1900800",
  };

  it("fills equity, LTV and entry yield with zero clicks", () => {
    const s = start(seed);
    expect(s.values.equity).toBe("35600000");
    expect(s.values.ltvPct).toBe("45.73");
    expect(s.values.entryYieldPct).toBe("2.97");
    expect(reconcile(s.values, "GBP")).toEqual([]);
  });

  it("warns on the recorded GBP 25.0m equity, naming the GBP 10.6m gap", () => {
    const s = start({ ...seed, equity: "25000000" });
    const w = reconcile(s.values, "GBP");
    expect(w).toHaveLength(1);
    expect(w[0].group).toBe("sources");
    expect(w[0].message).toContain("£10,600,000");
    expect(w[0].message).toContain("short of total cost £65,600,000");
    expect(w[0].message).toContain("equity would be £35,600,000");
  });
});

describe("reconciliation thresholds", () => {
  const base = { acquisitionPrice: 100_000_000, debt: 60_000_000 };

  it("is silent inside the tolerance and speaks just outside it", () => {
    // Tolerance is 0.1% of total cost: GBP 100,000 here.
    expect(reconcile({ ...base, equity: 40_000_000 + 100_000 }, "GBP")).toEqual([]);
    expect(reconcile({ ...base, equity: 40_000_000 - 100_000 }, "GBP")).toEqual([]);
    expect(reconcile({ ...base, equity: 40_000_000 + 100_001 }, "GBP")).toHaveLength(1);
    expect(reconcile({ ...base, equity: 40_000_000 - 100_001 }, "GBP")).toHaveLength(1);
  });

  it("says over when sources exceed cost", () => {
    const [w] = reconcile({ ...base, equity: 45_000_000 }, "GBP");
    expect(w.message).toContain("£5,000,000 over total cost");
  });

  it("stays silent unless debt, equity and a price are all present", () => {
    expect(reconcile({ debt: 60_000_000, equity: 1 }, "GBP")).toEqual([]);
    expect(reconcile({ acquisitionPrice: 1e8, debt: 6e7 }, "GBP")).toEqual([]);
  });

  it("flags occupancy that disagrees with GRI / ERV beyond half a point", () => {
    expect(reconcile({ grossRentalIncome: 900_000, erv: 1_000_000, occupancyPct: 90.4 }, "GBP")).toEqual([]);
    const [w] = reconcile({ grossRentalIncome: 900_000, erv: 1_000_000, occupancyPct: 95 }, "GBP");
    expect(w.group).toBe("income");
    expect(w.message).toContain("90.00%");
    expect(w.message).toContain("£50,000");
  });

  it("uses the deal's own currency symbol", () => {
    const [w] = reconcile({ acquisitionPrice: 1e8, debt: 6e7, equity: 1e7 }, "EUR");
    expect(w.message).toContain("€");
  });
});
