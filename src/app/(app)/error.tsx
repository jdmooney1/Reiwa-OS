"use client";

import { useEffect } from "react";
import Link from "next/link";

/** The internal failure state (P6). Staff get a reference, not a stack trace. */
export default function AppError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] request failed", error.digest ?? "");
  }, [error]);

  return (
    <div className="flex min-h-full items-center justify-center px-8 py-16">
      <div className="max-w-md rounded-lg border border-line bg-surface-card px-7 py-7">
        <h1 className="font-serif text-xl text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          This screen could not be loaded. The failure has been recorded with the reference below;
          the full detail is in the server log.
        </p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <button type="button" onClick={reset}
            className="rounded bg-navy px-4 py-2 text-xs font-semibold text-surface hover:bg-navy-50">
            Try again
          </button>
          <Link href="/portfolio"
            className="rounded border border-line px-4 py-2 text-xs font-medium text-ink-muted hover:border-gold/40 hover:text-ink">
            Back to Reiwa OS
          </Link>
        </div>
        {error.digest && <p className="mt-5 text-2xs text-ink-faint">Reference {error.digest}</p>}
      </div>
    </div>
  );
}
