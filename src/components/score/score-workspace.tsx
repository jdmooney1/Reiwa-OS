"use client";

import { useMemo, useState, useTransition } from "react";
import type { StoredScore } from "@/lib/data/scores";
import { saveScoreAction } from "@/app/actions/score";
import { SCORE_CATEGORIES, weightedContribution } from "@/lib/scoring/model";
import {
  viewScore, scoreSummary, isValidScore, SCORE_MIN, SCORE_MAX, SCORE_STEP, MAX_COMMENTARY_CHARS,
  type CategoryScore,
} from "@/lib/scoring/score";
import { ScoreDial } from "@/components/shared/score-dial";
import { RadarChart } from "@/components/shared/radar-chart";
import { Section, Empty, Provenance, ActionError } from "@/components/workspace/primitives";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Row { key: CategoryScore["key"]; score: string; commentary: string; riskFlag: boolean }

const toRows = (s: StoredScore | null): Row[] =>
  SCORE_CATEGORIES.map((def) => {
    const c = s?.categories.find((x) => x.key === def.key);
    return { key: def.key, score: c?.score != null ? String(c.score) : "", commentary: c?.commentary ?? "", riskFlag: c?.riskFlag ?? false };
  });

const parse = (raw: string): number | null => (raw.trim() === "" ? null : Number(raw));

/**
 * Opportunity -> Score. Scoring is by hand: nothing here proposes a number. The
 * overall, the band and the radar recompute from the model as each criterion is
 * filled in, and the overall does not exist until all of them are, because a sum
 * over half the criteria is not a low score, it is no score.
 */
export function ScoreWorkspace({
  opportunityId, latest, history, canWrite,
}: {
  opportunityId: string;
  latest: StoredScore | null;
  history: Pick<StoredScore, "version" | "scoredAt" | "scoredByName" | "view">[];
  canWrite: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(latest));
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const categories: CategoryScore[] = rows.map((r) => {
    const n = parse(r.score);
    return { key: r.key, score: n !== null && isValidScore(n) ? n : null, commentary: r.commentary, riskFlag: r.riskFlag };
  });
  const view = useMemo(() => viewScore(categories), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = scoreSummary(view);
  const dirty = JSON.stringify(rows) !== JSON.stringify(toRows(latest));
  const set = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setSaved(false);
  };

  function save() {
    setError(undefined);
    startTransition(async () => {
      const res = await saveScoreAction(opportunityId, rows.map((r) => ({
        key: r.key, score: parse(r.score), commentary: r.commentary, riskFlag: r.riskFlag,
      })));
      if (res.error) setError(res.error); else setSaved(true);
    });
  }

  const nothingYet = !latest && view.scored === 0;

  return (
    <div>
      <Section
        eyebrow="Investment Score"
        title={latest ? `Version ${latest.version}${dirty ? " (unsaved changes)" : ""}` : "Not yet scored"}
        action={canWrite && (
          <div className="flex items-center gap-3">
            {saved && !dirty && <span className="text-2xs text-positive" role="status">Recorded.</span>}
            <button
              type="button" disabled={!dirty || pending} onClick={save}
              className="rounded bg-purple px-3.5 py-2 text-xs font-semibold text-surface hover:bg-purple-70 disabled:opacity-50"
            >
              {pending ? "Recording..." : "Record score"}
            </button>
          </div>
        )}
      >
        <ActionError message={error} />

        {nothingYet && canWrite && (
          <Empty
            title="No score recorded for this opportunity."
            hint="Score each criterion from 1 to 10 below. Higher is always better, including for the risk criteria: a high capex-risk score means low capex risk. The dial, the profile and the recommendation appear as you go."
          />
        )}
        {nothingYet && !canWrite && <Empty title="No score has been recorded for this opportunity." />}

        <div className={cn("grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]", nothingYet && "mt-6")}>
          <div>
            <div className="flex items-center gap-5">
              <ScoreDial score={view.overall} size={96} />
              <div>
                <div className="text-2xs uppercase tracking-label text-ink-faint">Recommendation</div>
                <div className="mt-0.5 text-lg text-ink">{view.recommendationLabel ?? "Not yet available"}</div>
                <div className="mt-1 text-xs text-ink-muted">
                  {view.complete
                    ? `${view.flagged.length} ${view.flagged.length === 1 ? "criterion" : "criteria"} flagged`
                    : `${view.scored} of ${view.total} criteria scored. The overall and the recommendation appear when every criterion has a score.`}
                </div>
              </div>
            </div>
            {summary && <p className="mt-4 max-w-measure text-sm leading-relaxed text-ink">{summary}</p>}
            {latest?.drift && (
              <p className="mt-3 border-l-2 border-caution pl-3 text-xs text-caution" role="status">
                The scoring model has changed since this was recorded: it read {latest.recordedOverall?.toFixed(1)} then and reads {latest.view.overall?.toFixed(1)} now. The figure shown is the one the current model gives.
              </p>
            )}
          </div>
          <div className="mx-auto w-full max-w-sm">
            <RadarChart
              data={SCORE_CATEGORIES.map((d) => ({ label: d.short, value: categories.find((c) => c.key === d.key)?.score ?? 0 }))}
              max={SCORE_MAX}
            />
            <Provenance>Criteria not yet scored sit at the centre.</Provenance>
          </div>
        </div>
      </Section>

      <Section eyebrow="Breakdown" title="Criteria">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="text-left">
                {["Criterion", "Weight", "Score", "Contribution", "Commentary", "Risk"].map((h, i) => (
                  <th key={h} scope="col" className={cn("border-b border-line pb-2 pr-4 text-2xs font-medium uppercase tracking-label text-ink-faint", i >= 1 && i <= 3 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SCORE_CATEGORIES.map((def) => {
                const r = rows.find((x) => x.key === def.key)!;
                const n = parse(r.score);
                const invalid = n !== null && !isValidScore(n);
                const contribution = n !== null && isValidScore(n) ? weightedContribution(n, def.weight) : null;
                return (
                  <tr key={def.key} className="align-top">
                    <td className="border-b border-line py-2.5 pr-4">
                      <div className="font-medium text-ink">{def.label}</div>
                      <div className="mt-0.5 max-w-xs text-2xs leading-snug text-ink-faint">{def.guidance}</div>
                    </td>
                    <td className="tabular border-b border-line py-2.5 pr-4 text-right text-ink-muted">{def.weight}</td>
                    <td className="border-b border-line py-2.5 pr-4 text-right">
                      {canWrite ? (
                        <input
                          type="number" inputMode="decimal" min={SCORE_MIN} max={SCORE_MAX} step={SCORE_STEP}
                          value={r.score} aria-label={`${def.label} score`} aria-invalid={invalid}
                          onChange={(e) => set(def.key, { score: e.target.value })}
                          className={cn("tabular h-8 w-20 rounded border bg-surface-card px-2 text-right text-sm text-ink focus:outline-none",
                            invalid ? "border-negative" : "border-line focus:border-line-strong")}
                        />
                      ) : (
                        <span className="tabular text-ink">{n ?? "-"}</span>
                      )}
                      {invalid && <div className="mt-1 text-2xs text-negative">1 to 10, in half points</div>}
                    </td>
                    <td className="tabular border-b border-line py-2.5 pr-4 text-right text-ink">
                      {contribution === null ? <span className="text-ink-faint">-</span> : contribution.toFixed(1)}
                    </td>
                    <td className="border-b border-line py-2.5 pr-4">
                      {canWrite ? (
                        <textarea
                          rows={2} value={r.commentary} maxLength={MAX_COMMENTARY_CHARS} aria-label={`${def.label} commentary`}
                          onChange={(e) => set(def.key, { commentary: e.target.value })}
                          className="w-full min-w-[16rem] rounded border border-line bg-surface-card px-2 py-1.5 text-xs text-ink focus:border-line-strong focus:outline-none"
                        />
                      ) : (
                        <p className="max-w-md whitespace-pre-line text-xs leading-relaxed text-ink-muted">{r.commentary || "-"}</p>
                      )}
                    </td>
                    <td className="border-b border-line py-2.5 text-center">
                      {canWrite ? (
                        <label className="inline-flex flex-col items-center gap-1 text-2xs text-ink-faint">
                          <input
                            type="checkbox" checked={r.riskFlag} aria-label={`Flag ${def.label} as a risk`}
                            onChange={(e) => set(def.key, { riskFlag: e.target.checked })}
                          />
                          flag
                        </label>
                      ) : (
                        r.riskFlag ? <span className="text-2xs font-medium text-negative">Flagged</span> : <span className="text-ink-faint">-</span>
                      )}
                      {r.riskFlag && r.commentary.trim() === "" && <div className="mt-1 text-2xs text-negative">say why</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-3 text-2xs uppercase tracking-label text-ink-faint">Overall</td>
                <td className="tabular pt-3 pr-4 text-right text-ink-muted">100</td>
                <td />
                <td className="tabular pt-3 pr-4 text-right text-base font-medium text-ink">
                  {view.overall === null ? <span className="text-ink-faint">-</span> : view.overall.toFixed(1)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      {history.length > 0 && (
        <Section eyebrow="History" title="Recorded versions">
          <ul className="divide-y divide-line border-y border-line">
            {history.map((h) => (
              <li key={h.version} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 text-sm">
                <span className="text-ink">Version {h.version}</span>
                <span className="text-xs text-ink-muted">
                  {h.view.complete ? `${h.view.overall?.toFixed(1)} (${h.view.recommendationLabel})` : `${h.view.scored} of ${h.view.total} scored`}
                </span>
                <span className="text-2xs text-ink-faint">{formatDate(h.scoredAt)}{h.scoredByName ? `, ${h.scoredByName}` : ""}</span>
              </li>
            ))}
          </ul>
          <Provenance>Each save is a new version; earlier ones are kept as they were recorded.</Provenance>
        </Section>
      )}
    </div>
  );
}
