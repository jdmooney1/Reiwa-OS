import { cn } from "@/lib/utils";

/**
 * Confidence as a bar, not a number.
 *
 * The brief is explicit that confidence guides review without becoming the
 * interface. A reviewer needs to know which rows to look at, not that a figure
 * scored 0.913 — and these numbers must never reach an investor-facing screen,
 * which is why they live only on staged items and observations.
 */
export function ConfidenceBar({
  value,
  className,
}: {
  value: number | null;
  className?: string;
}) {
  if (value === null) {
    return <span className={cn("text-2xs text-ink-faint", className)}>—</span>;
  }

  const pct = Math.round(value * 100);
  const tone =
    value >= 0.85 ? "bg-positive" : value >= 0.7 ? "bg-gold" : "bg-caution";

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      title={`Extraction confidence ${pct}%`}
    >
      <span className="h-1 w-10 overflow-hidden rounded-full bg-ink/10">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      {value < 0.7 && <span className="text-2xs text-caution">low</span>}
    </span>
  );
}
