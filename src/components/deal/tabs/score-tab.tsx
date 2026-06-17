"use client";

import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown, Flag, Sparkles, ClipboardList } from "lucide-react";
import type { Deal, InvestmentScore } from "@/types/database";
import {
  SCORE_CATEGORIES, computeOverall, recommendationFor,
  weightedContribution, type ScoreCategoryKey,
} from "@/lib/scoring/model";
import { RECOMMENDATION_LABEL, RECOMMENDATION_TONE, scoreTone, pillarTone } from "@/lib/domain";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreDial } from "@/components/shared/score-dial";
import { RadarChart } from "@/components/shared/radar-chart";
import { cn } from "@/lib/utils";

interface Line {
  score: number;
  commentary: string | null;
  risk_flag: boolean;
}

const BAND_DESCRIPTION: Record<string, string> = {
  strong_proceed: "Conviction opportunity. Recommend advancing to investment committee.",
  proceed: "Attractive on balance. Recommend advancing, subject to outstanding diligence.",
  proceed_with_caution: "Merit offset by flagged risks. Advance only if key risks resolve.",
  weak: "Below threshold. Re-underwrite or renegotiate before proceeding.",
  reject: "Does not meet Reiwa's investment criteria. Recommend passing.",
};

export function ScoreTab({ deal, score }: { deal: Deal; score: InvestmentScore | null }) {
  // Seed editable state from the stored score (keyed by category).
  const seeded = useMemo(() => {
    const map = new Map<ScoreCategoryKey, Line>();
    score?.categories.forEach((c) =>
      map.set(c.category as ScoreCategoryKey, {
        score: c.score ?? 0,
        commentary: c.commentary,
        risk_flag: c.risk_flag,
      }),
    );
    return map;
  }, [score]);

  const [lines, setLines] = useState<Map<ScoreCategoryKey, Line>>(seeded);
  const hasScore = lines.size > 0;

  const overall = useMemo(() => {
    const scores: Partial<Record<ScoreCategoryKey, number>> = {};
    lines.forEach((l, k) => (scores[k] = l.score));
    return computeOverall(scores);
  }, [lines]);
  const recommendation = recommendationFor(overall);

  if (!hasScore) {
    return (
      <Card>
        <CardBody>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ClipboardList className="h-6 w-6 text-ink-faint" strokeWidth={1.5} />
            <div className="text-sm font-medium text-ink">Not yet scored</div>
            <div className="max-w-sm text-xs text-ink-faint">
              This deal has not been scored against Reiwa&apos;s 11 investment criteria.
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  const setScore = (key: ScoreCategoryKey, next: number) =>
    setLines((prev) => {
      const map = new Map(prev);
      const line = map.get(key);
      if (line) map.set(key, { ...line, score: Math.max(1, Math.min(10, next)) });
      return map;
    });

  const tone = RECOMMENDATION_TONE[recommendation];
  const radarData = SCORE_CATEGORIES.map((c) => ({
    label: c.short,
    value: lines.get(c.key)?.score ?? 0,
  }));
  const flaggedCount = Array.from(lines.values()).filter((l) => l.risk_flag).length;

  return (
    <div className="space-y-6">
      {/* Recommendation + radar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          className={cn(
            "lg:col-span-1",
            tone === "positive" && "border-positive/30 bg-positive/[0.03]",
            tone === "caution" && "border-caution/30 bg-caution/[0.03]",
            tone === "negative" && "border-negative/30 bg-negative/[0.03]",
          )}
        >
          <CardBody className="flex flex-col items-center gap-4 text-center">
            <div className="eyebrow">Reiwa Investment Score</div>
            <ScoreDial score={overall} size={120} max={100} />
            <div>
              <Badge tone={tone} className="text-xs">
                {RECOMMENDATION_LABEL[recommendation]}
              </Badge>
              <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-ink-muted">
                {BAND_DESCRIPTION[recommendation]}
              </p>
            </div>
            <div className="flex w-full items-center justify-around border-t border-line pt-3 text-center">
              <Stat label="Out of" value="100" />
              <Stat label="Criteria" value={String(SCORE_CATEGORIES.length)} />
              <Stat label="Flagged" value={String(flaggedCount)} tone={flaggedCount > 0 ? "caution" : undefined} />
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader eyebrow="Profile" title="Score Radar" />
          <CardBody>
            <div className="mx-auto max-w-md">
              <RadarChart data={radarData} max={10} size={340} />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Breakdown table */}
      <Card>
        <CardHeader
          eyebrow="Criteria"
          title="Score Breakdown"
          action={<span className="tabular text-2xs text-ink-faint">Weighted to 100</span>}
        />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Category", "Weight", "Score", "Contribution", "Commentary"].map((h, i) => (
                  <th
                    key={h}
                    className={cn(
                      "px-4 py-2 text-2xs font-medium uppercase tracking-label text-ink-faint",
                      (i === 1 || i === 2 || i === 3) && "text-center",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {SCORE_CATEGORIES.map((def) => {
                const line = lines.get(def.key);
                if (!line) return null;
                const contribution = weightedContribution(line.score, def.weight);
                return (
                  <tr key={def.key}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{def.label}</span>
                        {line.risk_flag && (
                          <span className="inline-flex items-center gap-0.5 text-2xs font-medium text-caution">
                            <Flag className="h-3 w-3" strokeWidth={2} /> Risk
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="tabular px-4 py-3 text-center text-ink-muted">{def.weight}</td>
                    <td className="px-4 py-3">
                      <ScoreStepper value={line.score} onChange={(v) => setScore(def.key, v)} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="tabular font-medium text-ink">{contribution.toFixed(1)}</div>
                      <div className="mx-auto mt-1 h-1 w-16 rounded-full bg-surface-sunken">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(contribution / def.weight) * 100}%`,
                            backgroundColor: STROKE[pillarTone(line.score)],
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-md text-xs text-ink-muted">
                      {line.commentary ?? <span className="italic text-ink-faint">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-surface-sunken/40">
                <td className="px-4 py-3 text-sm font-semibold text-ink">Overall</td>
                <td className="tabular px-4 py-3 text-center text-sm font-semibold text-ink">100</td>
                <td className="px-4 py-3" />
                <td className="tabular px-4 py-3 text-center text-base font-semibold text-ink">
                  {overall.toFixed(1)}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={tone}>{RECOMMENDATION_LABEL[recommendation]}</Badge>
                </td>
              </tr>
            </tfoot>
          </table>
        </CardBody>
      </Card>

      {/* Auto-generated summary placeholder */}
      <Card className="border-gold/30 bg-gold/[0.03]">
        <CardHeader
          eyebrow="Investment Committee"
          title="Auto-Generated Summary"
          action={
            <button
              disabled
              className="flex items-center gap-1.5 rounded border border-gold/40 px-2.5 py-1 text-2xs font-medium text-gold-deep opacity-70"
            >
              <Sparkles className="h-3 w-3" /> Regenerate
            </button>
          }
        />
        <CardBody>
          {score?.summary ? (
            <p className="text-sm leading-relaxed text-ink/90">{score.summary}</p>
          ) : (
            <p className="text-sm italic text-ink-faint">
              A narrative IC summary will be generated from the category scores and commentary.
            </p>
          )}
          <p className="mt-3 text-2xs text-ink-faint">
            Draft — to be generated from scores, commentary and the deal file. Scored by{" "}
            {score?.scored_by ?? "—"}.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

const STROKE: Record<string, string> = {
  positive: "#3E7C5A", gold: "#C2A14E", caution: "#B98427", negative: "#A6483D",
  neutral: "#C2A14E", muted: "#8A97A1",
};

function ScoreStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const tone = pillarTone(value);
  return (
    <div className="mx-auto flex w-14 items-center justify-center gap-1">
      <span
        className={cn(
          "tabular w-6 text-center text-sm font-semibold",
          tone === "positive" && "text-positive",
          tone === "gold" && "text-gold-deep",
          tone === "caution" && "text-caution",
          tone === "negative" && "text-negative",
        )}
      >
        {value}
      </span>
      <div className="flex flex-col">
        <button onClick={() => onChange(value + 1)} className="text-ink-faint hover:text-ink" aria-label="Increase">
          <ChevronUp className="h-3 w-3" />
        </button>
        <button onClick={() => onChange(value - 1)} className="text-ink-faint hover:text-ink" aria-label="Decrease">
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "caution" }) {
  return (
    <div>
      <div className="eyebrow mb-0.5">{label}</div>
      <div className={cn("tabular text-lg font-semibold", tone === "caution" ? "text-caution" : "text-ink")}>
        {value}
      </div>
    </div>
  );
}
