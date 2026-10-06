"use client";

// ============================================================================
// The Japanese translation panel, on the Investor Teaser view of a draft memo.
// ----------------------------------------------------------------------------
// A DRAFT BESIDE THE ENGLISH, AND NOTHING IS SAVED UNTIL A PERSON SAYS SO.
// "Draft Japanese translation" makes ONE call for the whole Teaser and lays each
// section's draft out next to the English it came from. Each section is then decided on
// its own: Accept saves it as it stands, or as edited in the box; Discard puts it away.
// There is no "accept all" and nothing here accepts anything by itself.
//
// THE FIGURES ARE CHECKED WHILE YOU EDIT. The same pure check the server runs on Accept
// (lib/memo-translation/numbers.ts) is shown against the text in the box, so a changed
// figure is visible the moment it appears. A mismatch does not forbid saving - the person
// decides - but it changes the button to "Save anyway" and says exactly which figures differ.
//
// What was SAVED already is listed separately, with a Remove: a saved section is not
// edited in place, because the way a saved translation changes is the same as the way it
// was made - drafted again and accepted.
// ============================================================================
import { useState } from "react";
import { translateMemoAction } from "@/app/actions/memo-translation";
import { acceptTranslationAction, removeTranslationAction } from "@/app/actions/memo-translation-accept";
import type { GeneratedDraft, DraftSection } from "@/lib/memo-translation/generate";
import { checkFigures, figureProblem } from "@/lib/memo-translation/numbers";
import { JA_SECTION_LABEL, TEASER_KEYS, type JaOverrides } from "@/lib/memo-translation/sections";
import { SECTION_LABEL } from "@/lib/memo/sections";
import { ActionError } from "@/components/workspace/primitives";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const BUTTON = "rounded px-3 py-2 text-xs font-medium disabled:opacity-50";
const SECONDARY = `${BUTTON} border border-line text-ink-muted hover:text-ink`;
const PRIMARY = `${BUTTON} bg-purple font-semibold text-surface hover:bg-purple-70`;

export function TranslationPanel({
  opportunityId, memoId, saved,
}: {
  opportunityId: string;
  memoId: string;
  /** Japanese already accepted into this draft, per Teaser section. */
  saved: JaOverrides;
}) {
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  // Sections the person has dealt with on this screen: saved or discarded.
  const [done, setDone] = useState<Record<string, "saved" | "discarded">>({});

  async function run() {
    setPending(true);
    setError(undefined);
    const r = await translateMemoAction(opportunityId, memoId);
    setPending(false);
    if (r.error) { setError(r.error); return; }
    if (r.draft) { setDraft(r.draft); setDone({}); }
  }

  const savedKeys = TEASER_KEYS.filter((k) => saved[k]);

  return (
    <div className="space-y-5">
      <p className="max-w-measure text-sm leading-relaxed text-ink-muted">
        Draft a Japanese version of every section of this Teaser in one go, so the terminology stays consistent.
        A model writes the draft; <strong className="font-medium text-ink">nothing is saved until you accept a section</strong>,
        as it stands or after you edit it. Every figure must read exactly as it does in English: the check below the
        box compares the numbers, but it does not judge whether the Japanese is good, so read it.
      </p>

      <div>
        <button type="button" disabled={pending} onClick={run} className={SECONDARY}>
          {pending ? "Translating the Teaser…" : draft ? "Draft again" : "Draft Japanese translation"}
        </button>
        <div className="mt-2"><ActionError message={error} /></div>
      </div>

      {savedKeys.length > 0 && (
        <div>
          <div className="mb-2 text-2xs font-medium uppercase tracking-label text-ink-faint">Saved in this draft</div>
          <ul className="space-y-2">
            {savedKeys.map((k) => <SavedRow key={k} opportunityId={opportunityId} memoId={memoId} sectionKey={k} text={saved[k]!} />)}
          </ul>
        </div>
      )}

      {draft && (
        <div className="space-y-4">
          <p className="text-2xs text-ink-faint">
            Drafted {formatDate(draft.createdAt)} by {draft.createdByName ?? "a colleague"}, using {draft.model}.
            Not saved: each section below is yours to accept, edit or discard.
          </p>
          {draft.sections.filter((s) => done[s.key] !== "discarded").map((s) => (
            <SectionDraft
              key={s.key} opportunityId={opportunityId} memoId={memoId} draftId={draft.draftId}
              section={s} saved={done[s.key] === "saved"}
              onSaved={() => setDone((d) => ({ ...d, [s.key]: "saved" }))}
              onDiscard={() => setDone((d) => ({ ...d, [s.key]: "discarded" }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SavedRow({ opportunityId, memoId, sectionKey, text }: { opportunityId: string; memoId: string; sectionKey: string; text: string }) {
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  return (
    <li className="border border-line bg-surface-card px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-ink">
            {SECTION_LABEL[sectionKey as keyof typeof SECTION_LABEL]} <span lang="ja" className="ml-1 text-ink-faint">{JA_SECTION_LABEL[sectionKey as keyof typeof JA_SECTION_LABEL]}</span>
          </div>
          <p lang="ja" className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{text}</p>
        </div>
        <button
          type="button" disabled={pending} className="shrink-0 text-2xs text-ink-faint hover:text-ink disabled:opacity-50"
          aria-label={`Remove the saved Japanese for ${SECTION_LABEL[sectionKey as keyof typeof SECTION_LABEL]}`}
          onClick={async () => {
            setPending(true); setError(undefined);
            const r = await removeTranslationAction(opportunityId, memoId, sectionKey);
            setPending(false);
            if (r.error) setError(r.error);
          }}
        >
          Remove
        </button>
      </div>
      <div className="mt-2"><ActionError message={error} /></div>
    </li>
  );
}

function SectionDraft({
  opportunityId, memoId, draftId, section, saved, onSaved, onDiscard,
}: {
  opportunityId: string; memoId: string; draftId: string; section: DraftSection;
  saved: boolean; onSaved: () => void; onDiscard: () => void;
}) {
  const [text, setText] = useState(section.draft);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const problem = figureProblem(checkFigures(section.source, text));

  async function accept() {
    setPending(true); setError(undefined);
    const r = await acceptTranslationAction(opportunityId, memoId, draftId, section.key, text, problem !== null);
    setPending(false);
    if (r.error) setError(r.error); else onSaved();
  }

  return (
    <section className="border border-line bg-surface-card" data-section={section.key}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h3 className="text-xs font-medium text-ink">
          {section.label} <span lang="ja" className="ml-1 text-ink-faint">{JA_SECTION_LABEL[section.key]}</span>
        </h3>
        {saved && <span className="rounded bg-positive/10 px-1.5 py-0.5 text-2xs font-medium text-positive">Saved</span>}
      </header>
      <div className="grid gap-px bg-line md:grid-cols-2">
        <div className="bg-surface-card px-4 py-3">
          <div className="mb-1 text-2xs font-medium uppercase tracking-label text-ink-faint">English</div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{section.source}</p>
        </div>
        <div className="bg-surface-card px-4 py-3">
          <div className="mb-1 text-2xs font-medium uppercase tracking-label text-ink-faint">Japanese draft</div>
          <textarea
            lang="ja" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(12, Math.max(4, text.split("\n").length + 1))}
            readOnly={saved} aria-label={`Japanese draft for ${section.label}`}
            className="w-full rounded border border-line bg-surface-card px-3 py-2 text-sm leading-relaxed text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30"
          />
        </div>
      </div>
      {!saved && (
        <footer className="space-y-2 px-4 py-3">
          {problem ? (
            <p className="border-l-2 border-caution pl-3 text-xs text-caution" role="status">{problem}</p>
          ) : (
            <p className="text-2xs text-ink-faint">The figures match the English. That is all this checks.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending || text.trim() === ""} onClick={accept}
              className={cn(problem ? SECONDARY : PRIMARY)}>
              {pending ? "Saving…" : problem ? "Save anyway" : "Accept and save"}
            </button>
            <button type="button" disabled={pending} onClick={onDiscard} className={SECONDARY}>Discard</button>
          </div>
          <ActionError message={error} />
        </footer>
      )}
    </section>
  );
}
