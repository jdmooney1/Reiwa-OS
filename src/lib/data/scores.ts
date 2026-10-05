// ============================================================================
// Investment Scores - the data layer over `investment_scores` and
// `investment_score_categories` (migration 0024).
// ----------------------------------------------------------------------------
// Every call runs under withSession, so RLS enforces organisation scope and write
// permission. A save is ALWAYS a new version: nothing here updates or deletes a
// score, so what the committee saw is never overwritten by a later re-score.
//
// The overall and the recommendation are not read back from the header. They are
// RECOMPUTED from the stored category scores through the model, so a re-weighting
// of src/lib/scoring/model.ts applies to every score read, as docs/06 requires.
// The value stored at save time is kept for reference, and `drift` says when the
// model has moved since.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";
import { staffNamesOn, nameOf, type NameDirectory } from "@/lib/data/directory";
import { AppError } from "@/lib/errors";
import { SCORE_CATEGORIES, type ScoreCategoryKey } from "@/lib/scoring/model";
import { viewScore, type CategoryScore, type ScoreView } from "@/lib/scoring/score";
import type { Recommendation } from "@/types/database";

export interface StoredScore {
  scoreId: string;
  opportunityId: string;
  version: number;
  scoredAt: string;
  scoredByName: string | null;
  /** All eleven criteria, in model order; unscored ones have score null. */
  categories: CategoryScore[];
  /** Recomputed from the categories through today's model. */
  view: ScoreView;
  /** What was stored when the score was recorded. */
  recordedOverall: number | null;
  recordedRecommendation: Recommendation | null;
  /** True when today's model gives a different overall from the one recorded. */
  drift: boolean;
}

const CATEGORY_SELECT = "select score_id, category_key, score, commentary, risk_flag from investment_score_categories";

function build(h: Record<string, any>, cats: Record<string, any>[], names: NameDirectory | null): StoredScore {
  const by = new Map(cats.map((c) => [c.category_key as string, c]));
  const categories: CategoryScore[] = SCORE_CATEGORIES.map((def) => {
    const c = by.get(def.key);
    return {
      key: def.key as ScoreCategoryKey,
      score: c ? num(c.score) : null,
      commentary: c ? str(c.commentary) ?? "" : "",
      riskFlag: c ? c.risk_flag === true : false,
    };
  });
  const view = viewScore(categories);
  const recordedOverall = num(h.overall);
  return {
    scoreId: h.score_id, opportunityId: h.opportunity_id, version: Number(h.version),
    scoredAt: new Date(h.scored_at).toISOString(),
    scoredByName: names ? nameOf(names, h.scored_by ?? null) : null,
    categories, view, recordedOverall,
    recordedRecommendation: (h.recommendation ?? null) as Recommendation | null,
    drift: view.complete && recordedOverall !== null && Math.abs((view.overall ?? 0) - recordedOverall) > 0.05,
  };
}

/** Every recorded version, newest first. */
export async function listScores(session: Session, opportunityId: string): Promise<StoredScore[]> {
  return withSession(session, async (tx: Queryable) => {
    const heads = await tx.query<Record<string, any>>(
      "select * from investment_scores where opportunity_id = $1 order by version desc", [opportunityId]);
    if (heads.rows.length === 0) return [];
    const cats = await tx.query<Record<string, any>>(
      `${CATEGORY_SELECT} where score_id = any($1::uuid[])`, [heads.rows.map((h) => h.score_id)]);
    const directory = await staffNamesOn(tx, heads.rows.map((h) => h.scored_by));
    return heads.rows.map((h) => build(h, cats.rows.filter((c) => c.score_id === h.score_id), directory));
  });
}

/** The current score: the highest version, complete or not. */
export async function latestScore(session: Session, opportunityId: string): Promise<StoredScore | null> {
  return (await listScores(session, opportunityId))[0] ?? null;
}

/**
 * The newest COMPLETE score, or null. A part-finished score is work in progress,
 * not a verdict, so nothing downstream (the memo) treats it as one.
 */
export async function latestCompleteScore(session: Session, opportunityId: string): Promise<StoredScore | null> {
  return (await listScores(session, opportunityId)).find((s) => s.view.complete) ?? null;
}

/**
 * Record a score as the next version. Only SCORED criteria get a category row.
 * The overall and recommendation are computed here, through the model, and are
 * NULL unless every criterion is scored.
 */
export async function saveScore(
  session: Session, opportunityId: string, categories: readonly CategoryScore[],
): Promise<string> {
  const view = viewScore(categories);
  return withSession(session, async (tx) => {
    const opp = await tx.query<{ org_id: string }>(
      "select org_id from opportunities where opportunity_id = $1", [opportunityId]);
    if (!opp.rows[0]) throw new AppError("That opportunity could not be found.");
    const last = await tx.query<{ v: number | null }>(
      "select max(version) as v from investment_scores where opportunity_id = $1", [opportunityId]);
    const version = (last.rows[0]?.v ? Number(last.rows[0].v) : 0) + 1;
    const head = await tx.query<{ score_id: string }>(
      `insert into investment_scores (org_id, opportunity_id, version, overall, recommendation, scored_by)
       values ($1, $2, $3, $4, $5, $6) returning score_id`,
      [opp.rows[0].org_id, opportunityId, version, view.overall, view.recommendation, session.userId]);
    const scoreId = head.rows[0].score_id;
    for (const c of categories) {
      if (c.score === null) continue;
      await tx.query(
        `insert into investment_score_categories (score_id, org_id, category_key, score, commentary, risk_flag)
         values ($1, $2, $3, $4, $5, $6)`,
        [scoreId, opp.rows[0].org_id, c.key, c.score, c.commentary === "" ? null : c.commentary, c.riskFlag]);
    }
    return scoreId;
  });
}
