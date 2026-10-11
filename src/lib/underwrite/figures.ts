// ============================================================================
// Figures in the written assessment that the engine did not produce. PURE.
// ----------------------------------------------------------------------------
// The schema keeps figures out of every structured field, but prose can still
// carry one ("a 7% yen return at £58M"). This finds every percentage, money
// amount and multiple in the written fields and checks it against the figures
// the model was shown. One that matches nothing is listed on the tab as not from
// the model, so it is never read as the engine's. Advisory: it flags, it does
// not edit or block.
//
// Matching is by value at the precision the writer used: "8%" matches 8.0% or
// 7.96%; "£62.7M" matches 62.68M. Dates and counts are not checked.
// ============================================================================
import type { Assessment } from "@/lib/underwrite/assessment";

type Kind = "pct" | "money" | "mult";
interface Figure { kind: Kind; value: number; decimals: number; text: string }

const PCT = /(-|−)?\d+(?:\.\d+)?\s?%/g;
const MONEY = /[£€¥]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:bn|b|m|k)(?![a-z]))?|(?<![£€¥\d.,])\d+(?:\.\d+)?\s?(?:m|bn)(?![a-z])/gi;
const MULT = /\b\d+\.\d+\s?x\b/g;

const decimalsOf = (s: string) => (s.match(/\.(\d+)/)?.[1].length ?? 0);

function moneyValue(raw: string): { value: number; decimals: number } {
  const s = raw.replace(/[£€¥,\s]/g, "");
  const m = /^(\d+(?:\.\d+)?)(bn|b|m|k)?$/i.exec(s);
  if (!m) return { value: NaN, decimals: 0 };
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  // Compared in millions, which is how the model is shown money.
  const millions = unit === "bn" || unit === "b" ? n * 1000 : unit === "m" ? n : unit === "k" ? n / 1000 : n / 1e6;
  const scale = unit === "bn" || unit === "b" ? 3 : unit === "k" ? -3 : unit === "m" ? 0 : -6;
  return { value: millions, decimals: Math.max(0, decimalsOf(m[1]) - scale) };
}

function extract(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(PCT)) {
    const n = Number(m[0].replace(/[%\s−-]/g, "")) * (m[1] ? -1 : 1);
    out.push({ kind: "pct", value: n, decimals: decimalsOf(m[0]), text: m[0].trim() });
  }
  for (const m of text.matchAll(MONEY)) {
    const v = moneyValue(m[0]);
    if (Number.isFinite(v.value)) out.push({ kind: "money", value: v.value, decimals: v.decimals, text: m[0].trim() });
  }
  for (const m of text.matchAll(MULT)) {
    out.push({ kind: "mult", value: Number(m[0].replace(/[x\s]/g, "")), decimals: decimalsOf(m[0]), text: m[0].trim() });
  }
  return out;
}

/** Every written figure that does not round to any figure of the same kind in `shown`. */
export function unsourcedFigures(a: Assessment, shown: string): string[] {
  const known = extract(shown);
  const written = [
    a.headline, a.rationale, a.exposureReason, ...a.strengths, ...a.concerns.map((c) => c.text),
    ...a.evidence.flatMap((e) => [e.evidence, e.howToConfirm]), ...a.proposedTerms.rationale.map((r) => r.why),
    ...a.proposedTerms.otherTerms, ...a.icQuestions, ...a.dataGaps,
  ].join("\n");
  const out = new Set<string>();
  for (const f of extract(written)) {
    const tol = 0.5 * Math.pow(10, -f.decimals) + 1e-9;
    const match = known.some((k) => k.kind === f.kind && Math.abs(k.value - f.value) <= tol);
    if (!match) out.add(f.text);
  }
  return [...out];
}
