"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import {
  REQUEST_TYPE_LABEL, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE, timeAgo,
} from "@/lib/activity-labels";
import { setRequestStatusAction } from "@/app/actions/admin-activity";
import type { RequestRow } from "@/lib/data/admin-activity";
import type { RequestStatus } from "@/lib/data/investor-portal";

const NEXT: { status: RequestStatus; label: string }[] = [
  { status: "acknowledged", label: "Acknowledge" },
  { status: "in_progress", label: "In progress" },
  { status: "closed", label: "Close" },
];

/**
 * Requests awaiting a Reiwa response, and what was asked. Triage is an admin
 * action: the investor who submitted a request has no update policy on the
 * table and cannot change it after the fact.
 */
export function RequestList({
  requests, showOrganisation = true, showOpportunity = true, emptyMessage,
}: {
  requests: RequestRow[];
  showOrganisation?: boolean;
  showOpportunity?: boolean;
  emptyMessage?: string;
}) {
  const [pending, start] = useTransition();

  if (requests.length === 0) {
    return (
      <p className="rounded border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
        {emptyMessage ?? "No requests have been submitted."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line rounded border border-line">
      {requests.map((r) => (
        <li key={r.requestId} className="px-4 py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">
                  {REQUEST_TYPE_LABEL[r.requestType]}
                </span>
                <Badge tone={REQUEST_STATUS_TONE[r.status]} dot>
                  {REQUEST_STATUS_LABEL[r.status]}
                </Badge>
                <span className="text-2xs text-ink-faint">{timeAgo(r.createdAt)}</span>
              </div>

              <div className="mt-1 text-2xs text-ink-muted">
                {showOrganisation && (
                  <>
                    <Link
                      href={`/admin/investors/${r.investorOrgId}`}
                      className="text-ink-muted hover:text-gold-deep"
                    >
                      {r.investorOrgName}
                    </Link>
                    <span className="px-1.5 text-line">·</span>
                  </>
                )}
                {r.contactName} &lt;{r.contactEmail}&gt;
                {showOpportunity && r.publicationId && r.publicationTitle && (
                  <>
                    <span className="px-1.5 text-line">·</span>
                    <Link
                      href={`/admin/publications/${r.publicationId}`}
                      className="text-ink-muted hover:text-gold-deep"
                    >
                      {r.publicationTitle}
                    </Link>
                  </>
                )}
              </div>

              {r.message && (
                <p className="mt-2 max-w-prose whitespace-pre-line border-l-2 border-line pl-3 text-sm leading-relaxed text-ink">
                  {r.message}
                </p>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap gap-1.5">
              {NEXT.filter((n) => n.status !== r.status).map((n) => (
                <button
                  key={n.status}
                  type="button"
                  disabled={pending}
                  onClick={() => start(async () => {
                    await setRequestStatusAction(r.requestId, n.status);
                  })}
                  className="rounded border border-line px-2.5 py-1 text-2xs font-medium text-ink-muted transition-colors hover:border-gold/40 hover:text-ink disabled:opacity-50"
                >
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
