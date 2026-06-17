import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/domain";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-navy/5 text-ink border-line",
  gold: "bg-gold/10 text-gold-deep border-gold/30",
  positive: "bg-positive/10 text-positive border-positive/25",
  caution: "bg-caution/10 text-caution border-caution/25",
  negative: "bg-negative/10 text-negative border-negative/25",
  muted: "bg-ink/[0.04] text-ink-muted border-line",
};

// Same tones, tuned for the dark navy header.
const TONE_CLASS_DARK: Record<Tone, string> = {
  neutral: "bg-white/10 text-surface border-white/15",
  gold: "bg-gold/15 text-gold-soft border-gold/40",
  positive: "bg-positive/20 text-emerald-200 border-positive/40",
  caution: "bg-caution/20 text-amber-200 border-caution/40",
  negative: "bg-negative/20 text-rose-200 border-negative/40",
  muted: "bg-white/5 text-surface/70 border-white/10",
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
            tone === "gold" && "bg-gold",
            (tone === "neutral" || tone === "muted") && "bg-ink-faint",
          )}
        />
      )}
      {children}
    </span>
  );
}
