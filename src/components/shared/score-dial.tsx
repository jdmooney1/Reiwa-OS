import { cn } from "@/lib/utils";
import { scoreTone, pillarTone, type Tone } from "@/lib/domain";

const RING_STROKE: Record<Tone, string> = {
  positive: "#3E7C5A",
  accent: "#5F4A68",
  caution: "#B98427",
  negative: "#A6483D",
  neutral: "#5F4A68",
  muted: "#8A97A1",
};

/** Circular score dial. Defaults to the overall 0–100 scale; pass max={10} for a pillar. */
export function ScoreDial({
  score,
  size = 64,
  dark = false,
  max = 100,
}: {
  score: number | null | undefined;
  size?: number;
  dark?: boolean;
  max?: number;
}) {
  const value = score ?? 0;
  const pct = Math.max(0, Math.min(1, value / max));
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const tone = max === 10 ? pillarTone(score) : scoreTone(score);
  const display = score != null ? (max === 10 ? score.toFixed(1) : Math.round(score).toString()) : "—";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={4}
          stroke={dark ? "rgba(255,255,255,0.12)" : "#E2DBCD"}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={4}
          strokeLinecap="round"
          stroke={RING_STROKE[tone]}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="absolute flex flex-col items-center leading-none">
        <span
          className={cn(
            "tabular text-lg font-semibold",
            dark ? "text-ink" : "text-ink",
          )}
        >
          {display}
        </span>
        <span className={cn("text-[9px] uppercase tracking-label", dark ? "text-ink-faint" : "text-ink-faint")}>
          / {max}
        </span>
      </div>
    </div>
  );
}

/** Horizontal pillar score bar (out of 10). */
export function ScoreBar({ label, score }: { label: string; score: number | null }) {
  const value = score ?? 0;
  const tone = pillarTone(score);
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-32 shrink-0 text-xs text-ink-muted">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full"
          style={{ width: `${(value / 10) * 100}%`, backgroundColor: RING_STROKE[tone] }}
        />
      </div>
      <span className="tabular w-8 shrink-0 text-right text-xs font-medium text-ink">
        {score != null ? score.toFixed(1) : "—"}
      </span>
    </div>
  );
}
