"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Undo2 } from "lucide-react";
import { triageDealAction, undoTriageAction } from "@/app/actions/triage";
import type { PipelineRow } from "@/lib/data/opportunity-file";
import type { TriageResult } from "@/lib/data/triage";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { formatMoneyCompact, formatPct } from "@/lib/format";
import {
  TRIAGE_DECISIONS, TRIAGE_DECISION_ORDER, REASON_MAX, resolveTriageKey, type TriageDecision,
} from "@/lib/pipeline/triage";
import { cn } from "@/lib/utils";
import type { AssetType, Strategy } from "@/types/database";

// ============================================================================
// Triage mode: step through untriaged deals one at a time.
// ----------------------------------------------------------------------------
// P pursue, W watch, X pass, each with an optional reason; the next deal appears at once.
// S or the right arrow skips, the left arrow goes back, U undoes the last decision, R
// types a reason (Esc leaves the box), Esc leaves triage.
//
// The queue is a SNAPSHOT of the untriaged deals in the view when triage was entered, in the
// view's own order, so deciding one does not reshuffle the rest. A decision is saved before the
// next deal shows: if it is refused (someone else triaged it, or no permission) the message is
// shown and the deal stays put. Letters only act outside a text box; see resolveTriageKey.
// ============================================================================

interface HistoryEntry { id: string; index: number; decision: TriageDecision }

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
};

export function TriageMode({ queueIds, rows, onDecided, onUndone, onExit: leave }: {
  /** The snapshot: ids of the untriaged deals to step through, in order. */
  queueIds: string[];
  /** Every pipeline row with local decisions already applied, to look each one up. */
  rows: PipelineRow[];
  onDecided: (id: string, result: TriageResult) => void;
  onUndone: (id: string) => void;
  onExit: () => void;
}) {
  const router = useRouter();
  // Leaving re-reads the pipeline from the server, so the board and table show what was saved.
  const onExit = useCallback(() => { leave(); router.refresh(); }, [leave, router]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.opportunityId, r])), [rows]);
  const [index, setIndex] = useState(0);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<TriageDecision | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [skipped, setSkipped] = useState(0);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);

  const total = queueIds.length;
  const done = index >= total;
  const current = done ? null : byId.get(queueIds[index]) ?? null;
  const decided = current ? current.triageStatus !== "untriaged" : false;
  const counts = useMemo(() => {
    const c: Record<TriageDecision, number> = { pursue: 0, watch: 0, pass: 0 };
    for (const h of history) c[h.decision] += 1;
    return c;
  }, [history]);

  useEffect(() => { regionRef.current?.focus(); }, []);

  const decide = useCallback(async (decision: TriageDecision) => {
    if (!current || pending || decided) return;
    setPending(decision); setError(null);
    const res = await triageDealAction(current.opportunityId, decision, reason);
    setPending(null);
    if (res.error || !res.triage) { setError(res.error ?? "That decision could not be recorded."); return; }
    onDecided(current.opportunityId, res.triage);
    setHistory((h) => [...h, { id: current.opportunityId, index, decision }]);
    setReason("");
    setIndex((i) => i + 1);
    regionRef.current?.focus();
  }, [current, pending, decided, reason, index, onDecided]);

  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last || pending) return;
    setPending("undo"); setError(null);
    const res = await undoTriageAction(last.id);
    setPending(null);
    if (res.error) { setError(res.error); return; }
    onUndone(last.id);
    setHistory((h) => h.slice(0, -1));
    setIndex(last.index);
  }, [history, pending, onUndone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editable = isEditable(e.target);
      const action = resolveTriageKey({
        key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, repeat: e.repeat, inEditable: editable,
      });
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "pursue": case "watch": case "pass": void decide(action); break;
        case "skip": if (!done) { setSkipped((n) => n + 1); setIndex((i) => Math.min(i + 1, total)); setError(null); } break;
        case "back": setIndex((i) => Math.max(i - 1, 0)); setError(null); break;
        case "undo": void undo(); break;
        case "reason": if (editable) { (e.target as HTMLElement).blur(); regionRef.current?.focus(); } else reasonRef.current?.focus(); break;
        case "exit": onExit(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, undo, onExit, done, total]);

  const left = Math.max(total - index, 0);

  return (
    <div ref={regionRef} tabIndex={-1} role="region" aria-label="Triage" data-mode="triage"
      className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-6 outline-none">
      <div className="flex items-center justify-between gap-4">
        <div aria-live="polite" className="tabular text-xs text-ink-muted" data-progress>
          {done ? "Finished" : <>Deal <span className="font-semibold text-ink">{index + 1}</span> of {total}</>}
          <span className="text-ink-faint"> · {left} left</span>
        </div>
        <button type="button" onClick={onExit} aria-keyshortcuts="Escape"
          className="text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline">Exit triage (Esc)</button>
      </div>
      <div className="h-1 overflow-hidden rounded bg-surface-sunken" aria-hidden="true">
        <div className="h-full bg-purple transition-all" style={{ width: `${total === 0 ? 0 : Math.round((Math.min(index, total) / total) * 100)}%` }} />
      </div>

      {total === 0 && (
        <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center" data-state="empty">
          <p className="text-sm text-ink">Nothing to triage in this view.</p>
          <p className="mt-1 text-xs text-ink-faint">Every deal matching the current filters has been looked at. Clear a filter to widen it.</p>
        </div>
      )}

      {done && total > 0 && (
        <div className="rounded-lg border border-line bg-surface-card px-6 py-8 text-center" data-state="done">
          <p className="text-base font-medium text-ink">That is the queue.</p>
          <p className="tabular mt-2 text-sm text-ink-muted">
            {counts.pursue} pursued · {counts.watch} watched · {counts.pass} passed · {skipped} skipped
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button type="button" onClick={onExit} className="rounded bg-purple px-4 py-2 text-xs font-medium text-surface">Back to the pipeline</button>
            {history.length > 0 && <button type="button" onClick={() => void undo()} disabled={!!pending} className="rounded border border-line px-4 py-2 text-xs font-medium text-ink-muted hover:text-ink">Undo last (U)</button>}
          </div>
        </div>
      )}

      {current && (
        <article className="rounded-lg border border-line bg-surface-card" data-deal={current.opportunityId}>
          {current.headlinePhotoId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/asset-photos/${current.headlinePhotoId}?variant=thumb`} alt="" className="aspect-[16/6] w-full rounded-t-lg object-cover" />
          )}
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl leading-tight text-ink">{current.name}</h2>
                <p className="mt-1 text-xs text-ink-muted">
                  {[current.market ?? current.city, ASSET_TYPE_LABEL[current.assetType as AssetType] ?? current.assetType,
                    current.strategy ? (STRATEGY_LABEL[current.strategy as Strategy] ?? current.strategy) : null].filter(Boolean).join(" · ")}
                </p>
                {current.address && <p className="mt-0.5 text-xs text-ink-faint">{current.address}</p>}
              </div>
              <Link href={`/opportunities/${current.opportunityId}`} target="_blank" rel="noreferrer"
                className="flex shrink-0 items-center gap-1 text-xs font-medium text-purple hover:underline">
                Open record <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            <dl className="tabular mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-line py-4 sm:grid-cols-4">
              <Fig label="Price" v={formatMoneyCompact(current.caseAcquisitionPrice, current.currency as "GBP")} />
              <Fig label="Total cost" v={formatMoneyCompact(current.caseTotalCost, current.currency as "GBP")} />
              <Fig label="Entry yield" v={formatPct(current.caseEntryYieldPct, 1)} />
              <Fig label="Target IRR" v={formatPct(current.caseTargetIrr, 1)} />
            </dl>

            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
              <Meta label="Broker" v={[current.brokerName, current.sourceContactName].filter(Boolean).join(" · ") || null} />
              <Meta label="Source" v={current.source} />
              <Meta label="Size" v={current.sizeSqft ? `${Math.round(current.sizeSqft).toLocaleString("en-GB")} sq ft` : null} />
              <Meta label="Basis" v={current.caseBasis === "none" ? "Not underwritten" : `v${current.caseVersion} ${current.caseBasis === "approved" ? "approved" : "working"}`} />
            </dl>

            {decided && (
              <p role="status" className="mt-4 rounded border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-muted" data-state="decided">
                Already decided: {current.triageStatus}{current.triagePriority ? ` ${current.triagePriority}` : ""}. Use the arrows to move on, or U to undo your last decision.
              </p>
            )}

            <label className="mt-4 block text-2xs font-medium uppercase tracking-label text-ink-faint" htmlFor="triage-reason">
              Reason <span className="normal-case tracking-normal text-ink-faint">(optional - R to type, Esc to leave the box)</span>
            </label>
            <textarea id="triage-reason" ref={reasonRef} rows={2} maxLength={REASON_MAX} value={reason} disabled={decided}
              onChange={(e) => setReason(e.target.value)} placeholder="Why? Kept with the decision."
              className="mt-1.5 w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30 disabled:opacity-50" />

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {TRIAGE_DECISION_ORDER.map((d) => {
                const def = TRIAGE_DECISIONS[d];
                return (
                  <button key={d} type="button" disabled={!!pending || decided} onClick={() => void decide(d)}
                    aria-keyshortcuts={def.key.toUpperCase()} title={def.hint} data-decision={d}
                    className={cn("flex items-center gap-2 rounded border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                      d === "pursue" && "border-positive/40 text-positive hover:bg-positive/10",
                      d === "watch" && "border-line-strong text-ink hover:bg-surface-sunken",
                      d === "pass" && "border-negative/40 text-negative hover:bg-negative/10")}>
                    {pending === d ? "Saving..." : def.label}
                    <kbd className="rounded border border-line bg-surface px-1.5 py-px font-mono text-2xs text-ink-muted">{def.key.toUpperCase()}</kbd>
                  </button>
                );
              })}
              <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
              <button type="button" onClick={() => { setSkipped((n) => n + 1); setIndex((i) => Math.min(i + 1, total)); setError(null); }}
                aria-keyshortcuts="S ArrowRight" className="text-xs text-ink-muted hover:text-ink">Skip <kbd className="font-mono text-2xs">S</kbd></button>
              <button type="button" onClick={() => { setIndex((i) => Math.max(i - 1, 0)); setError(null); }} disabled={index === 0}
                aria-keyshortcuts="ArrowLeft" className="text-xs text-ink-muted hover:text-ink disabled:opacity-40">Back <kbd className="font-mono text-2xs">←</kbd></button>
              <button type="button" onClick={() => void undo()} disabled={history.length === 0 || !!pending}
                aria-keyshortcuts="U" className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink disabled:opacity-40">
                <Undo2 className="h-3 w-3" /> Undo <kbd className="font-mono text-2xs">U</kbd>
              </button>
            </div>
            {error && <p role="alert" className="mt-3 text-xs text-negative" data-error>{error}</p>}
          </div>
        </article>
      )}

      <p className="text-2xs text-ink-faint">
        Watch is saved as a live deal at the lowest priority (P3), noted as watched. Pursue is saved as live with no priority; set one on the deal later.
      </p>
    </div>
  );
}

function Fig({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-label text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{v}</dd>
    </div>
  );
}
function Meta({ label, v }: { label: string; v: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-14 shrink-0 text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-ink-muted">{v ?? "-"}</dd>
    </div>
  );
}
