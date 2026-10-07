// ============================================================================
// Turning the composed Teaser into the English a translator reads. PURE.
// ----------------------------------------------------------------------------
// The input is a ComposedMemo and the overrides beside it: the SAME object the
// workspace and the print view render, with the human text applied. Nothing in this file
// opens a connection, imports a data module or looks at a table, so a fact that is not
// already in the memo object is not available to the translator. That is the boundary
// loadMemoSource() draws on the way in, drawn again on the way out
// (tests/unit/memo-translation-boundaries.test.ts holds it).
//
// WHAT IS SENT is exactly what an investor reading the English Teaser would see:
//   * the Teaser's seven sections only (resolveSection in the "teaser" format, so an
//     internal block a section carries is withheld exactly as it is in print);
//   * a section a person wrote by hand is sent as they wrote it;
//   * a section that is empty is NOT sent: there is nothing to translate and it must not
//     come back as invented text;
//   * a metric the record does not hold is dropped, as print drops it, never sent as
//     "Not recorded";
//   * every figure is the one the English page DISPLAYS ("£64,000,000", "14.2%", "1.90x"),
//     because the number a Japanese reader sees has to be the number an English reader
//     sees, so that is the number the translator is handed and the number the check
//     compares against.
//
// NOTHING ELSE. Not the IC sections, not the Snapshot, not the address, not a score or a
// decision, not the hand-written Japanese summary.
// ============================================================================
import {
  resolveSection, figuresLine, type Block, type ComposedMemo, type MemoOverrides,
} from "@/lib/memo/compose";
import { SECTION_LABEL, type MemoSectionKey } from "@/lib/memo/sections";
import { formatMetric } from "@/lib/memo/render";
import { TEASER_KEYS } from "@/lib/memo-translation/sections";

export interface SourceSection {
  key: MemoSectionKey;
  label: string;
  /** The section as an English reader sees it, as plain text. */
  text: string;
}

export interface TranslationSource {
  assetName: string;
  currency: string;
  /** Only the sections that have something to translate, in Teaser order. */
  sections: SourceSection[];
}

/** A block as the lines an English reader would read. Mirrors blockText(), minus rows print would not claim. */
function lines(b: Block, currency: string): string[] {
  switch (b.kind) {
    case "metrics":
      return b.items.filter((m) => m.value !== null && m.value !== "").map((m) => `${m.label}: ${formatMetric(m, currency)}`);
    case "text": return b.text.trim() ? [b.text] : [];
    case "facts": return b.items.map((i) => `${i.label}: ${i.value}`);
    case "list": return b.items.flatMap((i) => [[i.title, ...i.tags].join(" | "), ...(i.detail ? [i.detail] : [])]);
  }
}

export function buildTranslationSource(memo: ComposedMemo, overrides: MemoOverrides): TranslationSource {
  const sections: SourceSection[] = [];
  for (const key of TEASER_KEYS) {
    const resolved = resolveSection(memo.sections[key], overrides[key], "teaser");
    let body: string[];
    if (resolved.state === "edited") body = [(resolved.overrideText ?? "").trim()];
    // The English reader gets the standard figures line under a section that shows figures, so the
    // Japanese reader does too. Flags are empty in a teaser: how the underwriting stood is not said to an investor.
    else if (resolved.state === "composed") {
      body = [...resolved.blocks.flatMap((b) => lines(b, memo.currency)), ...resolved.flags,
        ...[figuresLine(resolved)].filter((l): l is string => l !== null)];
    }
    else continue;
    const text = body.filter(Boolean).join("\n");
    if (text) sections.push({ key, label: SECTION_LABEL[key], text });
  }
  return { assetName: memo.assetName, currency: memo.currency, sections };
}
