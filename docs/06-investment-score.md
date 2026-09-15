# 06 · Reiwa Investment Score

Every opportunity is scored out of 100 against Reiwa Capital's investment criteria. The
model lives in `src/lib/scoring/model.ts` (single source of truth for criteria, weights,
computation and recommendation bands).

> **Status after Phase 0.**
>
> | | |
> | --- | --- |
> | **Exists today** | Nothing. There is no score screen and no score table. |
> | **Reusable domain logic** | `src/lib/scoring/model.ts` — the 11 criteria, their weights, `computeOverall`, `recommendationFor` and the bands. Pure, mock-free, unchanged by Phase 0. Presentation survives too: `RadarChart` and `ScoreDial` in `src/components/shared/`, with `scoreTone` / `pillarTone` in `src/lib/domain.ts`. |
> | **Phase 1 must build** | `investment_scores` + `investment_score_categories` tables keyed on `opportunity_id`, a server action to save a score, and the score screen. |
>
> The score tab rendered at `/deals/[dealId]/score` against fabricated category
> scores in `src/lib/scoring/samples.ts`. Both that screen and the sample scores
> were removed in Phase 0. **The criteria and the maths were never the problem
> and were kept intact.**

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

## UI Phase 1 should build (Opportunity → Score)

- **Recommendation card** — overall dial (0–100) via `ScoreDial`, band, descriptor,
  flagged count.
- **Radar chart** — the 11 category scores (1–10) as a profile via `RadarChart`.
- **Score breakdown table** — category, weight, editable 1–10 score, weighted
  contribution, commentary and risk flag; overall and recommendation recompute live
  from `computeOverall` / `recommendationFor` as scores change.

Tone is institutional / IC, not gamified: no badges, streaks or celebratory states —
just the number, the band, and the reasoning.

An **auto-generated IC summary** was previously shown here as a draft. It was drawn
from a stored sample string, not composed from the score. Phase 1 should not
reintroduce it as a placeholder: either it is generated from the real score and
flagged commentary, or the field is absent.

## Data model Phase 1 should build

`investment_scores` (header: `opportunity_id`, overall, recommendation, summary,
scored_by, scored_at) + `investment_score_categories` (one row per criterion: score,
commentary, risk_flag). Both `org_id`-scoped like every other tenant table, with the
standard four RLS policies.

Weights are **not** stored on the row — they belong to the model, so a re-weighting
applies consistently. If Reiwa ever needs a score to be reproducible against the
weights in force on the day it was signed off, version the model rather than
denormalising weights onto the score: that is the same reasoning that makes an
approved `investment_case` immutable.
