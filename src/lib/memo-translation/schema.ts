// ============================================================================
// What a translation is allowed to come back as. The schema is the enforcement.
// ----------------------------------------------------------------------------
// A CLOSED object keyed by the Teaser's own section keys, one string each. It is handed
// to the API as a structured-output format, so the model cannot name a section outside
// the Teaser, cannot add a field, and cannot answer in prose; parse() is then checked
// again here (zod) before anything reaches a person. `strictObject` makes an unknown key
// a rejection, not something quietly ignored.
//
// Which sections were SENT is not something the schema knows, so validateTranslation()
// checks that after it: every section sent comes back with text, and any text for a
// section that was not sent is discarded.
// ============================================================================
import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { MemoSectionKey } from "@/lib/memo/sections";
import { MAX_JA_CHARS, TEASER_KEYS } from "@/lib/memo-translation/sections";

const text = z.string().max(MAX_JA_CHARS);

export const TranslationSchema = z.strictObject({
  executive_summary: text,
  key_metrics: text,
  asset_overview: text,
  location_market: text,
  investment_thesis: text,
  business_plan: text,
  exit_strategy: text,
});

export type RawTranslation = z.infer<typeof TranslationSchema>;

/**
 * The Japanese for exactly the sections that were sent. A section sent and returned
 * empty is a failed translation, never "nothing to say": it throws rather than leave a
 * silent gap in a document a person is about to review.
 */
export function validateTranslation(
  sent: readonly MemoSectionKey[], raw: RawTranslation,
): Partial<Record<MemoSectionKey, string>> {
  const out: Partial<Record<MemoSectionKey, string>> = {};
  for (const key of TEASER_KEYS) {
    if (!sent.includes(key)) continue; // never asked for: dropped, never shown, never stored
    const t = (raw as Record<string, string>)[key]?.trim();
    if (!t) throw new AppError("The translation came back without text for every section, so nothing was recorded. Try again.");
    out[key] = t;
  }
  return out;
}
