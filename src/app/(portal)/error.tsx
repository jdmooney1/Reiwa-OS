"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AccessFrame } from "@/components/portal/access-frame";

/**
 * The investor-facing failure state (P6).
 *
 * An investor is an external party: they receive a professional explanation and
 * nothing else. No message, stack, SQLSTATE, table name or identifier from the
 * underlying error is rendered — the digest below is an opaque reference Next
 * generates, which the Reiwa team can match to the full server log.
 */
export default function PortalError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side logging already holds the detail; this records the client view.
    console.error("[portal] request failed", error.digest ?? "");
  }, [error]);

  return (
    <AccessFrame>
      <div className="rounded-lg border border-line bg-surface-card px-7 py-7">
        <h1 className="font-serif text-xl text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          We could not complete that request. This is our side, not yours. Please try again in a
          moment — if it keeps happening, your Reiwa Capital contact can help.
        </p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="rounded bg-navy px-4 py-2 text-xs font-semibold text-surface hover:bg-navy-50"
          >
            Try again
          </button>
          <Link
            href="/portal"
            className="rounded border border-line px-4 py-2 text-xs font-medium text-ink-muted hover:border-gold/40 hover:text-ink"
          >
            Back to the portal
          </Link>
        </div>
        {error.digest && (
          <p className="mt-5 text-2xs text-ink-faint">
            Reference {error.digest}
          </p>
        )}
      </div>
    </AccessFrame>
  );
}
