import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EVENT_LABEL, EVENT_TONE, timeAgo } from "@/lib/activity-labels";
import type { ActivityRow } from "@/lib/data/admin-activity";

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * The activity record, as recorded. Each row restates one event: when, who,
 * what they did and what they did it to. Nothing is aggregated into a score
 * and no interval between events is presented as a duration.
 */
export function ActivityFeed({
  rows, showOrganisation = true, showContact = true, emptyMessage,
}: {
  rows: ActivityRow[];
  showOrganisation?: boolean;
  showContact?: boolean;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
        {emptyMessage ?? "No activity has been recorded yet."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            <Th className="w-40">When</Th>
            <Th className="w-44">Action</Th>
            {showOrganisation && <Th>Investor</Th>}
            {showContact && <Th>Contact</Th>}
            <Th>Opportunity</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.eventId} className="border-b border-line last:border-b-0 align-top">
              <td className="px-3 py-2.5 text-2xs text-ink-muted">
                <div className="tabular-nums text-ink">{timeAgo(r.occurredAt)}</div>
                <div className="tabular-nums text-ink-faint">{stamp(r.occurredAt)}</div>
              </td>
              <td className="px-3 py-2.5">
                <Badge tone={EVENT_TONE[r.eventType]}>{EVENT_LABEL[r.eventType]}</Badge>
                {r.eventType === "compared" && r.comparedCount != null && (
                  <span className="ml-1.5 text-2xs text-ink-faint">
                    {r.comparedCount} opportunities
                  </span>
                )}
              </td>
              {showOrganisation && (
                <td className="px-3 py-2.5">
                  <Link
                    href={`/admin/investors/${r.investorOrgId}`}
                    className="text-sm text-ink hover:text-ink-muted"
                  >
                    {r.investorOrgName}
                  </Link>
                </td>
              )}
              {showContact && (
                <td className="px-3 py-2.5">
                  <div className="text-sm text-ink">{r.contactName}</div>
                  <div className="text-2xs text-ink-faint">{r.contactEmail}</div>
                </td>
              )}
              <td className="px-3 py-2.5">
                {r.publicationId && r.publicationTitle ? (
                  <Link
                    href={`/admin/publications/${r.publicationId}`}
                    className="text-sm text-ink hover:text-ink-muted"
                  >
                    {r.publicationTitle}
                  </Link>
                ) : (
                  <span className="text-sm text-ink-faint">—</span>
                )}
                {r.documentTitle && (
                  <div className="text-2xs text-ink-faint">{r.documentTitle}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 pb-2 text-left text-2xs font-semibold uppercase tracking-label text-ink-faint ${className ?? ""}`}>
      {children}
    </th>
  );
}

/** Recorded counts by event type. Counts only — never weighted or combined. */
export function ActivityCounts({
  counts,
}: {
  counts: Partial<Record<string, number>>;
}) {
  const shown = Object.entries(counts).filter(([, n]) => (n ?? 0) > 0);
  if (shown.length === 0) {
    return <p className="text-sm text-ink-muted">No activity recorded.</p>;
  }
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      {shown.map(([type, n]) => (
        <div key={type}>
          <dt className="text-2xs uppercase tracking-label text-ink-faint">
            {EVENT_LABEL[type as keyof typeof EVENT_LABEL] ?? type}
          </dt>
          <dd className="text-lg tabular-nums text-ink">{n}</dd>
        </div>
      ))}
    </dl>
  );
}
