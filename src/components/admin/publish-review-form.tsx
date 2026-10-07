"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishVersionAction } from "@/app/actions/admin-portal";
import { ActionError } from "@/components/workspace/primitives";
import { phraseMatches } from "@/lib/publication/review";
import type { PublishReview } from "@/lib/data/publish-review";
import { cn } from "@/lib/utils";

const cell = "px-3 py-2 align-top text-xs";

/**
 * What is changing, who will see it, and a sentence to type back.
 *
 * The button stays disabled until the sentence matches, but that is a courtesy:
 * the server action receives the sentence and the digest of this page and refuses
 * the publish if either is wrong, so a request that never touched this form
 * publishes nothing.
 */
export function PublishReviewForm({ review, backHref }: { review: PublishReview; backHref: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const ready = phraseMatches(typed, review.phrase);
  const { diff } = review;
  const orgs = review.audience.length;

  function publish() {
    setError(undefined);
    start(async () => {
      const res = await publishVersionAction(review.versionId, review.publicationId, {
        digest: review.digest, typed,
      });
      if (res.error) { setError(res.error); return; }
      router.push(backHref);
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {review.warnings.length > 0 && (
        <ul className="space-y-2" aria-label="Warnings">
          {review.warnings.map((w) => (
            <li key={w.code} data-warning={w.code}
              className="border-l-2 border-caution bg-surface-card py-2 pl-3 pr-2 text-sm text-ink">
              {w.message}
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="who">
        <h2 id="who" className="eyebrow mb-2">Who will see this</h2>
        {orgs === 0 ? (
          <p className="text-sm text-ink-muted">No organisation can see this publication right now.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line text-sm">
            {review.audience.map((a) => (
              <li key={a.investorOrgId} className="flex justify-between px-3 py-2">
                <span>{a.organisation}</span>
                <span className="text-xs text-ink-muted">{a.documentLevel} documents</span>
              </li>
            ))}
          </ul>
        )}
        {review.notAbleToSee.length > 0 && (
          <p className="mt-2 text-xs text-ink-faint">
            Entitled but not able to see it: {review.notAbleToSee.map((n) => `${n.organisation} (${n.reason})`).join("; ")}.
          </p>
        )}
      </section>

      <section aria-labelledby="what">
        <h2 id="what" className="eyebrow mb-2">
          What is changing - {diff.changeCount} {diff.changeCount === 1 ? "change" : "changes"}
        </h2>
        {diff.changeCount === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="no-changes">
            Nothing differs from the live version. Publishing it replaces the version without changing what any investor sees.
          </p>
        ) : (
          <>
            {diff.fields.length > 0 && (
              <div className="overflow-x-auto border-y border-line">
                <table className="w-full text-left" data-testid="field-changes">
                  <thead className="text-2xs uppercase tracking-label text-ink-faint">
                    <tr>
                      <th className={cell}>Field</th>
                      <th className={cell}>{diff.firstPublication ? "Live now" : `Live (v${review.liveVersionNumber})`}</th>
                      <th className={cell}>This version (v{review.versionNumber})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {diff.fields.map((f) => (
                      <tr key={f.key} data-field={f.key}>
                        <td className={cn(cell, "font-medium text-ink")}>{f.label}</td>
                        <td className={cn(cell, "whitespace-pre-wrap text-ink-muted", f.before === null && "italic text-ink-faint")}>
                          {f.before ?? "nothing"}
                        </td>
                        <td className={cn(cell, "whitespace-pre-wrap text-ink", f.after === null && "italic text-negative")}>
                          {f.after ?? "removed"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {diff.documents.length > 0 && (
              <ul className="mt-4 divide-y divide-line border-y border-line text-sm" data-testid="document-changes">
                {diff.documents.map((d, i) => (
                  <li key={`${d.type}-${i}`} data-document={d.type} className="flex gap-3 px-3 py-2">
                    <span className={cn("w-16 shrink-0 text-2xs font-semibold uppercase tracking-label",
                      d.type === "removed" ? "text-negative" : d.type === "added" ? "text-positive" : "text-ink-muted")}>
                      {d.type}
                    </span>
                    <span>{d.title} <span className="text-xs text-ink-faint">({d.detail})</span></span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="confirm" className="border-t border-line pt-6">
        <h2 id="confirm" className="eyebrow mb-2">Confirm</h2>
        <p className="text-sm text-ink">
          Publishing is immediate and visible to the organisations above. To go ahead, type this sentence exactly:
        </p>
        <p className="mt-2 select-none rounded border border-line bg-surface-card px-3 py-2 font-mono text-sm text-ink"
          data-testid="phrase">{review.phrase}</p>
        <label className="mt-3 block text-xs text-ink-muted">
          Type the sentence
          <input type="text" value={typed} autoComplete="off" spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            onPaste={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            aria-describedby="phrase-help"
            className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-2.5 font-mono text-sm text-ink focus:border-line-strong focus:outline-none" />
        </label>
        <p id="phrase-help" className="mt-1 text-2xs text-ink-faint">
          Pasting is switched off so the sentence is read, not copied. Capitals and spacing do not matter.
        </p>
        <div className="mt-4"><ActionError message={error} /></div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={publish} disabled={!ready || pending}
            className="rounded bg-purple px-4 py-2 text-xs font-semibold text-surface hover:bg-purple-70 disabled:cursor-not-allowed disabled:opacity-40">
            {pending ? "Publishing..." : `Publish v${review.versionNumber} to ${orgs} ${orgs === 1 ? "organisation" : "organisations"}`}
          </button>
          <Link href={backHref} className="text-xs font-medium text-ink-muted hover:text-ink">Cancel</Link>
        </div>
      </section>
    </div>
  );
}
