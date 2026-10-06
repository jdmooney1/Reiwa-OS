// ============================================================================
// The Teaser's sections, in Japanese. PURE.
// ----------------------------------------------------------------------------
// The one list of what can be translated: the Investor Teaser's own sections and
// nothing outside it. The Snapshot and the IC memo are out of scope, so a key outside
// this list can be neither sent to the model, nor named by it, nor saved.
//
// The headings are fixed labels that THIS FILE owns, not model output: a model that
// chose its own heading per run would give the same section two names across versions.
// ============================================================================
import { FORMAT_BY_KEY, type MemoSectionKey } from "@/lib/memo/sections";
import { MAX_OVERRIDE_CHARS } from "@/lib/memo/compose";

/** The Teaser's sections, in Teaser order. */
export const TEASER_KEYS: readonly MemoSectionKey[] = FORMAT_BY_KEY.teaser.sections;

export const isTeaserKey = (k: unknown): k is MemoSectionKey =>
  typeof k === "string" && (TEASER_KEYS as readonly string[]).includes(k);

/** Section headings for a Japanese Teaser. Fixed text, never generated. */
export const JA_SECTION_LABEL: Partial<Record<MemoSectionKey, string>> = {
  executive_summary: "エグゼクティブサマリー",
  key_metrics: "主要指標",
  asset_overview: "物件概要",
  location_market: "立地・市場",
  investment_thesis: "投資テーゼ",
  business_plan: "事業計画",
  exit_strategy: "出口戦略",
};

export type JaOverrides = Partial<Record<MemoSectionKey, string>>;

/** The most Japanese text one section may hold: the same bound an English override has. */
export const MAX_JA_CHARS = MAX_OVERRIDE_CHARS;

/**
 * Stored `ja_overrides`, checked. A key outside the Teaser or a value that is not text
 * is dropped, never rendered: the database constrains the keys, and this keeps a row
 * written by anything else from reaching a page.
 */
export function parseJaOverrides(raw: unknown): JaOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: JaOverrides = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isTeaserKey(k) && typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}
