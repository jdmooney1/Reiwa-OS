import type { DueDiligenceItem, DdStatus } from "@/types/database";
import { isDdCleared, isDdIssue, isDdOpen } from "@/lib/domain";

export interface Progress {
  total: number;
  inScope: number; // excludes Not Applicable
  cleared: number; // reviewed + resolved
  open: number;
  issues: number;
  pct: number; // cleared / inScope
  byStatus: Record<DdStatus, number>;
}

const ZERO: Record<DdStatus, number> = {
  not_started: 0, requested: 0, in_progress: 0, received: 0,
  reviewed: 0, issue_identified: 0, resolved: 0, not_applicable: 0,
};

export function computeProgress(items: DueDiligenceItem[]): Progress {
  const byStatus = { ...ZERO };
  let cleared = 0, open = 0, issues = 0, inScope = 0;
  for (const it of items) {
    byStatus[it.status] += 1;
    if (it.status !== "not_applicable") inScope += 1;
    if (isDdCleared(it.status)) cleared += 1;
    if (isDdOpen(it.status)) open += 1;
    if (isDdIssue(it.status)) issues += 1;
  }
  return {
    total: items.length,
    inScope,
    cleared,
    open,
    issues,
    pct: inScope > 0 ? Math.round((cleared / inScope) * 100) : 100,
    byStatus,
  };
}

/** Critical open items: open workstreams that are flagged issues or high/critical priority. */
export function criticalOpenItems(items: DueDiligenceItem[]): DueDiligenceItem[] {
  const rank = (it: DueDiligenceItem) =>
    (isDdIssue(it.status) ? 0 : 1) * 100 +
    (it.priority === "critical" ? 0 : it.priority === "high" ? 1 : 2) * 10 +
    (it.risk_level === "high" ? 0 : it.risk_level === "medium" ? 1 : 2);
  return items
    .filter(
      (it) =>
        isDdOpen(it.status) &&
        (isDdIssue(it.status) || it.priority === "critical" || it.priority === "high"),
    )
    .sort((a, b) => rank(a) - rank(b));
}
