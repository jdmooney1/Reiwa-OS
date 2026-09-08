"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { readCompare, removeCompare, clearCompare } from "@/lib/portal/compare-store";

/**
 * The comparison set lives in the browser, so the first visit to /portal/compare
 * arrives without it. This puts the selection into the URL once, after which the
 * page is an ordinary server render: the server resolves every id through the
 * investor's own entitlements, which is where the decision belongs.
 *
 * `?ids=` (empty) is the resolved-but-empty state, so this replace runs once and
 * never loops.
 */
export function CompareHydrator() {
  const router = useRouter();
  useEffect(() => {
    const ids = readCompare();
    router.replace(`/portal/compare?ids=${encodeURIComponent(ids.join(","))}`);
  }, [router]);

  // A quiet line and the rules the matrix will occupy, so the page does not
  // jump when the real figures arrive. No spinner: the wait is a single
  // client-side redirect, and a spinner would be the loudest thing on a page
  // built out of hairlines.
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="eyebrow">Preparing your comparison</p>
      <div className="mt-6 border-t border-line">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-8 border-b border-line py-3.5">
            <span className="h-2 w-32 rounded-sm bg-line/70" />
            <span className="h-2 w-16 rounded-sm bg-line/50" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading the selected opportunities.</span>
    </div>
  );
}

/** Drop one opportunity from the comparison and re-resolve on the server. */
export function RemoveFromCompare({ publicationId, title }: { publicationId: string; title: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={`Remove ${title} from comparison`}
      onClick={() => {
        const next = removeCompare(publicationId);
        router.replace(`/portal/compare?ids=${encodeURIComponent(next.join(","))}`);
      }}
      className="rounded p-1 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      <X className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  );
}

export function ClearCompare() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => { clearCompare(); router.replace("/portal/compare?ids="); }}
      className="text-2xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
    >
      Clear comparison
    </button>
  );
}

/**
 * Keeps the URL honest when the stored selection and the resolved set differ —
 * an opportunity that was withdrawn or had its entitlement revoked since it was
 * added is silently dropped by the server, so it is dropped here too.
 */
export function CompareReconciler({ resolvedIds }: { resolvedIds: string[] }) {
  useEffect(() => {
    const stored = readCompare();
    const stale = stored.filter((id) => !resolvedIds.includes(id));
    for (const id of stale) removeCompare(id);
  }, [resolvedIds]);
  return null;
}
