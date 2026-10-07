// ============================================================================
// Triage mode - the decisions, the queue and the keys. Pure.
// ----------------------------------------------------------------------------
// Three decisions, three keys: Pursue (P), Watch (W), Pass (X).
//
// THE MAPPING IS THE DECISION THAT MATTERS HERE. The database already has a triage
// vocabulary (migration 0014): untriaged / live / dead / reference, with an optional
// priority P1-P3 that exists only on a live deal. "Pursue" and "Pass" have an obvious home
// (live, dead). "Watch" does not: `reference` is defined as comparable evidence, never a
// deal, and a deal being watched is a deal. With no schema change allowed, Watch is stored
// as a LIVE deal at the lowest priority (P3) with a note that says it is being watched.
// That is the closest honest fit, and it is kept in this one table so it can be changed in
// one place - or replaced by a real fifth state, which is a one-line CHECK change.
// ============================================================================
import type { TriageStatus, TriagePriority } from "@/lib/data/opportunity-types";

export type TriageDecision = "pursue" | "watch" | "pass";
export const TRIAGE_DECISION_ORDER: readonly TriageDecision[] = ["pursue", "watch", "pass"];

export const REASON_MAX = 500;

export const TRIAGE_DECISIONS: Record<TriageDecision, {
  label: string; key: "p" | "w" | "x"; status: TriageStatus; priority: TriagePriority | null; hint: string;
}> = {
  pursue: { label: "Pursue", key: "p", status: "live", priority: null, hint: "Becomes a live deal" },
  watch: { label: "Watch", key: "w", status: "live", priority: "P3", hint: "Live, lowest priority (P3), noted as watched" },
  pass: { label: "Pass", key: "x", status: "dead", priority: null, hint: "Kept as a dead deal, with the reason" },
};

export function isTriageDecision(v: unknown): v is TriageDecision {
  return v === "pursue" || v === "watch" || v === "pass";
}

/** The reason as it will be stored: trimmed, control characters out, capped, null when empty. */
export function cleanReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, REASON_MAX);
  return t === "" ? null : t;
}

/** What a decision writes. The note for Watch always says so, because the status alone cannot. */
export function triageFields(decision: TriageDecision, reason: unknown): {
  status: TriageStatus; priority: TriagePriority | null; note: string | null;
} {
  const d = TRIAGE_DECISIONS[decision];
  const r = cleanReason(reason);
  const note = decision === "watch" ? (r ? `Watching: ${r}` : "Watching") : r;
  return { status: d.status, priority: d.priority, note: note === null ? null : note.slice(0, REASON_MAX + 20) };
}

/** The rows triage mode steps through: untriaged only, in the order given (the view's own order). */
export function buildTriageQueue<T extends { opportunityId: string; triageStatus: TriageStatus }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.triageStatus === "untriaged");
}

// ---- Keys -------------------------------------------------------------------
export type TriageKeyAction = TriageDecision | "skip" | "back" | "undo" | "reason" | "exit";

export interface KeyInfo {
  key: string;
  ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean;
  repeat?: boolean;
  /** True when focus is in a text field, textarea, select or contenteditable. */
  inEditable: boolean;
}

/**
 * What a key press means in triage mode, or null for "not ours".
 *
 * Letters act ONLY when focus is outside a text field, so typing a reason that contains a "p" is a
 * reason and not a decision. Inside a field, Escape leaves it (back to the keys) and nothing else is
 * taken. A held key never repeats a decision (auto-advance would otherwise run through the queue), and
 * any modifier means the browser's shortcut, not ours.
 */
export function resolveTriageKey(e: KeyInfo): TriageKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.inEditable) return e.key === "Escape" ? "reason" : null;
  if (e.repeat) return null;
  switch (e.key) {
    case "p": case "P": return "pursue";
    case "w": case "W": return "watch";
    case "x": case "X": return "pass";
    case "s": case "S": case "ArrowRight": return "skip";
    case "ArrowLeft": return "back";
    case "u": case "U": return "undo";
    case "r": case "R": return "reason";
    case "Escape": return "exit";
    default: return null;
  }
}
