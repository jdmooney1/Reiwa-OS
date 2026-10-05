// ============================================================================
// Underwriting: fill in what follows from what has been typed.
// ----------------------------------------------------------------------------
// Pure, like compare.ts: no server imports, so the form (a client component) and
// the tests use the same arithmetic.
//
// One rule governs everything here: FILL WHEN EMPTY, NEVER OVERWRITE.
//   - A field the person has typed in (or that carried forward from the version
//     being revised) is "touched". The engine never writes to it.
//   - A field that is empty, or that holds a value the engine itself filled, may
//     be written. Typing in an auto-filled field makes it touched; clearing it
//     to empty hands it back to the engine.
//   - So the derived values are a pure function of the touched inputs. They are
//     recomputed from scratch each time, which means they cannot go stale and two
//     fields can never derive from each other in a loop.
//
// Reverse rules (Debt from Equity, GRI from Occupancy, ...) fire only from a
// TOUCHED source, never from a value the engine filled. Otherwise an auto-filled
// Equity would resurrect the Debt the person has just cleared.
//
// Deliberately NOT derived, because each is a judgement and not arithmetic: exit
// yield and exit value, debt cost, target IRR, equity multiple, hold period.
//
// No schema change: every field here is an existing investment_cases column,
// and the server still validates whatever is posted.
// ============================================================================
import { formatMoney, formatPct } from "@/lib/format";
import { ALLOCATION_TOLERANCE, checkAllocation } from "@/lib/underwriting/allocation";
import type { Currency } from "@/types/database";

/** Fields the engine may fill. Everything else on the form is always the person's. */
export const DERIVABLE = [
  "acquisitionCosts", "equity", "debt", "ltvPct",
  "occupancyPct", "grossRentalIncome", "erv",
  "valuation", "entryYieldPct",
  "landValue", "buildingValue",
] as const;
export type DerivableKey = (typeof DERIVABLE)[number];

/** Inputs the arithmetic reads. Strings, exactly as they sit in the form. */
export type FormValues = Record<string, string>;

/** Debt + equity may differ from total cost by this share before it is a warning. */
export const SOURCES_TOLERANCE_RATIO = 0.001;
/** ... or by this many currency units, whichever is larger. */
export const SOURCES_TOLERANCE_FLOOR = 1;
/** Occupancy may differ from GRI / ERV by this many percentage points. */
export const OCCUPANCY_TOLERANCE_PTS = 0.5;

const isDerivable = (k: string): k is DerivableKey =>
  (DERIVABLE as readonly string[]).includes(k);

function parse(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

type Num = Partial<Record<string, number>>;

const isMoney = (k: string) => k !== "ltvPct" && k !== "occupancyPct" && k !== "entryYieldPct";
// landValue and buildingValue are money, so they take the default.

/** Matches the server bounds: money at least zero, percentages 0-100. */
function acceptable(key: DerivableKey, n: number): boolean {
  if (!Number.isFinite(n) || n < 0) return false;
  return isMoney(key) ? true : n <= 100;
}

const round = (key: DerivableKey, n: number) =>
  isMoney(key) ? Math.round(n) : Math.round(n * 100) / 100;

/** Same expression as the generated column: null without a price; costs and capex count as 0. */
export function totalCost(v: Num): number | undefined {
  if (v.acquisitionPrice === undefined) return undefined;
  return v.acquisitionPrice + (v.acquisitionCosts ?? 0) + (v.capex ?? 0);
}

const positive = (n: number | undefined): n is number => n !== undefined && n > 0;

/** Leverage is measured against value when there is one, otherwise against cost. */
function ltvAnchor(v: Num): number | undefined {
  const a = positive(v.valuation) ? v.valuation : totalCost(v);
  return positive(a) ? a : undefined;
}

/** Entry yield is measured against value when there is one, otherwise against price. */
function yieldAnchor(v: Num): number | undefined {
  const a = positive(v.valuation) ? v.valuation : v.acquisitionPrice;
  return positive(a) ? a : undefined;
}

interface Rule {
  target: DerivableKey;
  /** Sources that must be the person's own, not the engine's. */
  touched?: string[];
  calc: (v: Num, ctx: { costsPct: number | undefined }) => number | undefined;
}

// Order matters only so that fields which feed an anchor (costs, valuation) are
// settled before the fields measured against it.
const RULES: Rule[] = [
  // Acquisition costs from "% of price", once the person has committed one.
  { target: "acquisitionCosts",
    calc: (v, c) => (c.costsPct !== undefined && v.acquisitionPrice !== undefined
      ? v.acquisitionPrice * c.costsPct / 100 : undefined) },
  // Valuation from a typed entry yield, when valuation is blank.
  { target: "valuation", touched: ["entryYieldPct"],
    calc: (v) => (v.noi !== undefined && positive(v.entryYieldPct)
      ? v.noi / (v.entryYieldPct / 100) : undefined) },
  // Equity = total cost - debt; or Debt = total cost - equity if equity came first.
  { target: "equity",
    calc: (v) => {
      const tc = totalCost(v);
      return tc !== undefined && v.debt !== undefined ? tc - v.debt : undefined;
    } },
  { target: "debt", touched: ["equity"],
    calc: (v) => {
      const tc = totalCost(v);
      return tc !== undefined && v.equity !== undefined ? tc - v.equity : undefined;
    } },
  // LTV = debt / anchor; or Debt = LTV x anchor if LTV came first.
  { target: "debt", touched: ["ltvPct"],
    calc: (v) => {
      const a = ltvAnchor(v);
      return a !== undefined && v.ltvPct !== undefined ? v.ltvPct / 100 * a : undefined;
    } },
  { target: "ltvPct",
    calc: (v) => {
      const a = ltvAnchor(v);
      return a !== undefined && v.debt !== undefined ? v.debt / a * 100 : undefined;
    } },
  // Occupancy = GRI / ERV; reverses are GRI = ERV x occupancy, ERV = GRI / occupancy.
  { target: "occupancyPct",
    calc: (v) => (positive(v.erv) && v.grossRentalIncome !== undefined
      ? v.grossRentalIncome / v.erv * 100 : undefined) },
  { target: "grossRentalIncome", touched: ["occupancyPct"],
    calc: (v) => (v.erv !== undefined && v.occupancyPct !== undefined
      ? v.erv * v.occupancyPct / 100 : undefined) },
  { target: "erv", touched: ["occupancyPct"],
    calc: (v) => (positive(v.occupancyPct) && v.grossRentalIncome !== undefined
      ? v.grossRentalIncome / (v.occupancyPct / 100) : undefined) },
  // Value allocation: the two halves of the acquisition price. Whichever the person
  // types first, the other is the remainder; typing both is their own decision and
  // is checked, not overwritten (see reconcile()). Measured against the PRICE.
  { target: "buildingValue", touched: ["landValue"],
    calc: (v) => (v.acquisitionPrice !== undefined && v.landValue !== undefined
      ? v.acquisitionPrice - v.landValue : undefined) },
  { target: "landValue", touched: ["buildingValue"],
    calc: (v) => (v.acquisitionPrice !== undefined && v.buildingValue !== undefined
      ? v.acquisitionPrice - v.buildingValue : undefined) },
  // Entry yield = NOI / anchor. NOI, not gross rent: GRI / price overstates it.
  { target: "entryYieldPct",
    calc: (v) => {
      const a = yieldAnchor(v);
      return a !== undefined && v.noi !== undefined ? v.noi / a * 100 : undefined;
    } },
];

export interface DerivationInput {
  values: FormValues;
  /** Fields the person owns (typed, or carried forward). Never written. */
  touched: ReadonlySet<string>;
  /** The field being typed in right now: left alone so a backspace to empty is not undone mid-edit. */
  holding?: string | null;
  /** Committed "acquisition costs as % of price", as typed. */
  costsPct?: string;
}

/**
 * Recompute every engine-owned field from the touched inputs. Returns the full
 * set of values for the form. Touched and held fields come back exactly as
 * they were.
 */
export function applyDerivation(input: DerivationInput): FormValues {
  const { values, touched, holding = null } = input;
  const costsPct = parse(input.costsPct);

  const owned = (k: string) => touched.has(k) || k === holding;
  const out: FormValues = { ...values };
  const num: Num = {};
  for (const [k, raw] of Object.entries(values)) {
    // An engine-owned field starts empty each time; everything else is read as typed.
    if (isDerivable(k) && !owned(k)) out[k] = "";
    else {
      const n = parse(raw);
      if (n !== undefined) num[k] = n;
    }
  }
  for (const k of DERIVABLE) if (!(k in out)) out[k] = "";

  for (let pass = 0; pass < DERIVABLE.length + 1; pass++) {
    let changed = false;
    for (const rule of RULES) {
      const t = rule.target;
      if (owned(t) || num[t] !== undefined) continue;
      if (rule.touched && !rule.touched.every((k) => touched.has(k))) continue;
      const raw = rule.calc(num, { costsPct });
      if (raw === undefined) continue;
      const n = round(t, raw);
      if (!acceptable(t, n)) continue;
      num[t] = n;
      out[t] = String(n);
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}

// ---- The reducer the form runs ---------------------------------------------

export interface DeriveState {
  values: FormValues;
  touched: ReadonlySet<string>;
  holding: string | null;
  /** What is in the "% of price" box, and the value last committed from it. */
  costsPctDraft: string;
  costsPct: string;
}

export type DeriveAction =
  | { type: "edit"; name: string; raw: string }
  | { type: "blur"; name: string }
  | { type: "costsPctDraft"; raw: string }
  | { type: "costsPctCommit" };

function recompute(s: Omit<DeriveState, "values"> & { values: FormValues }): DeriveState {
  return {
    ...s,
    values: applyDerivation({
      values: s.values, touched: s.touched, holding: s.holding, costsPct: s.costsPct,
    }),
  };
}

/** Initial state: everything already on the version is the person's; the rest is filled. */
export function initDerive(seed: FormValues): DeriveState {
  const touched = new Set(Object.keys(seed).filter((k) => seed[k].trim() !== ""));
  return recompute({
    values: seed, touched, holding: null, costsPctDraft: "", costsPct: "",
  });
}

export function deriveReducer(state: DeriveState, action: DeriveAction): DeriveState {
  switch (action.type) {
    case "edit": {
      const touched = new Set(state.touched);
      // Typing claims the field. Emptying it hands it back to the engine, but the
      // refill waits for blur so the person is not fighting the cursor.
      if (action.raw.trim() === "") touched.delete(action.name);
      else touched.add(action.name);
      return recompute({
        ...state, touched, holding: action.name,
        values: { ...state.values, [action.name]: action.raw },
      });
    }
    case "blur":
      return state.holding === action.name ? recompute({ ...state, holding: null }) : state;
    case "costsPctDraft":
      return { ...state, costsPctDraft: action.raw };
    case "costsPctCommit": {
      const n = parse(state.costsPctDraft);
      // Anything that is not a sane percentage clears it rather than guessing.
      const costsPct = n !== undefined && n >= 0 && n <= 100 ? state.costsPctDraft.trim() : "";
      return recompute({ ...state, costsPct });
    }
  }
}

/** True when the engine, not the person, put the value in this field. */
export function isAutoFilled(state: DeriveState, name: string): boolean {
  return isDerivable(name) && !state.touched.has(name)
    && state.holding !== name && (state.values[name] ?? "").trim() !== "";
}

// ---- Reconciliation --------------------------------------------------------

export interface Warning {
  /** Which group of fields it concerns, so the form can put it beside them. */
  group: "sources" | "income" | "allocation";
  message: string;
}

/**
 * Figures that were entered but do not agree with each other. Never blocks
 * saving: an analyst may hold a deliberate difference. It names the gap.
 */
export function reconcile(values: Record<string, string | number | null>, currency: Currency): Warning[] {
  const v: Num = {};
  for (const [k, raw] of Object.entries(values)) {
    const n = parse(raw);
    if (n !== undefined) v[k] = n;
  }
  const out: Warning[] = [];
  const money = (n: number) => formatMoney(Math.round(n), currency);

  const tc = totalCost(v);
  if (tc !== undefined && v.debt !== undefined && v.equity !== undefined) {
    const sources = v.debt + v.equity;
    const gap = sources - tc;
    const tolerance = Math.max(SOURCES_TOLERANCE_FLOOR, Math.abs(tc) * SOURCES_TOLERANCE_RATIO);
    if (Math.abs(gap) > tolerance) {
      const needed = tc - v.debt;
      out.push({
        group: "sources",
        message:
          `Debt ${money(v.debt)} plus equity ${money(v.equity)} is ${money(sources)}, ` +
          `${money(Math.abs(gap))} ${gap < 0 ? "short of" : "over"} total cost ${money(tc)}.` +
          (needed >= 0 ? ` With this debt, equity would be ${money(needed)}.` : ""),
      });
    }
  }

  if (v.grossRentalIncome !== undefined && positive(v.erv) && v.occupancyPct !== undefined) {
    const implied = v.grossRentalIncome / v.erv * 100;
    if (Math.abs(implied - v.occupancyPct) > OCCUPANCY_TOLERANCE_PTS) {
      const expected = v.erv * v.occupancyPct / 100;
      out.push({
        group: "income",
        message:
          `Occupancy ${formatPct(v.occupancyPct)} does not match gross rental income ÷ ERV, ` +
          `which is ${formatPct(implied)}. At that occupancy, ERV ${money(v.erv)} implies income of ` +
          `${money(expected)}, ${money(Math.abs(v.grossRentalIncome - expected))} ` +
          `${v.grossRentalIncome < expected ? "below" : "above"} the ${money(v.grossRentalIncome)} entered.`,
      });
    }
  }

  const split = checkAllocation(v.acquisitionPrice, v.landValue, v.buildingValue);
  if (split && !split.ok) {
    out.push({
      group: "allocation",
      message:
        `Land ${money(v.landValue!)} plus building ${money(v.buildingValue!)} is ${money(v.landValue! + v.buildingValue!)}, ` +
        `${money(Math.abs(split.gap))} ${split.gap < 0 ? "short of" : "over"} the acquisition price ${money(v.acquisitionPrice!)}. ` +
        `The split has to come within ${(ALLOCATION_TOLERANCE * 100).toFixed(1)}% of the price before it can be saved.`,
    });
  }
  return out;
}
