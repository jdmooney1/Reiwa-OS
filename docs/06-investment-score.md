# 06 · Reiwa Investment Score

Every deal is scored out of 100 against Reiwa Capital's investment criteria. The model
lives in `src/lib/scoring/model.ts` (single source of truth for criteria, weights,
computation and recommendation bands).

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

## UI (Deal → Score tab)

- **Recommendation card** — overall dial (0–100), band, descriptor, flagged count.
- **Radar chart** — the 11 category scores (1–10) as a profile (`RadarChart`).
- **Score breakdown table** — category, weight, editable 1–10 score, weighted
  contribution (with a bar), commentary and risk flag; overall + recommendation
  recompute live as scores change.
- **Auto-generated summary** — IC narrative placeholder (stored sample summary shown as
  a draft; generation engine is a later phase).

Tone is institutional / IC, not gamified: no badges, streaks or celebratory states —
just the number, the band, and the reasoning.

## Data model

`investment_scores` (header: overall, recommendation, summary, scored_by) +
`investment_score_categories` (one row per criterion: score, commentary, risk_flag).
Weights are not stored on the row — they belong to the model so a re-weighting applies
consistently and historically. Sample scores for 58 Queens Gate, 16 Conduit Street and
Magna Plaza are in `src/lib/scoring/samples.ts` and `supabase/seed.sql`.
