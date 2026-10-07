"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Archive } from "lucide-react";
import { removeDealAction, restoreDealAction } from "@/app/actions/removal";
import { REMOVAL_REASONS, REMOVAL_REASON_ORDER, NOTE_MAX, type RemovalReason, type RemovedStatus } from "@/lib/pipeline/removal";
import { cn } from "@/lib/utils";

// ============================================================================
// Take a deal off the pipeline, and put it back.
// ----------------------------------------------------------------------------
// Remove opens a small panel: why (sold or no longer available, withdrawn, lost, we passed), an
// optional note, and a confirming button. The deal is archived, not deleted; the panel says so.
// Restore is one click, because it undoes something that destroyed nothing.
//
// Neither control navigates or refreshes by itself: the caller says what to do when it is done
// (the pipeline updates its own rows; the opportunity page refreshes itself).
// ============================================================================

export function RemoveDealButton({ opportunityId, name, onDone, compact }: {
  opportunityId: string; name: string; onDone: (status: RemovedStatus) => void; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RemovalReason | "">("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function confirm() {
    if (!reason || pending) return;
    setPending(true); setError(null);
    const r = await removeDealAction(opportunityId, reason, note);
    setPending(false);
    if (r.error || !r.status) { setError(r.error ?? "This deal could not be taken off the pipeline."); return; }
    setOpen(false); setReason(""); setNote("");
    onDone(r.status);
  }

  return (
    <div ref={root} className="relative inline-block text-left" data-control="remove-deal">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex items-center gap-1 rounded border border-line text-ink-muted transition-colors hover:border-negative/40 hover:text-negative",
          compact ? "px-2 py-1 text-2xs font-medium" : "px-3.5 py-2 text-xs font-semibold")}>
        <Archive className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} strokeWidth={1.75} /> Remove
      </button>
      {open && (
        <div role="dialog" aria-label={`Take ${name} off the pipeline`}
          className="absolute right-0 top-full z-30 mt-1.5 w-80 rounded-lg border border-line bg-surface-card p-3 shadow-lg">
          <p className="text-xs font-medium text-ink">Take this deal off the pipeline</p>
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-faint">It moves to the Archived list. Nothing is deleted, and you can restore it.</p>
          <fieldset className="mt-3 space-y-1.5">
            <legend className="sr-only">Why</legend>
            {REMOVAL_REASON_ORDER.map((id) => (
              <label key={id} className={cn("flex cursor-pointer items-start gap-2 rounded border px-2.5 py-2 text-xs",
                reason === id ? "border-purple bg-purple/[0.05]" : "border-line hover:border-line-strong")}>
                <input type="radio" name={`why-${opportunityId}`} value={id} checked={reason === id} onChange={() => setReason(id)} className="mt-0.5" />
                <span><span className="font-medium text-ink">{REMOVAL_REASONS[id].label}</span>
                  <span className="block text-2xs text-ink-faint">{REMOVAL_REASONS[id].hint}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="mt-3 block text-2xs font-medium uppercase tracking-label text-ink-faint" htmlFor={`note-${opportunityId}`}>Note (optional)</label>
          <textarea id={`note-${opportunityId}`} rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Who bought it, what happened, anything worth keeping"
            className="mt-1 w-full rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
          {error && <p role="alert" className="mt-2 text-xs text-negative" data-error>{error}</p>}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-muted hover:text-ink">Cancel</button>
            <button type="button" disabled={!reason || pending} onClick={() => void confirm()} data-action="confirm-remove"
              className="rounded bg-negative px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50">
              {pending ? "Removing..." : "Remove from pipeline"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RestoreDealButton({ opportunityId, onDone, compact }: {
  opportunityId: string; onDone: () => void; compact?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start" data-control="restore-deal">
      <button type="button" disabled={pending} onClick={async () => {
        setPending(true); setError(null);
        const r = await restoreDealAction(opportunityId);
        setPending(false);
        if (r.error) { setError(r.error); return; }
        onDone();
      }} className={cn("inline-flex items-center gap-1 rounded border border-line text-ink-muted transition-colors hover:text-ink disabled:opacity-50",
        compact ? "px-2 py-1 text-2xs font-medium" : "px-3.5 py-2 text-xs font-semibold")}>
        <RotateCcw className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} strokeWidth={1.75} /> {pending ? "Restoring..." : "Restore"}
      </button>
      {error && <span role="alert" className="mt-1 text-2xs text-negative">{error}</span>}
    </span>
  );
}
