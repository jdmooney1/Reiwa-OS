import Link from "next/link";
import { ActivityFeed, ActivityCounts } from "@/components/admin/activity-feed";
import { RequestList } from "@/components/admin/request-list";
import { timeAgo } from "@/lib/activity-labels";
import type { OrgActivitySummary, PublicationActivity, RequestRow } from "@/lib/data/admin-activity";

function Section({
  title, note, children,
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-line pb-2">
        <h2 className="text-lg text-ink">{title}</h2>
        {note && <span className="text-2xs uppercase tracking-label text-ink-faint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-label text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * What this investor organisation's contacts have actually done. Counts and
 * timestamps, never combined into a single engagement number.
 */
export function OrgActivitySection({
  summary, requests, investorOrgId,
}: {
  summary: OrgActivitySummary;
  requests: RequestRow[];
  investorOrgId: string;
}) {
  const open = requests.filter((r) => r.status !== "closed");

  return (
    <>
      <Section
        title="Requests &amp; follow-up"
        note={open.length > 0 ? `${open.length} open` : "nothing open"}
      >
        <RequestList
          requests={requests}
          showOrganisation={false}
          emptyMessage="This investor has not submitted any requests."
        />
      </Section>

      <Section
        title="Recent activity"
        note={summary.lastActivityAt ? `last activity ${timeAgo(summary.lastActivityAt)}` : "no activity"}
      >
        <div className="rounded border border-line bg-surface-card px-5 py-4">
          <dl className="flex flex-wrap gap-x-10 gap-y-4">
            <Stat
              label="Last portal sign-in"
              value={summary.lastLoginAt ? timeAgo(summary.lastLoginAt) : "Never signed in"}
            />
            <Stat
              label="Last activity"
              value={summary.lastActivityAt ? timeAgo(summary.lastActivityAt) : "—"}
            />
            <Stat label="Opportunities opened" value={String(summary.opportunitiesViewed.length)} />
          </dl>
          <div className="mt-5 border-t border-line pt-4">
            <ActivityCounts counts={summary.counts} />
          </div>
        </div>

        {summary.contacts.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-2xs uppercase tracking-label text-ink-faint">By contact</h3>
            <ul className="divide-y divide-line rounded border border-line">
              {summary.contacts.map((c) => (
                <li key={c.investorContactId} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-2.5">
                  <div>
                    <span className="text-sm text-ink">{c.name}</span>
                    {!c.isActive && (
                      <span className="ml-2 text-2xs text-ink-faint">(deactivated)</span>
                    )}
                    <span className="ml-2 text-2xs text-ink-faint">{c.email}</span>
                  </div>
                  <div className="flex gap-6 text-2xs text-ink-muted">
                    <span>
                      Sign-in:{" "}
                      <span className="text-ink">{c.lastLoginAt ? timeAgo(c.lastLoginAt) : "never"}</span>
                    </span>
                    <span className="tabular-nums">
                      {c.events} {c.events === 1 ? "event" : "events"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.opportunitiesViewed.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-2xs uppercase tracking-label text-ink-faint">
              Opportunities opened
            </h3>
            <ul className="divide-y divide-line rounded border border-line">
              {summary.opportunitiesViewed.map((o) => (
                <li key={o.publicationId} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                  <Link
                    href={`/admin/publications/${o.publicationId}`}
                    className="text-sm text-ink hover:text-ink-muted"
                  >
                    {o.title}
                  </Link>
                  <span className="shrink-0 text-2xs tabular-nums text-ink-muted">
                    {o.views} {o.views === 1 ? "view" : "views"} · {timeAgo(o.lastViewedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5">
          <h3 className="mb-2 text-2xs uppercase tracking-label text-ink-faint">Event record</h3>
          <ActivityFeed
            rows={summary.recent}
            showOrganisation={false}
            emptyMessage="No activity has been recorded for this investor yet."
          />
          {summary.recent.length >= 40 && (
            <p className="mt-2 text-2xs text-ink-faint">
              Showing the 40 most recent events.{" "}
              <Link href={`/admin/activity?org=${investorOrgId}`} className="hover:text-ink-muted">
                See the full record →
              </Link>
            </p>
          )}
        </div>
      </Section>
    </>
  );
}

/** Factual investor activity recorded against one publication. Internal only. */
export function PublicationActivitySection({
  activity, requests, publicationId,
}: {
  activity: PublicationActivity;
  requests: RequestRow[];
  publicationId: string;
}) {
  const anything = activity.recent.length > 0 || activity.byOrganisation.length > 0;

  return (
    <>
      <Section
        title="Investor activity"
        note={anything ? `${activity.byOrganisation.length} investor(s) active` : "no activity"}
      >
        <p className="mb-4 max-w-2xl text-2xs leading-relaxed text-ink-faint">
          Internal only. Investors never see another organisation&rsquo;s activity, or their own
          record.
        </p>

        <div className="rounded border border-line bg-surface-card px-5 py-4">
          <ActivityCounts counts={activity.totals} />
        </div>

        {activity.byOrganisation.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line">
                  {["Investor", "Opened", "Saved", "Compared", "Requests", "Last activity"].map((h, i) => (
                    <th key={h}
                      className={`px-3 pb-2 text-2xs font-semibold uppercase tracking-label text-ink-faint ${i === 0 ? "text-left" : "text-right"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activity.byOrganisation.map((o) => (
                  <tr key={o.investorOrgId} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/investors/${o.investorOrgId}`}
                        className="text-ink hover:text-ink-muted">
                        {o.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{o.views}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{o.saves}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{o.compares}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{o.requests}</td>
                    <td className="px-3 py-2.5 text-right text-2xs text-ink-muted">
                      {timeAgo(o.lastActivityAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5">
          <h3 className="mb-2 text-2xs uppercase tracking-label text-ink-faint">Event record</h3>
          <ActivityFeed
            rows={activity.recent}
            emptyMessage="No investor activity has been recorded against this opportunity."
          />
          {activity.recent.length >= 30 && (
            <p className="mt-2 text-2xs text-ink-faint">
              Showing the 30 most recent events.{" "}
              <Link href={`/admin/activity?publication=${publicationId}`} className="hover:text-ink-muted">
                See the full record →
              </Link>
            </p>
          )}
        </div>
      </Section>

      <Section title="Requests on this opportunity">
        <RequestList
          requests={requests}
          showOpportunity={false}
          emptyMessage="No requests have been submitted on this opportunity."
        />
      </Section>
    </>
  );
}
