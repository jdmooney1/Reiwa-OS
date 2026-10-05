// ============================================================================
// Reading and validating an Investment Score. Pure: no server imports.
// ----------------------------------------------------------------------------
// The criteria, weights, arithmetic and bands are src/lib/scoring/model.ts and
// are used as they are. This file adds only what a persisted score needs:
//
//   * the rule that an overall exists ONLY when every criterion is scored.
//     computeOverall() sums whatever it is given, so three categories out of
//     eleven would come back as a low number and a band of Reject. That is not a
//     low score, it is no score, and a recommendation built on it would be a
//     fabricated verdict. viewScore() returns null for both until all are in.
//   * a deterministic one-line summary built from the real scores (or null).
//     There is no stored summary and no template prose: the first score screen
//     died showing an IC summary drawn from a sample string.
//   * validation of what a form posts.
// ============================================================================
import {
  SCORE_CATEGORIES, CATEGORY_BY_KEY, RECOMMENDATION_BANDS, computeOverall, recommendationFor,
  weightedContribution, type ScoreCategoryKey,
} from "@/lib/scoring/model";
import type { Recommendation } from "@/types/database";

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
/** Scores move in half points. */
export const SCORE_STEP = 0.5;
export const MAX_COMMENTARY_CHARS = 4_000;

export interface CategoryScore {
  key: ScoreCategoryKey;
  /** 1-10 in half points, or null while unscored. */
  score: number | null;
  commentary: string;
  riskFlag: boolean;
}

export const isValidScore = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= SCORE_MIN && n <= SCORE_MAX
  && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;

export const RECOMMENDATION_LABEL: Record<Recommendation, string> =
  Object.fromEntries(RECOMMENDATION_BANDS.map((b) => [b.rec, b.label])) as Record<Recommendation, string>;

export interface ScoreView {
  scored: number;
  total: number;
  complete: boolean;
  /** Out of 100, one decimal. NULL until every criterion is scored. */
  overall: number | null;
  recommendation: Recommendation | null;
  recommendationLabel: string | null;
  /** Weighted contribution per criterion; null where unscored. */
  contributions: Record<ScoreCategoryKey, number | null>;
  /** Criteria flagged as risks, in model order. */
  flagged: ScoreCategoryKey[];
  /** The lowest-scored criterion (ties: heavier weight, then model order), or null. */
  weakest: { key: ScoreCategoryKey; score: number; flagged: boolean } | null;
}

export function viewScore(categories: readonly CategoryScore[]): ScoreView {
  const by = new Map(categories.map((c) => [c.key, c]));
  const scores: Partial<Record<ScoreCategoryKey, number>> = {};
  const contributions = {} as Record<ScoreCategoryKey, number | null>;
  const flagged: ScoreCategoryKey[] = [];
  for (const def of SCORE_CATEGORIES) {
    const c = by.get(def.key);
    if (c && c.score !== null && isValidScore(c.score)) {
      scores[def.key] = c.score;
      contributions[def.key] = weightedContribution(c.score, def.weight);
    } else {
      contributions[def.key] = null;
    }
    if (c?.riskFlag) flagged.push(def.key);
  }
  const scored = Object.keys(scores).length;
  const total = SCORE_CATEGORIES.length;
  const complete = scored === total;
  const overall = complete ? computeOverall(scores) : null;

  let weakest: ScoreView["weakest"] = null;
  for (const def of SCORE_CATEGORIES) {
    const s = scores[def.key];
    if (s === undefined) continue;
    const better = weakest === null || s < weakest.score
      || (s === weakest.score && def.weight > CATEGORY_BY_KEY[weakest.key].weight);
    if (better) weakest = { key: def.key, score: s, flagged: by.get(def.key)?.riskFlag === true };
  }
  const recommendation = overall === null ? null : recommendationFor(overall);
  return {
    scored, total, complete, overall, recommendation,
    recommendationLabel: recommendation ? RECOMMENDATION_LABEL[recommendation] : null,
    contributions, flagged, weakest,
  };
}

/**
 * "Overall 72.0 (Proceed). Weakest: Capex Risk (4/10, flagged). Flagged: Capex Risk."
 * Built only from the numbers and flags that exist; null until the score is
 * complete. Never a sentence about the deal.
 */
export function scoreSummary(view: ScoreView): string | null {
  if (!view.complete || view.overall === null || !view.recommendationLabel || !view.weakest) return null;
  const w = view.weakest;
  const parts = [
    `Overall ${view.overall.toFixed(1)} (${view.recommendationLabel}).`,
    `Weakest: ${CATEGORY_BY_KEY[w.key].label} (${w.score}/10${w.flagged ? ", flagged" : ""}).`,
  ];
  if (view.flagged.length > 0) parts.push(`Flagged: ${view.flagged.map((k) => CATEGORY_BY_KEY[k].label).join(", ")}.`);
  return parts.join(" ");
}

export type ScoreSubmission =
  | { ok: true; categories: CategoryScore[] }
  | { ok: false; error: string };

/**
 * What a form may post: a list of { key, score, commentary, riskFlag }. Every key
 * must be one the model defines, once; a score must be 1-10 in half points; a
 * flagged criterion needs commentary. An unscored row (score null) is allowed so a
 * score can be saved part-way, but it cannot carry a flag or commentary-only
 * state that would imply a verdict.
 */
export function validateScoreSubmission(raw: unknown): ScoreSubmission {
  if (!Array.isArray(raw)) return { ok: false, error: "The score could not be read." };
  const seen = new Set<string>();
  const out: CategoryScore[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return { ok: false, error: "The score could not be read." };
    const r = row as Record<string, unknown>;
    const key = r.key;
    if (typeof key !== "string" || !(key in CATEGORY_BY_KEY)) return { ok: false, error: "That is not a scoring criterion." };
    if (seen.has(key)) return { ok: false, error: `${CATEGORY_BY_KEY[key as ScoreCategoryKey].label} appears twice.` };
    seen.add(key);
    const label = CATEGORY_BY_KEY[key as ScoreCategoryKey].label;
    const score = r.score === null || r.score === undefined || r.score === "" ? null : Number(r.score);
    if (score !== null && !isValidScore(score)) {
      return { ok: false, error: `${label}: a score is 1 to 10, in half points.` };
    }
    const commentary = typeof r.commentary === "string" ? r.commentary.replace(/\r\n/g, "\n").trim() : "";
    if (commentary.length > MAX_COMMENTARY_CHARS) return { ok: false, error: `${label}: commentary is longer than ${MAX_COMMENTARY_CHARS.toLocaleString("en-GB")} characters.` };
    const riskFlag = r.riskFlag === true;
    if (riskFlag && commentary === "") return { ok: false, error: `${label}: say why it is flagged.` };
    if (score === null && (riskFlag || commentary !== "")) {
      return { ok: false, error: `${label}: give it a score before adding commentary or a flag.` };
    }
    out.push({ key: key as ScoreCategoryKey, score, commentary, riskFlag });
  }
  if (!out.some((c) => c.score !== null)) return { ok: false, error: "Score at least one criterion." };
  return { ok: true, categories: out };
}
