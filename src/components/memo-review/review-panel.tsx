"use client";

// ============================================================================
// The pre-finalisation review panel.
// ----------------------------------------------------------------------------
// Sits beside the Finalise control on purpose. It is meant to become the last
// thing a person does before locking a memo, the way a spellcheck pass is - so
// it has to be where their hand already is, not on another screen.
//
// IT IS ADVISORY AND IT LOOKS IT. Nothing here disables, hides or guards the
// Finalise button; the two components do not know about each other. A finding
// can be dismissed from the panel and the memo finalises with findings still
// showing, because the alternative - a model's false positive holding up a deal
// - is worse than a missed flag that a person was always going to be the real
// check on.
//
// A finding is READ-ONLY TEXT. There is no accept, no apply, no edit, no
// "use this wording": the panel has no action but "run another review" and
// "dismiss". Dismissal is local to this screen and is not written anywhere -
// it clears a line the person has dealt with, it does not resolve anything.
// ============================================================================
import { useState } from "react";
import { reviewMemoAction } from "@/app/actions/memo-review";
import type { StoredReview } from "@/lib/data/memo-reviews";
import { CATEGORY_LABEL, sectionLabels, type Finding } from "@/lib/memo-review/findings";
import { ActionError } from "@/components/workspace/primitives";
import { formatDate } from "@/lib/format";

const TONE: Record<string, string> = {
  numeric_inconsistency: "bg-negative/10 text-negative",
  internal_contradiction: "bg-negative/10 text-negative",
  outlier_metric: "bg-caution/10 text-caution",
  unresolved_gap: "bg-surface-sunken text-ink-muted",
};

export function ReviewPanel({
  opportunityId, memoId, format,
}: {
  opportunityId: string;
  memoId: string;
  format: string;
}) {
  const [review, setReview] = useState<StoredReview | null>(null);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    setError(undefined);
    const r = await reviewMemoAction(opportunityId, memoId, format);
    setPending(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    if (r.review) {
      setReview(r.review);
      setDismissed(new Set());
    }
  }

  const showing = review?.findings.map((f, i) => ({ f, i })).filter(({ i }) => !dismissed.has(i)) ?? [];

  return (
    <div className="space-y-4">
      <p className="max-w-measure text-sm leading-relaxed text-ink-muted">
        An optional last look over every section of this draft, including the internal ones, for figures that
        disagree between sections, an unusual metric, a leftover gap marker, or prose that contradicts itself.
        It reads the memo and reports what it noticed; it does not change a word of it, does not check any
        calculation, and never blocks finalising.
      </p>

      <div>
        <button
          type="button" disabled={pending} onClick={run}
          className="rounded border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50"
        >
          {pending ? "Reading the memo…" : review ? "Run the check again" : "Check before finalising"}
        </button>
        <div className="mt-2"><ActionError message={error} /></div>
      </div>

      {review && (
        <div className="space-y-3">
          <p className="text-2xs text-ink-faint">
            Checked {formatDate(review.createdAt)} by {review.createdByName ?? "a colleague"}, using {review.model}.
            {review.findings.length > 0 && dismissed.size > 0 && ` ${dismissed.size} of ${review.findings.length} dismissed on this screen.`}
          </p>

          {review.findings.length === 0 ? (
            <div className="border border-dashed border-line px-4 py-4">
              <p className="text-sm text-ink-muted">Nothing raised</p>
              <p className="mt-1 max-w-measure text-2xs text-ink-faint">
                The check found nothing it wanted to point at. That is not a confirmation that the memo is
                correct, complete or fit to send — it has read the words and the figures as recorded, nothing more.
              </p>
            </div>
          ) : showing.length === 0 ? (
            <p className="text-2xs text-ink-faint">Every item has been dismissed on this screen.</p>
          ) : (
            <ul className="space-y-2">
              {showing.map(({ f, i }) => (
                <FindingRow key={i} finding={f} onDismiss={() => setDismissed(new Set(dismissed).add(i))} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function FindingRow({ finding, onDismiss }: { finding: Finding; onDismiss: () => void }) {
  return (
    <li className="flex items-start justify-between gap-4 border border-line bg-surface-card px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-2xs font-medium ${TONE[finding.category] ?? "bg-surface-sunken text-ink-muted"}`}>
            {CATEGORY_LABEL[finding.category]}
          </span>
          <span className="text-sm font-medium text-ink">{finding.label}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{finding.reason}</p>
        <p className="mt-1 text-2xs text-ink-faint">{sectionLabels(finding.sections)}</p>
      </div>
      <button
        type="button" onClick={onDismiss}
        className="shrink-0 text-2xs text-ink-faint hover:text-ink"
        aria-label={`Dismiss: ${finding.label}`}
      >
        Dismiss
      </button>
    </li>
  );
}
