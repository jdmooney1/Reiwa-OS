"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bookmark, ChevronDown, Check } from "lucide-react";
import { saveViewAction, updateViewAction, deleteViewAction } from "@/app/actions/pipeline-views";
import type { SavedView } from "@/lib/data/pipeline-views";
import { sameView, type PipelineViewState } from "@/lib/pipeline/view-state";
import { cn } from "@/lib/utils";

// ============================================================================
// The saved-views menu: apply a saved filter set, save the current one under a name,
// rename it, replace its filters with the ones now on screen, delete it.
// ----------------------------------------------------------------------------
// The list is held here and updated from each action's result, so the menu reflects a
// save or a delete at once. The server remains the source on the next page load.
// When the saved-views table has not been created yet (`available` false) the menu says
// so and does nothing else; the rest of the pipeline is unaffected.
// ============================================================================

export function SavedViewsMenu({ initial, available, state, activeId, onApply, onActive }: {
  initial: SavedView[];
  available: boolean;
  /** The view on screen now. */
  state: PipelineViewState;
  activeId: string | null;
  onApply: (view: SavedView) => void;
  onActive: (id: string | null) => void;
}) {
  const [views, setViews] = useState<SavedView[]>(initial);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const active = views.find((v) => v.viewId === activeId) ?? null;
  const modified = active ? !sameView(active.state, state) : false;
  const upsert = (v: SavedView) => setViews((all) => [...all.filter((x) => x.viewId !== v.viewId), v].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())));

  function save() {
    setError(null);
    start(async () => {
      const r = await saveViewAction(name, state);
      if (r.error || !r.view) { setError(r.error ?? "This view could not be saved."); return; }
      upsert(r.view); onActive(r.view.viewId); setName("");
    });
  }
  function rename() {
    if (!editing) return;
    setError(null);
    start(async () => {
      const r = await updateViewAction(editing.id, { name: editing.name });
      if (r.error || !r.view) { setError(r.error ?? "This view could not be renamed."); return; }
      upsert(r.view); setEditing(null);
    });
  }
  function replaceFilters(id: string) {
    setError(null);
    start(async () => {
      const r = await updateViewAction(id, { state });
      if (r.error || !r.view) { setError(r.error ?? "This view could not be updated."); return; }
      upsert(r.view);
    });
  }
  function remove(id: string) {
    setError(null);
    start(async () => {
      const r = await deleteViewAction(id);
      if (r.error) { setError(r.error); return; }
      setViews((all) => all.filter((v) => v.viewId !== id));
      if (activeId === id) onActive(null);
      setConfirmDelete(null);
    });
  }

  return (
    <div ref={root} className="relative" data-menu="saved-views">
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cn("flex h-8 items-center gap-1.5 rounded border px-2.5 text-xs font-medium transition-colors",
          active ? "border-purple text-purple" : "border-line bg-surface-card text-ink-muted hover:text-ink")}>
        <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="max-w-[10rem] truncate">{active ? active.name : "Views"}</span>
        {modified && <span className="text-2xs font-normal text-ink-faint" data-flag="modified">(changed)</span>}
        <ChevronDown className="h-3 w-3 text-ink-faint" />
      </button>

      {open && (
        <div role="menu" className="absolute left-0 top-9 z-30 w-80 rounded-lg border border-line bg-surface-card p-2 shadow-lg">
          {!available ? (
            <p className="px-2 py-3 text-xs leading-relaxed text-ink-muted" data-note="unavailable">
              Saved views are not available yet. They need a database update that has not been applied.
            </p>
          ) : (
            <>
              {views.length === 0 && <p className="px-2 py-2 text-xs text-ink-faint">No saved views yet. Set up the filters you want, then save them below.</p>}
              <ul className="max-h-64 divide-y divide-line overflow-auto">
                {views.map((v) => (
                  <li key={v.viewId} className="px-1 py-1.5">
                    {editing?.id === v.viewId ? (
                      <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); rename(); }}>
                        <input autoFocus value={editing.name} maxLength={80} aria-label="View name"
                          onChange={(e) => setEditing({ id: v.viewId, name: e.target.value })}
                          className="h-7 min-w-0 flex-1 rounded border border-line bg-surface px-2 text-xs text-ink focus:border-line-strong focus:outline-none" />
                        <button type="submit" disabled={pending} className="text-xs font-medium text-purple">Save</button>
                        <button type="button" onClick={() => setEditing(null)} className="text-xs text-ink-muted">Cancel</button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button type="button" role="menuitem" onClick={() => { onApply(v); setOpen(false); }}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-ink hover:text-purple">
                          {v.viewId === activeId ? <Check className="h-3 w-3 shrink-0 text-purple" /> : <span className="w-3 shrink-0" />}
                          <span className="truncate">{v.name}</span>
                        </button>
                        {v.viewId === activeId && modified && (
                          <button type="button" disabled={pending} onClick={() => replaceFilters(v.viewId)}
                            title="Replace this view's filters with the ones on screen" className="text-2xs font-medium text-purple">Update</button>
                        )}
                        <button type="button" onClick={() => setEditing({ id: v.viewId, name: v.name })} className="text-2xs text-ink-muted hover:text-ink">Rename</button>
                        {confirmDelete === v.viewId ? (
                          <button type="button" disabled={pending} onClick={() => remove(v.viewId)} className="text-2xs font-semibold text-negative">Delete?</button>
                        ) : (
                          <button type="button" onClick={() => setConfirmDelete(v.viewId)} className="text-2xs text-ink-muted hover:text-negative">Delete</button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <form className="mt-2 flex items-center gap-1.5 border-t border-line pt-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
                <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Save these filters as..."
                  aria-label="Name for the new view"
                  className="h-7 min-w-0 flex-1 rounded border border-line bg-surface px-2 text-xs text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
                <button type="submit" disabled={pending || name.trim() === ""}
                  className="h-7 rounded bg-purple px-2.5 text-xs font-medium text-surface disabled:opacity-50">Save</button>
              </form>
              {error && <p role="alert" className="mt-2 px-1 text-xs text-negative">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
