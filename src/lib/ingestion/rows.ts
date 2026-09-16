// ============================================================================
// Row extraction - a raw spreadsheet row plus a mapping becomes a typed draft.
// ----------------------------------------------------------------------------
// The raw row is never mutated and never reduced: it travels to the database in
// ingestion_items.raw_payload exactly as it was read, unmapped columns and all.
// This module only produces the CANDIDATE interpretation sitting beside it.
//
// Pure module. Fully unit tested.
// ============================================================================
import { FIELD_BY_KEY, IMPORTANT_FIELDS, type FieldKey } from "@/lib/ingestion/fields";
import type { ColumnMapping } from "@/lib/ingestion/mapping";
import {
  parseMoney, parsePercent, parseArea, parseDate, parseText, parseMultiline,
  isBlank, SQFT_PER_SQM, type CurrencyCode, type AreaUnit,
} from "@/lib/ingestion/parse-values";
import { normaliseCountry, normalisePostcode, propertyIdentityKey } from "@/lib/ingestion/normalise";

export interface ExtractedValue {
  field: FieldKey;
  value: string | number | null;
  /** Null for a value a human typed; 0-1 for anything a heuristic produced. */
  confidence: number | null;
  notes: string[];
  /** The literal source text, kept for provenance. */
  excerpt: string;
  /** Which column it came from, so provenance points at a cell. */
  sourceHeader: string;
  sourceIndex: number;
}

export interface RowIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  field?: FieldKey;
}

export interface ExtractedRow {
  /** Verbatim, including every unmapped column. Never discarded. */
  raw: Record<string, unknown>;
  values: Partial<Record<FieldKey, ExtractedValue>>;
  issues: RowIssue[];
  /** Mean confidence across machine-derived values, or null when there are none. */
  confidenceOverall: number | null;
  /** Important fields this row does not supply. Reported, never invented. */
  missingFields: FieldKey[];
  /** Headers kept on the row but not mapped to a field. */
  unmappedHeaders: string[];
  /** Null when there is not enough to identify a property: always review. */
  identityKey: string | null;
  /** True when the row carries nothing usable at all. */
  isEmpty: boolean;
}

export interface RowOptions {
  /** Batch default, applied only where a row does not state its own currency. */
  defaultCurrency?: CurrencyCode;
  /** Batch default for area columns whose header did not state a unit. */
  defaultAreaUnit?: AreaUnit;
  defaultCountry?: string | null;
}

/**
 * Interpret one row. `cells` is positional and must align with the mapping
 * indices; a short row is padded rather than rejected, because trailing empty
 * cells are normal in exported spreadsheets.
 */
export function extractRow(
  cells: readonly unknown[],
  mappings: readonly ColumnMapping[],
  options: RowOptions = {},
): ExtractedRow {
  const raw: Record<string, unknown> = {};
  const values: Partial<Record<FieldKey, ExtractedValue>> = {};
  const issues: RowIssue[] = [];
  const unmappedHeaders: string[] = [];

  // 1. Preserve the row verbatim, under its original header names.
  for (const mapping of mappings) {
    const cell = cells[mapping.index];
    const key = raw[mapping.header] === undefined
      ? mapping.header
      : `${mapping.header} (${mapping.index + 1})`;   // duplicate headers stay distinct
    raw[key || `column_${mapping.index + 1}`] = cell ?? null;
    if (!mapping.field && !isBlank(cell)) unmappedHeaders.push(mapping.header);
  }

  const nonEmpty = cells.some((c) => !isBlank(c));
  if (!nonEmpty) {
    return {
      raw, values, issues, confidenceOverall: null,
      missingFields: [...IMPORTANT_FIELDS], unmappedHeaders,
      identityKey: null, isEmpty: true,
    };
  }

  // 2. Interpret the mapped columns.
  const currencies = new Set<CurrencyCode>();

  for (const mapping of mappings) {
    if (!mapping.field) continue;
    const cell = cells[mapping.index];
    if (isBlank(cell)) continue;

    const extracted = interpret(mapping.field, cell, options);
    if (!extracted) continue;

    // A mapping the user has not confirmed caps the value's confidence: the
    // column may simply be the wrong one.
    if (extracted.confidence !== null && mapping.confidence < 1) {
      extracted.confidence = Number((extracted.confidence * mapping.confidence).toFixed(3));
      extracted.notes = [...extracted.notes, `unconfirmed_mapping:${mapping.method}`];
    }

    extracted.sourceHeader = mapping.header;
    extracted.sourceIndex = mapping.index;
    values[mapping.field] = extracted;

    if (extracted.currency) currencies.add(extracted.currency);

    for (const note of extracted.notes) {
      const severity = BLOCKING_NOTES.has(note) ? "error" : "warning";
      issues.push({
        severity, code: note, field: mapping.field,
        message: `${FIELD_BY_KEY[mapping.field].label}: ${noteMessage(note, extracted.excerpt)}`,
      });
    }
  }

  // 3. Currency: a row that names one wins; otherwise the batch default is
  //    applied and recorded as an assumption rather than as fact.
  resolveCurrency(values, currencies, issues, options);

  // 4. Area: fill the sibling unit only where the source stated a unit, and mark
  //    the derived one as such. Never invent a unit from magnitude.
  deriveArea(values, issues, options);

  if (options.defaultCountry && !values.country) {
    values.country = assumption("country", normaliseCountry(options.defaultCountry) ?? options.defaultCountry);
  }

  // 5. Normalise the postcode in place so identity keys are comparable.
  const postcode = values.postcode?.value;
  if (typeof postcode === "string") {
    const formatted = normalisePostcode(postcode);
    if (formatted) {
      values.postcode!.value = formatted;
    } else {
      values.postcode!.confidence = 0.3;
      issues.push({
        severity: "warning", code: "unrecognised_postcode", field: "postcode",
        message: `Postcode "${postcode}" is not a recognisable UK or Dutch postcode.`,
      });
    }
  }

  const identityKey = propertyIdentityKey({
    address: asString(values.address?.value),
    postcode: asString(values.postcode?.value),
    name: asString(values.property_name?.value),
    city: asString(values.city?.value),
  });

  if (!identityKey) {
    issues.push({
      severity: "warning", code: "no_identity_key",
      message: "Not enough address detail to match this against existing properties - it will need review.",
    });
  }

  const missingFields = IMPORTANT_FIELDS.filter((f) => values[f]?.value == null);
  for (const field of missingFields) {
    issues.push({
      severity: "warning", code: "missing_field", field,
      message: `${FIELD_BY_KEY[field].label} is not stated in this row.`,
    });
  }

  const scored = Object.values(values)
    .map((v) => v?.confidence)
    .filter((c): c is number => typeof c === "number");

  return {
    raw, values, issues,
    confidenceOverall: scored.length
      ? Number((scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(3))
      : null,
    missingFields, unmappedHeaders, identityKey,
    isEmpty: false,
  };
}

// ---- Field interpretation --------------------------------------------------
type Interpreted = ExtractedValue & { currency?: CurrencyCode | null; unit?: AreaUnit | null };

function interpret(field: FieldKey, cell: unknown, options: RowOptions): Interpreted | null {
  const def = FIELD_BY_KEY[field];
  const base = { field, sourceHeader: "", sourceIndex: -1 };

  switch (def.kind) {
    case "money": {
      const r = parseMoney(cell);
      return { ...base, value: r.value, confidence: r.confidence, notes: r.notes,
        excerpt: r.excerpt, currency: r.currency };
    }
    case "percent": {
      const r = parsePercent(cell);
      return { ...base, value: r.value, confidence: r.confidence, notes: r.notes, excerpt: r.excerpt };
    }
    case "area": {
      const r = parseArea(cell);
      // The field itself declares a unit; a header that stated a different one
      // is a genuine conflict rather than something to silently prefer.
      const notes = [...r.notes];
      if (r.unit && def.unit && r.unit !== def.unit) notes.push("area_unit_mismatch");
      return { ...base, value: r.value, confidence: r.confidence, notes, excerpt: r.excerpt,
        unit: r.unit ?? def.unit ?? options.defaultAreaUnit ?? null };
    }
    case "date": {
      const r = parseDate(cell);
      return { ...base, value: r.value, confidence: r.confidence, notes: r.notes, excerpt: r.excerpt };
    }
    case "integer": {
      const r = parsePercent(cell);
      return { ...base, value: r.value === null ? null : Math.round(r.value),
        confidence: r.confidence, notes: r.notes, excerpt: r.excerpt };
    }
    case "multiline": {
      const r = parseMultiline(cell);
      return { ...base, value: r.value, confidence: r.confidence, notes: r.notes, excerpt: r.excerpt };
    }
    default: {
      const r = parseText(cell);
      return { ...base, value: r.value, confidence: r.confidence, notes: r.notes, excerpt: r.excerpt };
    }
  }
}

function assumption(field: FieldKey, value: string | number | null): ExtractedValue {
  return {
    field, value, confidence: 0.5, notes: ["batch_default_applied"],
    excerpt: "", sourceHeader: "", sourceIndex: -1,
  };
}

function resolveCurrency(
  values: Partial<Record<FieldKey, ExtractedValue>>,
  currencies: Set<CurrencyCode>,
  issues: RowIssue[],
  options: RowOptions,
): void {
  if (currencies.size > 1) {
    issues.push({
      severity: "error", code: "mixed_currencies",
      message: `This row states more than one currency (${[...currencies].join(", ")}).`,
    });
    return;
  }

  const stated = values.currency?.value;
  if (typeof stated === "string" && stated.trim()) {
    values.currency!.value = stated.trim().toUpperCase();
    return;
  }

  const [detected] = [...currencies];
  if (detected) {
    values.currency = {
      field: "currency", value: detected, confidence: 1, notes: ["detected_from_value"],
      excerpt: "", sourceHeader: "", sourceIndex: -1,
    };
    return;
  }

  if (options.defaultCurrency) {
    values.currency = assumption("currency", options.defaultCurrency);
    return;
  }

  const hasMoney = (["asking_price", "passing_income", "erv", "noi"] as const)
    .some((f) => values[f]?.value != null);
  if (hasMoney) {
    issues.push({
      severity: "error", code: "currency_unknown",
      message: "This row has money values but no currency, and the import has no default.",
    });
  }
}

function deriveArea(
  values: Partial<Record<FieldKey, ExtractedValue>>,
  issues: RowIssue[],
  options: RowOptions,
): void {
  const sqft = values.floor_area_sqft;
  const sqm = values.floor_area_sqm;

  const unitless = (v: ExtractedValue | undefined) =>
    v && v.notes.includes("unit_not_stated") && !options.defaultAreaUnit;

  if (unitless(sqft) || unitless(sqm)) {
    issues.push({
      severity: "warning", code: "area_unit_assumed",
      message: "The area column does not state its unit; the column's own unit has been assumed.",
    });
  }

  if (sqft?.value != null && sqm?.value == null) {
    values.floor_area_sqm = derived("floor_area_sqm", Number(sqft.value) / SQFT_PER_SQM, sqft);
  } else if (sqm?.value != null && sqft?.value == null) {
    values.floor_area_sqft = derived("floor_area_sqft", Number(sqm.value) * SQFT_PER_SQM, sqm);
  } else if (sqft?.value != null && sqm?.value != null) {
    const implied = Number(sqm.value) * SQFT_PER_SQM;
    const drift = Math.abs(implied - Number(sqft.value)) / Number(sqft.value);
    if (drift > 0.05) {
      issues.push({
        severity: "warning", code: "area_mismatch",
        message: "The stated sq ft and sq m areas disagree by more than 5%.",
      });
    }
  }
}

function derived(field: FieldKey, value: number, from: ExtractedValue): ExtractedValue {
  return {
    field,
    value: Math.round(value),
    // A conversion is only as good as the figure it came from.
    confidence: from.confidence === null ? 0.9 : Number((from.confidence * 0.9).toFixed(3)),
    notes: ["derived_by_conversion"],
    excerpt: from.excerpt,
    sourceHeader: from.sourceHeader,
    sourceIndex: from.sourceIndex,
  };
}

const asString = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Notes that make a row unimportable until a human intervenes. */
const BLOCKING_NOTES = new Set(["mixed_currencies", "currency_unknown"]);

const NOTE_MESSAGES: Record<string, string> = {
  approximate_value: "the source hedges this figure",
  looks_like_unit_rate: "this looks like a rate per unit area, not a total",
  possible_fraction_not_percent: "this may be a fraction rather than a percentage",
  above_100_percent: "this is above 100%",
  ambiguous_separators: "the thousand and decimal separators are ambiguous",
  no_number_found: "no number could be read",
  negative_value: "the value is negative",
  unit_not_stated: "the area unit is not stated",
  area_unit_mismatch: "the stated unit does not match the column",
  day_month_ambiguous_assumed_day_first: "the day and month are ambiguous; day-first assumed",
  day_not_stated_assumed_first: "no day stated; the first of the month assumed",
  month_first_inferred: "read as month-first",
  unrecognised_date_format: "the date format was not recognised",
  invalid_date: "the date is not a real date",
  derived_by_conversion: "converted from the other area unit",
  batch_default_applied: "taken from the import default",
  detected_from_value: "read from the value itself",
};

function noteMessage(note: string, excerpt: string): string {
  if (note.startsWith("unconfirmed_mapping:")) {
    return "the column mapping has not been confirmed";
  }
  const base = NOTE_MESSAGES[note] ?? note;
  return excerpt ? `${base} ("${excerpt}")` : base;
}

/** Row values reduced to plain JSON, for ingestion_items.extracted. */
export function toExtractedPayload(row: ExtractedRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(row.values)) {
    if (!value) continue;
    out[field] = {
      value: value.value,
      confidence: value.confidence,
      notes: value.notes,
      excerpt: value.excerpt,
      source_header: value.sourceHeader,
      source_index: value.sourceIndex,
    };
  }
  return out;
}
