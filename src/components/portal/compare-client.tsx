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

  return (
    <p className="py-16 text-center text-sm text-ink-muted">Preparing your comparison…</p>
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
