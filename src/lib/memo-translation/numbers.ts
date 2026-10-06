// ============================================================================
// Did every figure survive the translation? PURE. No model, no clock, no I/O.
// ----------------------------------------------------------------------------
// The rule the translator is held to is that a number a reader sees in Japanese is
// the number they would see in English. A prompt can ask for that; only a check can
// say whether it happened, so this is the check, and it reads the TEXT, not the model.
//
// A "figure" is a run of ASCII digits with its thousands commas and decimal part kept
// exactly as written: "64,000,000", "14.2", "1.90", "2026". The comparison is of the
// SPELLINGS, deliberately strict:
//
//   * "64,000,000" and "64000000" differ. A reformatting is a change a reader of the
//     English would not recognise.
//   * "14.2" and the full-width "１４．２" differ. Digits are carried as the digits they
//     were given as.
//   * "6,400万" fails: the English "64,000,000" is missing and "6,400" is unexpected.
//
// Two kinds of difference are reported, because they are different mistakes:
//   missing     a figure in the English that is not in the Japanese (dropped or altered)
//   unexpected  a figure in the Japanese that is not in the English (invented or altered)
//
// Compared as a MULTISET, so a figure that appears twice in the English must appear
// twice in the Japanese, and one figure cannot cover for another.
//
// What this does NOT do is judge whether the surrounding words are right. It is a
// tripwire for the most expensive failure, not a translation review: a pass means the
// numbers match, not that the Japanese is good.
// ============================================================================

const FIGURE = /\d+(?:,\d{3})*(?:\.\d+)?/g;

/** Every figure in the text, in order, spelled as written. */
export function figuresIn(text: string): string[] {
  return text.match(FIGURE) ?? [];
}

export interface FigureCheck {
  ok: boolean;
  /** In the English, not found in the Japanese. */
  missing: string[];
  /** In the Japanese, not found in the English. */
  unexpected: string[];
}

/** Compare the figures of an English source with those of its Japanese rendering. */
export function checkFigures(source: string, japanese: string): FigureCheck {
  const remaining = new Map<string, number>();
  for (const f of figuresIn(source)) remaining.set(f, (remaining.get(f) ?? 0) + 1);

  const unexpected: string[] = [];
  for (const f of figuresIn(japanese)) {
    const n = remaining.get(f) ?? 0;
    if (n > 0) remaining.set(f, n - 1);
    else unexpected.push(f);
  }
  const missing: string[] = [];
  for (const [f, n] of remaining) for (let i = 0; i < n; i++) missing.push(f);

  return { ok: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}

/** One sentence for a person, or null when the figures agree. */
export function figureProblem(c: FigureCheck): string | null {
  if (c.ok) return null;
  const parts: string[] = [];
  if (c.missing.length) parts.push(`missing from the Japanese: ${[...new Set(c.missing)].join(", ")}`);
  if (c.unexpected.length) parts.push(`in the Japanese but not the English: ${[...new Set(c.unexpected)].join(", ")}`);
  return `The figures differ (${parts.join("; ")}).`;
}
