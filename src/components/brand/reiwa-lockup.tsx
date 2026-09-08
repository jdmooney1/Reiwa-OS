import Image from "next/image";
import { cn } from "@/lib/utils";

// ============================================================================
// The Reiwa Capital lockup.
// ----------------------------------------------------------------------------
// One asset — public/brand/reiwa-capital-logo.png, the official mark supplied by
// Reiwa Capital — rendered at two sizes and never altered. It is not recoloured,
// cropped, or rebuilt in CSS, and it is never placed on a dark ground: the
// artwork is single-colour purple on transparency, so it needs the cream.
//
// The wordmark it replaces used to be typed in CSS ("REIWA CAPITAL", half of it
// gold), which is why the product and the investor email did not look like the
// same company.
//
// `entry`  210px — the unauthenticated screens, where the mark is the page.
// `header` 132px — the signed-in portal masthead and the internal sidebar.
//
// There is deliberately no isolated-mark variant: the supplied artwork is a
// lockup, and cropping it to the mark alone would be altering it. A constrained
// context that needs the mark on its own needs a separate asset from Reiwa
// Capital rather than a crop here.
// ============================================================================

const RATIO = 4419 / 800; // the artwork's own aspect ratio

const SIZES = {
  entry: 210,
  header: 132,
} as const;

export function ReiwaLockup({
  size = "header",
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const width = SIZES[size];
  return (
    <Image
      src="/brand/reiwa-capital-logo.png"
      alt="Reiwa Capital"
      width={width}
      height={Math.round(width / RATIO)}
      // Always the first thing on the screens it appears on, so it is never
      // lazy-loaded into an empty masthead.
      priority
      className={cn("block h-auto max-w-full", className)}
    />
  );
}
