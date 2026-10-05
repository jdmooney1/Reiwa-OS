// ============================================================================
// Value allocation and depreciation: the arithmetic. Pure.
// ----------------------------------------------------------------------------
// The case stores four inputs (land value, building value, depreciation years and
// the method). Everything below is DERIVED from them on read and never stored, so
// a changed life assumption or exchange rate cannot leave a stale yen figure behind.
//
//   building share   building / (land + building)
//   annual charge    building / years            straight line, no residual value
//   yen              through GBP, the same helper as the price line (convertViaGbp)
//
// The annual charge is an ESTIMATE of straight-line accounting depreciation on the
// entered life. It is not a tax computation: how a Japanese investor may actually
// depreciate a foreign building (statutory lives, accelerated schedules for used
// assets) is tax advice, which the documents that carry it say Reiwa does not give.
// ============================================================================

/** The only method there is. Not a selector: nobody has asked for another. */
export const DEPRECIATION_METHODS = ["straight_line"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];
export const METHOD_LABEL: Record<DepreciationMethod, string> = { straight_line: "straight-line" };

/** Land plus building may differ from the price by this share. Mirrors migration 0027's CHECK. */
export const ALLOCATION_TOLERANCE = 0.005;
/** ... or by this many currency units, whichever is larger. Also mirrors 0027. */
export const ALLOCATION_TOLERANCE_FLOOR = 1;

export const MIN_LIFE_YEARS = 1;
export const MAX_LIFE_YEARS = 100;

const num = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export interface AllocationGap {
  /** Land + building - price. Positive when the split is more than the price. */
  gap: number;
  /** The most the gap may be, in currency units. */
  tolerance: number;
  ok: boolean;
}

/**
 * Whether a land/building split adds up to the price. Null when there is nothing to
 * check yet: either figure missing means the split is not claimed; a missing price
 * means there is nothing to reconcile against (the database refuses that case too).
 */
export function checkAllocation(
  price: number | null | undefined, land: number | null | undefined, building: number | null | undefined,
): AllocationGap | null {
  if (!num(land) || !num(building) || !num(price)) return null;
  const gap = land + building - price;
  const tolerance = Math.max(ALLOCATION_TOLERANCE_FLOOR, ALLOCATION_TOLERANCE * price);
  return { gap, tolerance, ok: Math.abs(gap) <= tolerance };
}

/** Land and building as shares of the allocated total, in percent. Null unless both are known and the total is positive. */
export function allocationShares(
  land: number | null | undefined, building: number | null | undefined,
): { landPct: number; buildingPct: number } | null {
  if (!num(land) || !num(building) || land < 0 || building < 0) return null;
  const total = land + building;
  if (!(total > 0)) return null;
  return { landPct: (land / total) * 100, buildingPct: (building / total) * 100 };
}

/** Straight-line annual depreciation, in the case currency. Null without a positive base and a whole-year life. */
export function annualDepreciation(
  building: number | null | undefined, years: number | null | undefined,
): number | null {
  if (!num(building) || building <= 0) return null;
  if (!num(years) || !Number.isInteger(years) || years < MIN_LIFE_YEARS || years > MAX_LIFE_YEARS) return null;
  return building / years;
}

export function isDepreciationMethod(v: unknown): v is DepreciationMethod {
  return typeof v === "string" && (DEPRECIATION_METHODS as readonly string[]).includes(v);
}

/** A message for the person, or null when the allocation is fine (or not yet claimed). */
export function allocationProblem(
  price: number | null | undefined, land: number | null | undefined, building: number | null | undefined,
  fmt: (n: number) => string,
): string | null {
  if (num(land) && num(building) && !num(price)) {
    return "Enter the acquisition price too: land and building value are a split of it, so there is nothing to reconcile them against without it.";
  }
  const c = checkAllocation(price, land, building);
  if (!c || c.ok) return null;
  return `Land value plus building value is ${fmt(land! + building!)}, ${fmt(Math.abs(c.gap))} ${c.gap < 0 ? "short of" : "over"} the acquisition price of ${fmt(price!)}. The split must come within ${(ALLOCATION_TOLERANCE * 100).toFixed(1)}% of the price.`;
}

export interface AllocationInput {
  price: number | null; land: number | null; building: number | null; years: number | null;
}

/**
 * What an underwriting submission may carry for the allocation, checked once for
 * the action and the tests: a whole-year life, a split that reconciles, and the
 * method set exactly when a life is given (there is only one method, so the person
 * is never asked for it). The database's CHECKs say the same; this is what turns
 * them into a sentence.
 */
export function resolveAllocation(
  i: AllocationInput, fmt: (n: number) => string,
): { ok: true; depreciationYears: number | null; depreciationMethod: DepreciationMethod | null } | { ok: false; error: string } {
  if (i.years !== null) {
    if (!Number.isInteger(i.years) || i.years < MIN_LIFE_YEARS || i.years > MAX_LIFE_YEARS) {
      return { ok: false, error: `Depreciation life must be a whole number of years from ${MIN_LIFE_YEARS} to ${MAX_LIFE_YEARS}.` };
    }
  }
  const problem = allocationProblem(i.price, i.land, i.building, fmt);
  if (problem) return { ok: false, error: problem };
  return { ok: true, depreciationYears: i.years, depreciationMethod: i.years === null ? null : "straight_line" };
}
