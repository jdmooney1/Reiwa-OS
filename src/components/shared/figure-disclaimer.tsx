import { INVESTOR_FIGURES_DISCLAIMER } from "@/lib/investor-copy";
import { cn } from "@/lib/utils";

/**
 * The standard line under every figure an investor is shown: the portal, the publication
 * preview, the memo exports and the prospect link all render this one component, so the wording
 * cannot drift between them (src/lib/investor-copy.ts).
 */
export function FigureDisclaimer({ className }: { className?: string }) {
  return (
    <p data-disclaimer="figures" className={cn("text-2xs leading-relaxed text-ink-faint", className)}>
      {INVESTOR_FIGURES_DISCLAIMER}
    </p>
  );
}
