"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import { Printer } from "lucide-react";
import {
  startMemoAction, recomposeMemoAction, saveMemoOverrideAction, finalizeMemoAction,
} from "@/app/actions/memo";
import { ACTION_IDLE } from "@/lib/actions/result";
import { ActionError } from "@/components/workspace/primitives";
import type { OverrideKey } from "@/lib/memo/compose";
import { MAX_OVERRIDE_CHARS } from "@/lib/memo/compose";
import { SECTION_LABEL, type MemoSectionKey } from "@/lib/memo/sections";

const BUTTON = "rounded px-3.5 py-2 text-xs font-semibold disabled:opacity-50";
const PRIMARY = `${BUTTON} bg-purple text-surface hover:bg-purple-70`;
const SECONDARY = "rounded border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50";

/** Start the first memo, or the next version after a final one. */
export function StartMemoButton({ opportunityId, label }: { opportunityId: string; label: string }) {
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  return (
    <div>
      <button
        type="button" disabled={pending} className={PRIMARY}
        onClick={async () => { setPending(true); setError(undefined); const r = await startMemoAction(opportunityId); setPending(false); if (r.error) setError(r.error); }}
      >
        {label}
      </button>
      <div className="mt-2"><ActionError message={error} /></div>
    </div>
  );
}

export function RecomposeButton({ opportunityId, memoId }: { opportunityId: string; memoId: string }) {
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  return (
    <div>
      <button
        type="button" disabled={pending} className={SECONDARY}
        onClick={async () => { setPending(true); setError(undefined); const r = await recomposeMemoAction(opportunityId, memoId); setPending(false); if (r.error) setError(r.error); }}
      >
        Recompose from current records
      </button>
      <div className="mt-2"><ActionError message={error} /></div>
    </div>
  );
}

/**
 * Finalise: irreversible, so it asks. The prompt names what the person is about
 * to lock in that they may not have looked at - the sections that will print
 * blank in this format, and any underwriting text an external format would carry
 * as it stands.
 */
export function FinalizeForm({
  opportunityId, memoId, formatLabel, empty, unreviewed,
}: {
  opportunityId: string;
  memoId: string;
  formatLabel: string;
  empty: MemoSectionKey[];
  unreviewed: MemoSectionKey[];
}) {
  const [state, action] = useFormState(finalizeMemoAction.bind(null, opportunityId, memoId), ACTION_IDLE);
  const labels = (ks: MemoSectionKey[]) => ks.map((k) => SECTION_LABEL[k]).join(", ");
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const lines = [
          "Finalise this memo? This cannot be undone. It becomes a permanent record and a later change to the underwriting will not alter it.",
          empty.length ? `\nIn the ${formatLabel} these sections will print with nothing in them: ${labels(empty)}.` : "",
          unreviewed.length ? `\nThese sections carry text from the underwriting exactly as the analyst wrote it: ${labels(unreviewed)}. Confirm it is fit to leave the building.` : "",
        ];
        if (!window.confirm(lines.join(""))) e.preventDefault();
      }}
    >
      <input type="hidden" name="confirm" value="yes" />
      <button type="submit" className={PRIMARY}>Finalise memo</button>
      <div className="mt-2"><ActionError message={state.error} /></div>
    </form>
  );
}

export function PrintLink({ href }: { href: string }) {
  return (
    <Link href={href} target="_blank" className={`${SECONDARY} inline-flex items-center gap-1.5`}>
      <Printer className="h-3.5 w-3.5" /> Print view
    </Link>
  );
}

/** The textarea a person writes a section in. A draft only. */
export function OverrideEditor({
  opportunityId, memoId, sectionKey, initial, placeholder,
}: {
  opportunityId: string;
  memoId: string;
  sectionKey: OverrideKey;
  initial: string;
  placeholder?: string;
}) {
  const [state, action] = useFormState(saveMemoOverrideAction.bind(null, opportunityId, memoId, sectionKey), ACTION_IDLE);
  return (
    <form action={action} className="mt-3 space-y-2">
      <label className="block">
        <span className="eyebrow">Write this section by hand</span>
        <textarea
          name="text" rows={4} defaultValue={initial} maxLength={MAX_OVERRIDE_CHARS} placeholder={placeholder}
          className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className={PRIMARY}>Save text</button>
        <span className="text-2xs text-ink-faint">
          Replaces the composed content for this section in every format. Clear it and save to go back to the composed version.
        </span>
      </div>
      {state.ok && !state.error && <p className="text-2xs text-positive" role="status">Saved.</p>}
      <ActionError message={state.error} />
    </form>
  );
}

/** Opens the browser's print dialog, which is the PDF export in Phase 1. */
export function PrintNowButton() {
  return (
    <button type="button" onClick={() => window.print()} className={PRIMARY}>
      Print or save as PDF
    </button>
  );
}
