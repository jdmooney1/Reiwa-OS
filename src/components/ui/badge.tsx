import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/domain";

// ============================================================================
// Status and label.
// ----------------------------------------------------------------------------
// A dot and a word, not a filled pill.
//
// The pill was carrying no information the word did not already carry: every
// row had one, so none of them read as notable. Removing the fill and the
// border leaves the state itself — and gives the semantic colours somewhere to
// land, because now they are the only colour on the row.
//
// Colour is reserved for genuine state (published, withdrawn, in review). A
// label that is merely a category — an asset type, a market, a tier — takes
// `neutral` and stays in ink, which is why investor-facing surfaces read as
// predominantly neutral.
// ============================================================================

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-ink",
  accent: "text-purple",
  positive: "text-positive",
  caution: "text-caution",
  negative: "text-negative",
  muted: "text-ink-muted",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  dot = false,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
  /** Show the state dot. Omit for a plain category label. */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-2xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
