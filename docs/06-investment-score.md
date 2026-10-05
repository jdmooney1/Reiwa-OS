# 06 · Reiwa Investment Score

Every opportunity is scored out of 100 against Reiwa Capital's investment criteria. The
model lives in `src/lib/scoring/model.ts` (single source of truth for criteria, weights,
computation and recommendation bands).

> **Status.** Built (migration `0024_investment_scores.sql`).
>
> | | |
> | --- | --- |
> | **Model** | `src/lib/scoring/model.ts` - the 11 criteria, weights, `computeOverall`, `recommendationFor` and the bands. Unchanged. |
> | **Pure scoring layer** | `src/lib/scoring/score.ts` - `viewScore` (live overall, band, contributions, flagged), `scoreSummary` (deterministic sentence) and `validateScoreSubmission`. |
> | **Storage** | `investment_scores` + `investment_score_categories`, `org_id`-scoped, standard four RLS policies, staff only (investors never see them). |
> | **Screen** | Opportunity -> Score (`/opportunities/[id]/score`), shown to staff; read-only for `investor_viewer`. |
> | **Memo** | The Recommendation section shows the newest *complete* score beside the committee's recorded decision. Neither overwrites the other. Internal audience only. |
>
> **Decisions made while building it**
>
> - **Append-only versions.** Each save inserts a new `version`; nothing is edited in place, so
>   the history of how a view moved is kept.
> - **No `summary` column.** The one-line summary is composed on read from the real score and
>   flagged criteria. There is no stored or generated IC prose to go stale.
> - **Overall is NULL until all 11 criteria are scored.** A partial score is saved, but it has no
>   overall and no recommendation (DB `CHECK`), and the memo ignores it.
> - **Scores are 1-10 in half points.** A risk flag must carry commentary (DB `CHECK` and app
>   validation).
> - **Drift.** The recorded overall is kept as signed off; reads recompute through the current
>   model and flag when they differ (a re-weighting), rather than silently rewriting history.

## Criteria & weights (sum = 100)

| Category | Weight |
| --- | --- |
| Location quality | 15 |
| Liquidity & exit depth | 10 |
| Income security | 10 |
| Reversionary potential | 10 |
| Asset management upside | 10 |
| Capex risk | 10 |
| Planning & heritage risk | 10 |
| Tenant covenant risk | 5 |
| Japanese depreciation benefit | 10 |
| FX & financing resilience | 5 |
| Strategic fit | 5 |

Each category is scored **1–10** and carries **commentary** and a **risk flag**. For
the risk categories (capex, planning/heritage, covenant, FX) a *higher* score means
*lower* risk, so the model is uniformly "higher is better".

## Computation

```
contribution(category) = weight × score / 10
overall = Σ contribution        // 0–100
```

Because weights sum to 100, the overall is directly out of 100.

## Recommendation bands

| Overall | Recommendation |
| --- | --- |
| 85–100 | Strong Proceed |
| 70–84 | Proceed |
| 55–69 | Proceed with Caution |
| 40–54 | Weak |
| < 40 | Reject |

`recommendationFor(overall)` returns the band; the same bands drive the score colour
(`scoreTone`) used on the dial, pipeline cards and table.

## UI (Opportunity → Score)

- **Recommendation card** — overall dial (0–100) via `ScoreDial`, band, descriptor,
  flagged count.
- **Radar chart** — the 11 category scores (1–10) as a profile via `RadarChart`.
- **Score breakdown table** — category, weight, editable 1–10 score, weighted
  contribution, commentary and risk flag; overall and recommendation recompute live
  from `computeOverall` / `recommendationFor` as scores change.

Tone is institutional / IC, not gamified: no badges, streaks or celebratory states —
just the number, the band, and the reasoning.

An **auto-generated IC summary** was previously shown here as a draft, drawn from a
stored sample string. It is not reintroduced: the summary line is composed
deterministically from the real score and flagged criteria, or it is absent.

## Data model

`investment_scores` (header: `opportunity_id`, `version`, overall, recommendation,
scored_by, scored_at) + `investment_score_categories` (one row per criterion: score,
commentary, risk_flag). Both `org_id`-scoped like every other tenant table, with the
standard four RLS policies.

Weights are **not** stored on the row — they belong to the model, so a re-weighting
applies consistently. If Reiwa ever needs a score to be reproducible against the
weights in force on the day it was signed off, version the model rather than
denormalising weights onto the score: that is the same reasoning that makes an
approved `investment_case` immutable.
