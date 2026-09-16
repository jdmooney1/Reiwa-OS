// ============================================================================
// Column mapping - spreadsheet headers to canonical fields.
// ----------------------------------------------------------------------------
// Four passes, strongest first:
//   1. exact      - the normalised header is a known synonym
//   2. ambiguous  - a known near-synonym; suggested WITH a stated reason
//   3. fuzzy      - bigram similarity against synonyms and field labels
//   4. unmapped   - explicitly reported, never dropped
//
// The fourth pass is the point. An unrecognised column is surfaced as
// "kept, not mapped" and its value stays in the item's raw payload forever.
//
// Pure module. Fully unit tested.
// ============================================================================
import { FIELDS, FIELD_BY_KEY, isFieldKey, type FieldKey } from "@/lib/ingestion/fields";
import { HEADER_SYNONYMS, AMBIGUOUS_SYNONYMS, normaliseHeader } from "@/lib/ingestion/synonyms";
import { similarity } from "@/lib/ingestion/normalise";

export type MappingMethod = "exact" | "ambiguous" | "fuzzy" | "template" | "manual" | "unmapped";

export interface ColumnMapping {
  /** The header exactly as it appeared in the file. */
  header: string;
  /** Zero-based column index, so duplicate headers stay distinguishable. */
  index: number;
  field: FieldKey | null;
  method: MappingMethod;
  confidence: number;
  /** Why the user should look at this suggestion, if they should. */
  reason?: string;
}

/** Below this, a fuzzy suggestion is not worth making. */
const FUZZY_THRESHOLD = 0.72;

export interface SuggestOptions {
  /** A saved template's header -> field map, applied before anything else. */
  template?: Record<string, FieldKey | null>;
}

/**
 * Suggest a mapping for every header. Always returns one entry per column,
 * including blank and unrecognised ones.
 */
export function suggestMappings(
  headers: readonly string[],
  options: SuggestOptions = {},
): ColumnMapping[] {
  const used = new Set<FieldKey>();
  const results: ColumnMapping[] = headers.map((header, index) =>
    suggestOne(header, index, options.template));

  // A field may only be filled once. Where two columns claim it, the stronger
  // suggestion keeps it and the weaker is reported as a conflict rather than
  // silently overwriting during import.
  const byConfidence = [...results].sort((a, b) => b.confidence - a.confidence);
  for (const mapping of byConfidence) {
    if (!mapping.field) continue;
    if (used.has(mapping.field)) {
      mapping.reason = `Another column already maps to ${FIELD_BY_KEY[mapping.field].label}.`;
      mapping.field = null;
      mapping.method = "unmapped";
      mapping.confidence = 0;
    } else {
      used.add(mapping.field);
    }
  }

  return results;
}

function suggestOne(
  header: string,
  index: number,
  template?: Record<string, FieldKey | null>,
): ColumnMapping {
  const raw = header ?? "";
  const key = normaliseHeader(raw);

  if (!key) {
    return { header: raw, index, field: null, method: "unmapped", confidence: 0,
      reason: "Blank header." };
  }

  // 1. A saved template wins: the user already confirmed this mapping once.
  if (template) {
    // Presence, not truthiness: `??` would treat a deliberate null - a column the
    // user chose to leave unmapped - as "absent" and fall through to the guesses.
    const hasRaw = Object.prototype.hasOwnProperty.call(template, raw);
    const hasKey = Object.prototype.hasOwnProperty.call(template, key);
    const direct = hasRaw ? template[raw] : hasKey ? template[key] : undefined;
    if ((hasRaw || hasKey) && direct == null) {
      return { header: raw, index, field: null, method: "template", confidence: 1,
        reason: "Left unmapped by the saved template." };
    }
    if (direct && isFieldKey(direct)) {
      return { header: raw, index, field: direct, method: "template", confidence: 1 };
    }
  }

  // 2. Exact synonym.
  const exact = HEADER_SYNONYMS[key];
  if (exact) return { header: raw, index, field: exact, method: "exact", confidence: 1 };

  // 3. Known near-synonym - suggested, but the reason travels with it.
  const ambiguous = AMBIGUOUS_SYNONYMS[key];
  if (ambiguous) {
    return { header: raw, index, field: ambiguous.field, method: "ambiguous",
      confidence: 0.6, reason: ambiguous.reason };
  }

  // 4. Fuzzy, against both synonyms and field labels.
  let best: { field: FieldKey; score: number; against: string } | null = null;
  for (const [synonym, field] of Object.entries(HEADER_SYNONYMS)) {
    const score = similarity(key, synonym);
    if (!best || score > best.score) best = { field, score, against: synonym };
  }
  for (const def of FIELDS) {
    const score = similarity(key, normaliseHeader(def.label));
    if (!best || score > best.score) best = { field: def.key, score, against: def.label };
  }

  if (best && best.score >= FUZZY_THRESHOLD) {
    return {
      header: raw, index, field: best.field, method: "fuzzy",
      confidence: Number(best.score.toFixed(3)),
      reason: `Closest match to "${best.against}" - confirm before importing.`,
    };
  }

  return { header: raw, index, field: null, method: "unmapped", confidence: 0,
    reason: "Not recognised. The value is kept on the source row and can be mapped manually." };
}

// ---- Template shape --------------------------------------------------------
/**
 * A stable digest of a header row, used to offer a saved template the next time
 * the same broker's spreadsheet arrives. Order-insensitive, so a reordered
 * export still matches.
 */
export function headerSignature(headers: readonly string[]): string {
  return headers
    .map((h) => normaliseHeader(h))
    .filter(Boolean)
    .sort()
    .join("|");
}

/** Reduce confirmed mappings to the form stored on a template. */
export function toTemplateMappings(mappings: readonly ColumnMapping[]): Record<string, FieldKey | null> {
  const out: Record<string, FieldKey | null> = {};
  for (const m of mappings) {
    if (m.header) out[m.header] = m.field;
  }
  return out;
}

// ---- Reporting -------------------------------------------------------------
export interface MappingSummary {
  mapped: number;
  unmapped: number;
  needsConfirmation: number;
  /** Important fields no column supplies. Reported, never invented. */
  missingImportant: FieldKey[];
  unmappedHeaders: string[];
}

export function summariseMappings(mappings: readonly ColumnMapping[]): MappingSummary {
  const claimed = new Set(mappings.map((m) => m.field).filter(Boolean) as FieldKey[]);
  return {
    mapped: mappings.filter((m) => m.field).length,
    unmapped: mappings.filter((m) => !m.field).length,
    needsConfirmation: mappings.filter(
      (m) => m.field && (m.method === "ambiguous" || m.method === "fuzzy")).length,
    missingImportant: FIELDS.filter((f) => f.important && !claimed.has(f.key)).map((f) => f.key),
    unmappedHeaders: mappings.filter((m) => !m.field && m.header).map((m) => m.header),
  };
}
