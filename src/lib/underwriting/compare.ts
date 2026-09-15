// ============================================================================
// Comparing two underwriting versions.
// ----------------------------------------------------------------------------
// Answers one question: what changed, and by how much. Pure, so it is testable
// without a database and cannot drift from what the screen renders.
//
// Deliberately NOT a spreadsheet diff. It walks the fixed reporting spine of an
// investment case, in the order an analyst reads it — cost, income, debt, value,
// return — and reports only the lines that moved. A comparison that lists forty
// unchanged rows to find the three that matter is a worse answer than none.
// ============================================================================
import type { UnderwritingVersion } from "@/lib/data/underwriting-types";

export type FieldKind = "money" | "percent" | "multiple" | "years" | "text";

export interface CompareField {
  key: keyof UnderwritingVersion;
  label: string;
  kind: FieldKind;
  group: "Cost" | "Income" | "Debt" | "Value & return" | "Narrative";
  /** True when a DECREASE is the favourable direction (costs, leverage). */
  lowerIsBetter?: boolean;
}

/** The spine, in reading order. Anything absent from here is not compared. */
export const COMPARE_FIELDS: CompareField[] = [
  { key: "acquisitionPrice", label: "Acquisition price", kind: "money", group: "Cost", lowerIsBetter: true },
  { key: "acquisitionCosts", label: "Acquisition costs", kind: "money", group: "Cost", lowerIsBetter: true },
  { key: "capex", label: "Capital expenditure", kind: "money", group: "Cost", lowerIsBetter: true },
  { key: "totalCost", label: "Total cost", kind: "money", group: "Cost", lowerIsBetter: true },
  { key: "equity", label: "Equity", kind: "money", group: "Cost" },

  { key: "grossRentalIncome", label: "Gross rental income", kind: "money", group: "Income" },
  { key: "noi", label: "Net operating income", kind: "money", group: "Income" },
  { key: "erv", label: "ERV", kind: "money", group: "Income" },
  { key: "occupancyPct", label: "Occupancy", kind: "percent", group: "Income" },

  { key: "debt", label: "Debt", kind: "money", group: "Debt" },
  { key: "ltvPct", label: "Leverage (LTV)", kind: "percent", group: "Debt", lowerIsBetter: true },
  { key: "debtCostPct", label: "Debt cost", kind: "percent", group: "Debt", lowerIsBetter: true },

  { key: "valuation", label: "Entry valuation", kind: "money", group: "Value & return" },
  { key: "exitValue", label: "Exit / stabilised value", kind: "money", group: "Value & return" },
  { key: "entryYieldPct", label: "Entry yield", kind: "percent", group: "Value & return" },
  { key: "exitYieldPct", label: "Exit yield", kind: "percent", group: "Value & return", lowerIsBetter: true },
  { key: "holdPeriodYears", label: "Hold period", kind: "years", group: "Value & return" },
  { key: "targetIrr", label: "Target IRR", kind: "percent", group: "Value & return" },
  { key: "targetEquityMultiple", label: "Equity multiple", kind: "multiple", group: "Value & return" },

  { key: "strategy", label: "Strategy", kind: "text", group: "Narrative" },
  { key: "thesis", label: "Investment thesis", kind: "text", group: "Narrative" },
  { key: "businessPlanAssumptions", label: "Business plan", kind: "text", group: "Narrative" },
];

export interface FieldChange {
  field: CompareField;
  from: string | number | null;
  to: string | number | null;
  /** Absolute movement; null for text and when either side is absent. */
  delta: number | null;
  /** Fractional movement (0.05 = +5%); null when `from` is absent or zero. */
  deltaPct: number | null;
  /** "better" / "worse" where the field has a direction; otherwise null. */
  direction: "better" | "worse" | null;
}

export interface AssumptionChange {
  key: string;
  from: unknown;
  to: unknown;
}

export interface VersionComparison {
  from: UnderwritingVersion;
  to: UnderwritingVersion;
  changes: FieldChange[];
  /** Strategy-specific inputs, which are free-form and so compared by key. */
  assumptionChanges: AssumptionChange[];
  unchangedCount: number;
}

function directionOf(f: CompareField, delta: number | null): "better" | "worse" | null {
  if (delta === null || delta === 0) return null;
  if (f.kind === "text") return null;
  // A field with no stated direction has no good or bad movement — occupancy
  // rising is good, equity rising is neither. Saying nothing beats guessing.
  if (f.lowerIsBetter === undefined && f.group === "Cost") return null;
  const improves = f.lowerIsBetter ? delta < 0 : delta > 0;
  return improves ? "better" : "worse";
}

export function compareVersions(
  from: UnderwritingVersion, to: UnderwritingVersion,
): VersionComparison {
  const changes: FieldChange[] = [];
  let unchangedCount = 0;

  for (const field of COMPARE_FIELDS) {
    const a = from[field.key] as string | number | null;
    const b = to[field.key] as string | number | null;
    // Both absent reads as unchanged, not as a change from nothing to nothing.
    if (a === b || ((a ?? null) === null && (b ?? null) === null)) {
      unchangedCount += 1;
      continue;
    }

    const numeric = field.kind !== "text" && typeof a === "number" && typeof b === "number";
    const delta = numeric ? b - a : null;
    const deltaPct = numeric && a !== 0 ? (b - a) / Math.abs(a) : null;

    changes.push({
      field,
      from: a ?? null,
      to: b ?? null,
      delta,
      deltaPct,
      direction: directionOf(field, delta),
    });
  }

  const keys = new Set([
    ...Object.keys(from.assumptions ?? {}),
    ...Object.keys(to.assumptions ?? {}),
  ]);
  const assumptionChanges: AssumptionChange[] = [];
  for (const key of [...keys].sort()) {
    const a = (from.assumptions ?? {})[key];
    const b = (to.assumptions ?? {})[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      assumptionChanges.push({ key, from: a ?? null, to: b ?? null });
    }
  }

  return { from, to, changes, assumptionChanges, unchangedCount };
}
