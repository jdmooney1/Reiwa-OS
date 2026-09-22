import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/domain";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-plum/5 text-ink border-line",
  emphasis: "bg-plum/10 text-plum border-plum/30",
  positive: "bg-positive/10 text-positive border-positive/25",
  caution: "bg-caution/10 text-caution border-caution/25",
  negative: "bg-negative/10 text-negative border-negative/25",
  muted: "bg-ink/[0.04] text-ink-muted border-line",
};

// Same tones on a plum surface. The functional signals keep their own hue at a
// low tint; everything else reads as cream on plum.
const TONE_CLASS_DARK: Record<Tone, string> = {
  neutral: "bg-surface/10 text-surface border-surface/20",
  emphasis: "bg-surface/15 text-surface border-surface/30",
  positive: "bg-positive/25 text-surface border-positive/50",
  caution: "bg-caution/25 text-surface border-caution/50",
  negative: "bg-negative/25 text-surface border-negative/50",
  muted: "bg-surface/5 text-surface/70 border-surface/15",
};

export function Badge({
  children,
  tone = "neutral",
  dark = false,
  className,
  dot = false,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dark?: boolean;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-2xs font-medium",
        (dark ? TONE_CLASS_DARK : TONE_CLASS)[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "positive" && "bg-positive",
            tone === "caution" && "bg-caution",
            tone === "negative" && "bg-negative",
            tone === "emphasis" && "bg-plum",
            (tone === "neutral" || tone === "muted") && "bg-ink-faint",
          )}
        />
      )}
      {children}
    </span>
  );
}
