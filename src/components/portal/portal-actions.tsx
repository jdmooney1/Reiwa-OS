"use client";

import { useEffect, useState, useTransition } from "react";
import { Bookmark, BookmarkCheck, Columns3, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toggleSaveAction } from "@/app/actions/portal";
import {
  isCompared, toggleCompare, onCompareChange, readCompare, COMPARE_LIMIT,
} from "@/lib/portal/compare-store";

const BTN =
  "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-2xs font-medium transition-colors disabled:opacity-50";
const IDLE = "border-line text-ink-muted hover:border-line hover:text-ink";
const ON = "border-line bg-surface-sunken text-ink-muted";

/**
 * Save / unsave. The server action re-resolves the investor session and the
 * insert's WITH CHECK re-tests entitlement, so this button's optimistic state
 * is a convenience only — it never decides anything.
 */
export function SaveButton({
  publicationId, saved, size = "sm",
}: {
  publicationId: string;
  saved: boolean;
  size?: "sm" | "lg";
}) {
  const [on, setOn] = useState(saved);
  const [pending, start] = useTransition();

  useEffect(() => { setOn(saved); }, [saved]);

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        setOn(next);
        start(async () => { await toggleSaveAction(publicationId, next); });
      }}
      className={cn(BTN, on ? ON : IDLE, size === "lg" && "px-4 py-2 text-xs")}
    >
      {on
        ? <BookmarkCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
        : <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} />}
      {on ? "Saved" : "Save"}
    </button>
  );
}

/** Add to / remove from the comparison set, with the cap surfaced honestly. */
export function CompareButton({
  publicationId, size = "sm",
}: {
  publicationId: string;
  size?: "sm" | "lg";
}) {
  const [on, setOn] = useState(false);
  const [full, setFull] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      const current = readCompare();
      setOn(current.includes(publicationId));
      setFull(current.length >= COMPARE_LIMIT && !current.includes(publicationId));
      setReady(true);
    };
    sync();
    return onCompareChange(sync);
  }, [publicationId]);

  const blocked = full && !on;

  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!ready || blocked}
      title={blocked ? `You can compare up to ${COMPARE_LIMIT} opportunities at a time.` : undefined}
      onClick={() => { toggleCompare(publicationId); }}
      className={cn(BTN, on ? ON : IDLE, size === "lg" && "px-4 py-2 text-xs")}
    >
      {on
        ? <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
        : <Columns3 className="h-3.5 w-3.5" strokeWidth={1.75} />}
      {on ? "In comparison" : blocked ? `Compare full (${COMPARE_LIMIT})` : "Compare"}
    </button>
  );
}
