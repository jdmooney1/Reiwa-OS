// ============================================================================
// How a memo's Japanese reads, in the workspace and in print. PURE.
// ----------------------------------------------------------------------------
// The Japanese Language Summary format used to be one hand-typed paragraph
// (overrides.japanese_summary). The translated Teaser extends it section by section
// (memos.ja_overrides) WITHOUT removing it: a finalised memo that already carries a
// hand-written summary must keep reading exactly as it did.
//
//   no accepted Japanese section  -> the legacy view, byte for byte what it was
//   any accepted Japanese section -> the Teaser view; the hand-written summary, if there
//                                    is one, fills the executive summary slot UNTIL a
//                                    translated executive summary is accepted
//
// This only READS. It deletes nothing and converts nothing: the hand-written text stays
// in `overrides` untouched whichever view is chosen.
// ============================================================================
import type { MemoSectionKey } from "@/lib/memo/sections";
import { JA_SECTION_LABEL, TEASER_KEYS, type JaOverrides } from "@/lib/memo-translation/sections";

export interface JapaneseSection {
  key: MemoSectionKey;
  label: string;
  /** Null when there is no Japanese for this section yet. */
  text: string | null;
  /** True when the text is the earlier hand-written summary standing in for the executive summary. */
  fromHandWrittenSummary: boolean;
}

export type JapaneseView =
  | { mode: "summary"; text: string }
  | { mode: "teaser"; sections: JapaneseSection[] };

export function japaneseView(ja: JaOverrides, handWrittenSummary: string | null | undefined): JapaneseView {
  const summary = (handWrittenSummary ?? "").trim() ? (handWrittenSummary as string) : "";
  if (Object.keys(ja).length === 0) return { mode: "summary", text: summary };
  return {
    mode: "teaser",
    sections: TEASER_KEYS.map((key) => {
      const own = ja[key] ?? null;
      const stand = own === null && key === "executive_summary" && summary !== "";
      return { key, label: JA_SECTION_LABEL[key] ?? key, text: stand ? summary : own, fromHandWrittenSummary: stand };
    }),
  };
}
