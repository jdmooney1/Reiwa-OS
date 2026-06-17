// ============================================================================
// Sample investment scores (pre-Supabase) for the three authored deals.
// Each category carries a 1–10 score, IC commentary and a risk flag; the overall
// (0–100) and recommendation are computed from the model so they never drift.
// ============================================================================
import type { InvestmentScore, ScoreCategory } from "@/types/database";
import type { ScoreCategoryKey } from "@/lib/scoring/model";
import { SCORE_CATEGORIES, computeOverall, recommendationFor } from "@/lib/scoring/model";

interface SampleLine {
  score: number;
  commentary: string;
  risk_flag?: boolean;
}

interface Sample {
  scoredBy: string;
  summary: string;
  lines: Record<ScoreCategoryKey, SampleLine>;
}

const QG = "a1111111-1111-1111-1111-111111111111";
const CONDUIT = "a2222222-2222-2222-2222-222222222222";
const MAGNA = "a3333333-3333-3333-3333-333333333333";

export const SAMPLE_SCORES: Record<string, Sample> = {
  // 58 Queens Gate — prime PCL residential, value-add.
  [QG]: {
    scoredBy: "JD Mooney",
    summary:
      "A trophy prime-central-London asset scoring well on location, liquidity and strategic fit, with material reversionary and asset-management upside. The score is held back by weak in-place income and two flagged execution risks — listed-building consent and the EPC/MEES pathway — which the business plan must resolve. On balance a Proceed, conditional on planning visibility.",
    lines: {
      location_quality: { score: 10, commentary: "Prime South Kensington (SW7); among the most supply-constrained residential locations globally." },
      liquidity_exit: { score: 9, commentary: "Deep domestic and international UHNW buyer pool for best-in-class PCL stock." },
      income_security: { score: 4, commentary: "Low passing rent on tired multi-let configuration; income thesis is reversion-led, not in-place." },
      reversionary_potential: { score: 9, commentary: "Significant reversion from £950k passing toward £1.45m ERV, plus capital uplift on a £/sq ft basis." },
      asset_management_upside: { score: 8, commentary: "Comprehensive refurbishment into best-in-class lateral apartments." },
      capex_risk: { score: 5, commentary: "£6.5m programme; overrun and listed-fabric risk pending fixed-price contract.", risk_flag: true },
      planning_heritage_risk: { score: 3, commentary: "Grade II listing constrains internal reconfiguration; consent is the gating item.", risk_flag: true },
      tenant_covenant_risk: { score: 6, commentary: "Residential — limited single-covenant dependency." },
      japanese_depreciation: { score: 7, commentary: "Building-portion depreciation supports after-tax returns for Japanese investors." },
      fx_financing_resilience: { score: 6, commentary: "Conservative 55% LTV with rate cap; GBP/JPY equity hedge to be sized." },
      strategic_fit: { score: 9, commentary: "Squarely within the PCL value-add mandate and investor appetite." },
    },
  },

  // 16 Conduit Street — Mayfair mixed office/retail, core-plus.
  [CONDUIT]: {
    scoredBy: "JD Mooney",
    summary:
      "A core-plus Mayfair asset with strong location, liquidity and in-place income, modest capex and a clean risk profile. Reversion and asset-management upside are more limited than a value-add play, but durable West End fundamentals and covenant strength support a confident Proceed.",
    lines: {
      location_quality: { score: 9, commentary: "Prime Mayfair / West End frontage with enduring occupier demand." },
      liquidity_exit: { score: 9, commentary: "Highly liquid; consistent institutional and private bid for prime West End." },
      income_security: { score: 8, commentary: "Established office and retail income with sound lease structure." },
      reversionary_potential: { score: 6, commentary: "Moderate reversion to ERV; less than a repositioning play." },
      asset_management_upside: { score: 6, commentary: "Selective lease re-gear and light refurbishment." },
      capex_risk: { score: 8, commentary: "Modest £3m programme; low execution risk." },
      planning_heritage_risk: { score: 7, commentary: "Limited constraints relative to listed stock." },
      tenant_covenant_risk: { score: 7, commentary: "Solid covenants; some lease-event exposure to manage.", risk_flag: true },
      japanese_depreciation: { score: 7, commentary: "Commercial building depreciation benefit available." },
      fx_financing_resilience: { score: 7, commentary: "50% LTV with rate cap; resilient to financing stress." },
      strategic_fit: { score: 8, commentary: "Trophy West End income aligns with investor objectives." },
    },
  },

  // Magna Plaza — Amsterdam landmark mixed-use, value-add.
  [MAGNA]: {
    scoredBy: "JD Mooney",
    summary:
      "A landmark Amsterdam repositioning with strong reversionary and asset-management upside and a prime Dam-Square location. The score is materially constrained by rijksmonument planning risk, a large capex programme and retail leasing risk — all flagged. A Proceed with Caution, contingent on the heritage and leasing workstreams.",
    lines: {
      location_quality: { score: 8, commentary: "Landmark building adjacent to Dam Square; prime but retail-exposed pitch." },
      liquidity_exit: { score: 6, commentary: "Narrower buyer pool for large repositioning assets." },
      income_security: { score: 5, commentary: "Elevated vacancy; income to be rebuilt through the business plan." },
      reversionary_potential: { score: 8, commentary: "Strong reversion from repositioning toward €5.2m ERV." },
      asset_management_upside: { score: 8, commentary: "F&B / experiential retail repositioning of a trophy asset." },
      capex_risk: { score: 4, commentary: "€12m programme within a protected monument; significant execution risk.", risk_flag: true },
      planning_heritage_risk: { score: 3, commentary: "Rijksmonument status materially constrains repositioning.", risk_flag: true },
      tenant_covenant_risk: { score: 5, commentary: "Retail occupancy and covenant risk during lease-up.", risk_flag: true },
      japanese_depreciation: { score: 6, commentary: "Depreciation benefit available; longer stabilisation period." },
      fx_financing_resilience: { score: 6, commentary: "60% LTV; EUR/JPY equity hedge required." },
      strategic_fit: { score: 7, commentary: "Trophy repositioning fits the value-add mandate." },
    },
  },
};

/** Build the composite InvestmentScore for a deal that has a sample, else null. */
export function buildSampleScore(dealId: string, now: string): InvestmentScore | null {
  const sample = SAMPLE_SCORES[dealId];
  if (!sample) return null;

  const categories: ScoreCategory[] = SCORE_CATEGORIES.map((def) => {
    const line = sample.lines[def.key];
    return {
      category: def.key,
      score: line.score,
      commentary: line.commentary,
      risk_flag: line.risk_flag ?? false,
    };
  });

  const scores = Object.fromEntries(
    categories.map((c) => [c.category, c.score]),
  ) as Record<ScoreCategoryKey, number>;
  const overall = computeOverall(scores);

  return {
    score_id: `score-${dealId}`,
    deal_id: dealId,
    overall_score: overall,
    recommendation: recommendationFor(overall),
    summary: sample.summary,
    categories,
    scored_by: sample.scoredBy,
    created_at: now,
    updated_at: now,
  };
}
