"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import type { DdItemRecord } from "@/lib/data/due-diligence";
import { isDdOverdue, type Progress } from "@/lib/dd/progress";
import { DD_STATUS_ORDER } from "@/lib/domain";
import { applyDdTemplateAction, updateDdItemAction, promoteFindingAction } from "@/app/actions/workspace";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Section, Empty, Provenance } from "@/components/workspace/primitives";
import { DD_STATUS_LABEL, DD_STATUS_TONE } from "@/lib/workspace/labels";
import type { DdStatus } from "@/types/database";

/**
 * Due diligence: what remains unresolved before committee.
 *
 * Organised by workstream, because that is how the framework is written and how
 * the work is delegated. The section leads with what is blocking rather than
 * with a completion percentage: a tracker whose first fact is "68% complete"
 * invites the reading that the remaining 32% is proportionate, which is exactly
 * the mistake when one of the open lines is a title defect.
 *
 * This is not task management. There is no assignee inbox and no sub-tasks —
 * there is a question, what was found, and whether it is cleared.
 */
export function DiligenceSection({
  opportunityId, items, progress, critical, appliedTemplates, promotedItemIds, canWrite,
}: {
  opportunityId: string;
  items: DdItemRecord[];
  progress: Progress;
  critical: DdItemRecord[];
  appliedTemplates: string[];
  promotedItemIds: string[];
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const promoted = new Set(promotedItemIds);

  if (items.length === 0) {
    return (
      <Section eyebrow="Diligence" title="No framework applied">
        <Empty
          title="This opportunity has no diligence framework yet."
          hint="Applying a framework instantiates Reiwa's standing checklist for the market as live workstreams."
        />
        {canWrite && (
          <div className="mt-4 flex gap-2">
            {(["london", "amsterdam"] as const).map((t) => (
              <button key={t} disabled={pending}
                onClick={() => start(() => applyDdTemplateAction(opportunityId, t))}
                className="rounded border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-60">
                Apply {t === "london" ? "London (UK)" : "Amsterdam (NL)"} framework
              </button>
            ))}
          </div>
        )}
      </Section>
    );
  }

  const sections = groupBySection(items);
  // criticalOpenItems ranks issues first, then critical/high priority. On a
  // 51-line framework that is still a dozen rows, and a "blocking" panel a
  // dozen long stops reading as blocking. Show the head of the ranking and say
  // how much is behind it.
  const BLOCKING_SHOWN = 6;
  const shown = critical.slice(0, BLOCKING_SHOWN);
  const hidden = critical.length - shown.length;

  return (
    <div>
      <Section eyebrow="Blocking" title="Open and material">
        {critical.length === 0 ? (
          <Empty title="Nothing flagged or high-priority is outstanding." />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {shown.map((it) => (
              <li key={it.ddItemId} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {(it.status === "issue_identified" || isDdOverdue(it)) && (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-negative" strokeWidth={2} />
                    )}
                    <span className="text-sm text-ink">{it.item}</span>
                  </div>
                  <div className="text-2xs text-ink-faint">
                    {it.section}
                    {isDdOverdue(it) && (
                      <span className="ml-2 font-medium text-negative">
                        Overdue since {formatDate(it.due_date)}
                      </span>
                    )}
                    {ownerLabel(it) && <span className="ml-2">{ownerLabel(it)}</span>}
                  </div>
                  {it.finding && (
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">{it.finding}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={DD_STATUS_TONE[it.status]}>{DD_STATUS_LABEL[it.status]}</Badge>
                  {canWrite && it.finding && !promoted.has(it.ddItemId) && (
                    <button disabled={pending}
                      onClick={() => start(() => promoteFindingAction(opportunityId, it.ddItemId))}
                      title="Create a persistent deal risk from this finding"
                      className="flex items-center gap-1 rounded border border-line px-2 py-1 text-2xs font-medium text-ink-muted hover:text-ink disabled:opacity-60">
                      <ArrowUpRight className="h-3 w-3" /> Raise risk
                    </button>
                  )}
                  {promoted.has(it.ddItemId) && (
                    <span className="text-2xs text-ink-faint">Risk raised</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <p className="mt-2 text-2xs text-ink-faint">
            {hidden} further open high-priority workstream{hidden === 1 ? "" : "s"} below.
          </p>
        )}
        <Provenance>
          {progress.cleared} of {progress.inScope} in-scope workstreams cleared
          {progress.issues > 0 ? ` · ${progress.issues} flagged` : ""}
          {progress.overdue > 0 ? ` · ${progress.overdue} overdue` : ""}
          {progress.total !== progress.inScope
            ? ` · ${progress.total - progress.inScope} not applicable`
            : ""}
          {" · "}framework{appliedTemplates.length === 1 ? "" : "s"}: {appliedTemplates.join(", ") || "none"}
        </Provenance>
      </Section>

      {sections.map(([section, rows]) => (
        <Section key={section} eyebrow="Workstream" title={section}>
          <ul className="divide-y divide-line border-y border-line">
            {rows.map((it) => (
              <DdRow
                key={it.ddItemId}
                opportunityId={opportunityId}
                item={it}
                canWrite={canWrite}
                promoted={promoted.has(it.ddItemId)}
              />
            ))}
          </ul>
        </Section>
      ))}

      {canWrite && appliedTemplates.length < 2 && (
        <Section eyebrow="Supplemental" title="Add another framework">
          <p className="mb-3 max-w-2xl text-xs leading-relaxed text-ink-muted">
            A second framework adds its own workstreams. Lines already present are
            shared rather than duplicated, so completion is unaffected.
          </p>
          <div className="flex gap-2">
            {(["london", "amsterdam"] as const)
              .filter((t) => !appliedTemplates.includes(t))
              .map((t) => (
                <button key={t} disabled={pending}
                  onClick={() => start(() => applyDdTemplateAction(opportunityId, t))}
                  className="rounded border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-60">
                  Add {t === "london" ? "London (UK)" : "Amsterdam (NL)"} framework
                </button>
              ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/**
 * Who is carrying this workstream, or nothing at all.
 *
 * Returns null for an unowned line rather than the word "Unassigned": on a
 * 51-line framework most lines are unowned early on, and a column of
 * "Unassigned" is noise that hides the handful that are owned. Where an owner
 * exists but cannot be named — `profiles_self` stops a non-admin reading a
 * colleague's profile — the row says "Assigned" rather than claiming nobody.
 */
function ownerLabel(item: DdItemRecord): string | null {
  if (item.ownerName) return item.ownerName;
  return item.ownerUserId ? "Assigned" : null;
}

function DdRow({
  opportunityId, item, canWrite, promoted,
}: {
  opportunityId: string;
  item: DdItemRecord;
  canWrite: boolean;
  promoted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cleared = item.status === "reviewed" || item.status === "resolved";

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          <span className={cn("text-sm", cleared ? "text-ink-muted" : "text-ink")}>{item.item}</span>
          {item.question && (
            <span className="mt-0.5 block max-w-2xl text-2xs leading-relaxed text-ink-faint">
              {item.question}
            </span>
          )}
          {item.finding && !open && (
            <span className="mt-1 block max-w-2xl truncate text-xs text-ink-muted">{item.finding}</span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {item.due_date && (
            <span className={cn(
              "text-2xs",
              isDdOverdue(item) ? "font-medium text-negative" : "text-ink-faint",
            )}>
              {isDdOverdue(item) ? "Overdue " : ""}{formatDate(item.due_date)}
            </span>
          )}
          {ownerLabel(item) && (
            <span className="text-2xs text-ink-faint">{ownerLabel(item)}</span>
          )}
          <Badge tone={DD_STATUS_TONE[item.status]}>{DD_STATUS_LABEL[item.status]}</Badge>
        </div>
      </div>

      {open && (
        <div className="mt-3 border-l-2 border-line pl-4">
          {canWrite ? (
            <form action={updateDdItemAction.bind(null, opportunityId, item.ddItemId)} className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="eyebrow">Status</span>
                  <select name="status" defaultValue={item.status}
                    className="mt-1 h-8 rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none">
                    {DD_STATUS_ORDER.map((s: DdStatus) => (
                      <option key={s} value={s}>{DD_STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="eyebrow">Due</span>
                  <input name="dueDate" type="date" defaultValue={item.due_date ?? ""}
                    className="mt-1 h-8 rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none" />
                </label>
              </div>
              <label className="block">
                <span className="eyebrow">Finding</span>
                <textarea name="finding" rows={2} defaultValue={item.finding ?? ""}
                  placeholder="What diligence established"
                  className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
              </label>
              <label className="block">
                <span className="eyebrow">Resolution</span>
                <textarea name="resolution" rows={2} defaultValue={item.resolution ?? ""}
                  placeholder="How it was cleared, or what mitigates it"
                  className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
              </label>
              <div className="flex items-center gap-2">
                <button type="submit"
                  className="rounded bg-purple px-3 py-1.5 text-2xs font-semibold text-surface hover:bg-purple-70">
                  Save
                </button>
                {promoted && <span className="text-2xs text-ink-faint">A risk has been raised from this finding.</span>}
              </div>
            </form>
          ) : (
            <dl className="space-y-2 text-xs">
              <div><dt className="eyebrow">Finding</dt><dd className="text-ink-muted">{item.finding ?? "—"}</dd></div>
              <div><dt className="eyebrow">Resolution</dt><dd className="text-ink-muted">{item.resolution ?? "—"}</dd></div>
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

/** Framework order is the memo order; preserve it rather than sorting alphabetically. */
function groupBySection(items: DdItemRecord[]): [string, DdItemRecord[]][] {
  const map = new Map<string, DdItemRecord[]>();
  for (const it of items) {
    const list = map.get(it.section) ?? [];
    list.push(it);
    map.set(it.section, list);
  }
  return [...map.entries()];
}
