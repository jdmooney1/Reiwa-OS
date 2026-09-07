"use client";

// The investor-facing failure boundary.
//
// It renders NOTHING from the error object except `digest` — the opaque
// identifier Next.js assigns to a server-side failure. `error.message` is not
// shown, and must not be: in development it is the raw message, which for a
// database failure names a table, a constraint or a SQLSTATE. An investor has
// no use for any of it and no business seeing it.
//
// The digest is the thread back to the server log, which has the whole story.

import { AlertCircle } from "lucide-react";
import { AccessFrame } from "@/components/portal/access-frame";

export default function PortalError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AccessFrame>
      <div className="rounded-lg border border-line bg-surface-card px-7 py-7">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-negative" strokeWidth={1.75}
            aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="font-serif text-xl text-ink">This page could not be loaded</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Something went wrong at our end. Your access is unaffected — please try again in a
              moment, or contact your Reiwa Capital representative if it continues.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={reset}
            className="rounded bg-navy px-4 py-2 text-xs font-semibold text-surface hover:bg-navy-50">
            Try again
          </button>
          <a href="/portal"
            className="text-xs font-medium text-ink-muted hover:text-ink">
            Return to the portal
          </a>
        </div>

        {error.digest && (
          <p className="mt-5 border-t border-line pt-4 text-2xs text-ink-faint">
            Reference <span className="font-mono text-ink-muted">{error.digest}</span> — quote this
            if you get in touch.
          </p>
        )}
      </div>
    </AccessFrame>
  );
}
