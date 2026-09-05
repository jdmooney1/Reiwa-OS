"use client";

// ============================================================================
// The comparison set (P4) — a client-side selection, never an authorisation.
// ----------------------------------------------------------------------------
// The browser remembers which opportunities the investor lined up to compare.
// That list is only ever a request: /portal/compare resolves every id through
// investor_feed under the investor's own RLS, so an id that is stale, revoked
// or simply invented resolves to nothing. The cap is enforced here for the
// interface and again on the server, which is where it actually counts.
// ============================================================================
import { COMPARE_LIMIT } from "@/lib/portal/constants";

const KEY = "reiwa.portal.compare";
const CHANGED = "reiwa:compare-changed";

export { COMPARE_LIMIT };

/** The current selection, tolerant of a cleared or corrupted store. */
export function readCompare(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, COMPARE_LIMIT);
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(0, COMPARE_LIMIT)));
  } catch {
    // A private window with storage blocked still gets a working portal; the
    // selection just does not survive the page.
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

export function isCompared(id: string): boolean {
  return readCompare().includes(id);
}

/** Add or remove one opportunity. Returns the selection that resulted. */
export function toggleCompare(id: string): string[] {
  const current = readCompare();
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : current.length >= COMPARE_LIMIT
      ? current                      // full: the caller surfaces why
      : [...current, id];
  write(next);
  return next;
}

export function removeCompare(id: string): string[] {
  const next = readCompare().filter((x) => x !== id);
  write(next);
  return next;
}

export function clearCompare(): void {
  write([]);
}

/** Subscribe to changes from any component on the page (and other tabs). */
export function onCompareChange(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(CHANGED, fn);
    window.removeEventListener("storage", fn);
  };
}
