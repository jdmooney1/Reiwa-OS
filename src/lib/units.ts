// ============================================================================
// Area units. Pure.
// ----------------------------------------------------------------------------
// Japanese investors read floor area in tsubo. 1 tsubo is 400/121 square metres
// (3.3057851...), the traditional two-tatami measure. The constant below is the
// five-decimal figure the brief specifies, 3.30578: it differs from the exact
// fraction by 0.00005%, far below anything a whole-tsubo figure on a document shows.
//
// These are conversions of a recorded figure into another unit, not estimates, so
// a converted figure is shown without a qualifier. They never invent an area:
// null in, null out. Rounding is the caller's (a document shows whole tsubo; a
// calculation should not round at all).
// ============================================================================

/** Square metres in one tsubo. */
export const SQM_PER_TSUBO = 3.30578;

/** Square metres in one square foot (exact, by the definition of the international foot). */
export const SQM_PER_SQFT = 0.09290304;

const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

export function sqmToTsubo(sqm: number | null | undefined): number | null {
  return finite(sqm) ? sqm / SQM_PER_TSUBO : null;
}

export function sqftToSqm(sqft: number | null | undefined): number | null {
  return finite(sqft) ? sqft * SQM_PER_SQFT : null;
}

export function sqmToSqft(sqm: number | null | undefined): number | null {
  return finite(sqm) ? sqm / SQM_PER_SQFT : null;
}

export interface Area { sqft: number | null; sqm: number | null; tsubo: number | null }

/**
 * Every unit a document shows, from whichever of sq ft and sq m the record has.
 * When both are recorded both are returned exactly as recorded (they are two
 * people's numbers and may disagree by rounding; neither is overwritten) and tsubo
 * follows the square metres. Null when the record has neither.
 */
export function areaFrom(sqft: number | null | undefined, sqm: number | null | undefined): Area | null {
  if (!finite(sqft) && !finite(sqm)) return null;
  const m = finite(sqm) ? sqm : sqftToSqm(sqft);
  return {
    sqft: finite(sqft) ? sqft : sqmToSqft(sqm),
    sqm: m,
    tsubo: sqmToTsubo(m),
  };
}
