"use client";

// The internal (staff) failure boundary.
//
// Staff are trusted people, but the browser is not a trusted place to print a
// database message: it ends up in a screenshot, a support ticket or a shared
// screen. Same rule as the investor boundary — the digest, and nothing else
// from the error. The server log carries the SQLSTATE, the constraint and the
// stack, which is where an engineer should be reading them from anyway.

import { AlertTriangle } from "lucide-react";

export default function AppError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-negative" strokeWidth={1.75}
            aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight tracking-[-0.02em] text-ink">This screen could not be loaded</h1>
            <p className="mt-3 max-w-measure text-sm leading-relaxed text-ink-muted">
              The operation failed and nothing was changed. Try again, and if it persists the
              details are in the server log against the reference below.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-5">
          <button onClick={reset}
            className="rounded bg-purple px-4 py-2.5 text-xs font-medium text-surface transition-colors hover:bg-purple-70">
            Try again
          </button>
          <a href="/portfolio" className="text-xs font-medium text-ink-muted hover:text-ink">
            Back to the portfolio
          </a>
        </div>

        {error.digest && (
          <p className="mt-5 border-t border-line pt-4 text-2xs text-ink-faint">
            Reference <span className="font-mono text-ink-muted">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
