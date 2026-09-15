// ============================================================================
// Due diligence progress — completion, and what is actually blocking.
// ----------------------------------------------------------------------------
// Pure computation over a set of instantiated DD workstreams (see templates.ts).
// It lived inside the old deal-file UI; it is firm logic rather than screen
// logic, so it sits in lib and is reused by whatever renders a DD checklist.
//
// Two rules worth keeping explicit:
//   * "Not applicable" is excluded from the denominator. Progress must measure
//     the work in scope, not be flattered by lines that were never required.
//   * A deal with nothing in scope is 100%, not 0% — there is nothing to clear.
//   * A date that has passed is a fact about the deal, not a decoration on a
//     row. Overdue is computed here, beside completion, so that no screen can
//     show a diligence list that quietly omits it.
// ============================================================================
import type { DueDiligenceItem, DdStatus } from "@/types/database";
import { isDdCleared, isDdIssue, isDdOpen } from "@/lib/domain";

export interface Progress {
  total: number;
  inScope: number; // excludes Not Applicable
  cleared: number; // reviewed + resolved
  open: number;
  issues: number;
  overdue: number;
  pct: number; // cleared / inScope
  byStatus: Record<DdStatus, number>;
}

/** Today as `YYYY-MM-DD`. Dates are compared as dates, never as instants. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * An open workstream whose due date has passed.
 *
 * A cleared line is never overdue however late it was cleared — the question
 * this answers is "what is late NOW", not "what ran late". `due_date` is a
 * Postgres `date` surfaced as `YYYY-MM-DD`, so a lexical comparison is an exact
 * date comparison and carries no timezone of its own.
 */
export function isDdOverdue(item: DueDiligenceItem, asOf: string = today()): boolean {
  if (!item.due_date) return false;
  if (item.status === "not_applicable" || isDdCleared(item.status)) return false;
  return item.due_date < asOf;
}

const ZERO: Record<DdStatus, number> = {
  not_started: 0, requested: 0, in_progress: 0, received: 0,
  reviewed: 0, issue_identified: 0, resolved: 0, not_applicable: 0,
};

export function computeProgress(items: DueDiligenceItem[], asOf: string = today()): Progress {
  const byStatus = { ...ZERO };
  let cleared = 0, open = 0, issues = 0, inScope = 0, overdue = 0;
  for (const it of items) {
    byStatus[it.status] += 1;
    if (it.status !== "not_applicable") inScope += 1;
    if (isDdCleared(it.status)) cleared += 1;
    if (isDdOpen(it.status)) open += 1;
    if (isDdIssue(it.status)) issues += 1;
    if (isDdOverdue(it, asOf)) overdue += 1;
  }
  return {
    total: items.length,
    inScope,
    cleared,
    open,
    issues,
    overdue,
    pct: inScope > 0 ? Math.round((cleared / inScope) * 100) : 100,
    byStatus,
  };
}

/**
 * What is actually blocking: open workstreams that are flagged issues, past
 * their due date, or high/critical priority.
 *
 * Overdue earns a place here rather than a marker further down the page. A line
 * whose date has passed is being waited on by somebody, and a list of blockers
 * that omits it is the list that lets a deal slip between two meetings without
 * anyone having decided to let it.
 */
export function criticalOpenItems(
  items: DueDiligenceItem[], asOf: string = today(),
): DueDiligenceItem[] {
  const tier = (it: DueDiligenceItem) =>
    isDdIssue(it.status) ? 0 : isDdOverdue(it, asOf) ? 1 : 2;
  const rank = (it: DueDiligenceItem) =>
    tier(it) * 100 +
    (it.priority === "critical" ? 0 : it.priority === "high" ? 1 : 2) * 10 +
    (it.risk_level === "high" ? 0 : it.risk_level === "medium" ? 1 : 2);
  return items
    .filter(
      (it) =>
        isDdOpen(it.status) &&
        (isDdIssue(it.status) ||
          isDdOverdue(it, asOf) ||
          it.priority === "critical" ||
          it.priority === "high"),
    )
    .sort((a, b) => rank(a) - rank(b));
}
