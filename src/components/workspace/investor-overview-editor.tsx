"use client";

import { useState, useTransition } from "react";
import { saveInvestorOverviewAction } from "@/app/actions/admin-portal";
import { ActionError, Provenance, Section } from "@/components/workspace/primitives";

const MAX = 4000;

/**
 * The investor-facing wording for this opportunity, kept apart from the internal
 * summary on purpose.
 *
 * Only this text is ever copied into a new investor draft. The internal summary is
 * shown below it so a person can lift a sentence across, but that is a button they
 * press, after reading it, and then a second press on Save. Nothing here writes
 * the internal summary into anything an investor can reach.
 */
export function InvestorOverviewEditor({
  opportunityId, saved, internalSummary, hasPublication,
}: {
  opportunityId: string;
  saved: string | null;
  internalSummary: string | null;
  hasPublication: boolean;
}) {
  const [text, setText] = useState(saved ?? "");
  const [baseline, setBaseline] = useState(saved ?? "");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const dirty = text.trim() !== baseline.trim();

  function save() {
    setError(undefined);
    start(async () => {
      const res = await saveInvestorOverviewAction(opportunityId, text);
      if (res.error) setError(res.error);
      else setBaseline(text.trim());
    });
  }

  return (
    <Section eyebrow="Investors" title="Investor overview">
      <p className="max-w-measure text-xs leading-relaxed text-ink-muted">
        Write this for an investor to read. It is the only free text copied into a new investor draft.
        The internal summary is never copied across automatically, so if this is empty a new draft
        starts with a blank Overview.
        {hasPublication && " Changes here do not alter an existing draft or the live version; they apply to the next draft prepared from this opportunity."}
      </p>
      <label className="mt-3 block">
        <span className="eyebrow">Investor-facing overview</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={MAX}
          data-testid="investor-overview"
          className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30" />
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={save} disabled={!dirty || pending}
          className="rounded bg-purple px-3.5 py-2 text-xs font-semibold text-surface hover:bg-purple-70 disabled:opacity-40">
          {pending ? "Saving..." : "Save investor overview"}
        </button>
        <span className="text-2xs text-ink-faint" data-testid="overview-state">
          {dirty ? "Unsaved changes" : baseline ? "Saved" : "Not written yet"}
        </span>
      </div>
      <ActionError message={error} />

      {internalSummary && (
        <div className="mt-5 border-t border-line pt-4" data-testid="internal-summary">
          <div className="eyebrow">Internal summary - team only, never sent to investors</div>
          <p className="mt-1 max-w-measure whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{internalSummary}</p>
          <button type="button" onClick={() => setText(internalSummary)}
            className="mt-2 rounded border border-line px-3 py-1.5 text-2xs font-medium text-ink-muted hover:text-ink">
            Copy the internal summary into the box above
          </button>
          <Provenance>
            Copying is your decision, after reading it: it was written for the team and may say things
            investors must not see. Nothing is saved until you press Save, and the publish screen
            warns if the Overview still matches the internal text.
          </Provenance>
        </div>
      )}
    </Section>
  );
}
