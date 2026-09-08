import Link from "next/link";
import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import {
  listActivity, getActivityFilterOptions, listRequests, REPORTABLE_EVENTS,
  type ActivityEventType, type ActivityFilters,
} from "@/lib/data/admin-activity";
import { ActivityFeed } from "@/components/admin/activity-feed";
import { RequestList } from "@/components/admin/request-list";
import { ActivityFilterBar } from "@/components/admin/activity-filter-bar";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * The internal activity record: what investors have actually done, filterable
 * by organisation, contact, opportunity, event type and date. Every row is an
 * event that was recorded — there is nothing derived on this page.
 */
export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const auth = await requireAdminAuth();
  const session = toDbSession(auth);

  const types = (searchParams.type ?? "")
    .split(",").map((s) => s.trim())
    .filter((s): s is ActivityEventType => (REPORTABLE_EVENTS as string[]).includes(s));

  const page = Math.max(Number(searchParams.page ?? "1") || 1, 1);
  const filters: ActivityFilters = {
    investorOrgId: searchParams.org || null,
    investorContactId: searchParams.contact || null,
    publicationId: searchParams.publication || null,
    eventTypes: types.length > 0 ? types : undefined,
    from: searchParams.from || null,
    to: searchParams.to || null,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const [activity, options, openRequests] = await Promise.all([
    listActivity(session, filters),
    getActivityFilterOptions(session),
    listRequests(session, { openOnly: true }),
  ]);

  const shown = activity.rows.length;
  const first = activity.total === 0 ? 0 : filters.offset! + 1;
  const last = filters.offset! + shown;
  const hasMore = last < activity.total;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-7 border-b border-line pb-5">
        <div className="eyebrow mb-1.5">Investment Portal</div>
        <h1 className="text-2xl text-ink">Investor Activity</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Every action recorded in the investor portal, as it was recorded. Counts and timestamps
          only — no engagement scores, rankings or inferred intent.
        </p>
      </header>

      {openRequests.length > 0 && (
        <section className="mb-9">
          <SectionHeading
            title="Open requests"
            note={`${openRequests.length} awaiting a response`}
          />
          <RequestList requests={openRequests.slice(0, 6)} />
          {openRequests.length > 6 && (
            <p className="mt-2 text-2xs text-ink-faint">
              Showing the 6 most recent of {openRequests.length}. The rest are on each investor&rsquo;s page.
            </p>
          )}
        </section>
      )}

      <section>
        <SectionHeading
          title="Activity record"
          note={activity.total === 0 ? "no events" : `${first}–${last} of ${activity.total}`}
        />
        <ActivityFilterBar options={options} />
        <div className="mt-5">
          <ActivityFeed
            rows={activity.rows}
            emptyMessage={
              activity.total === 0 && !hasFilters(searchParams)
                ? "No investor activity has been recorded yet."
                : "No activity matches these filters."
            }
          />
        </div>

        {(page > 1 || hasMore) && (
          <nav className="mt-5 flex items-center justify-between" aria-label="Pagination">
            <PageLink params={searchParams} page={page - 1} disabled={page <= 1}>
              ← Newer
            </PageLink>
            <span className="text-2xs text-ink-faint">Page {page}</span>
            <PageLink params={searchParams} page={page + 1} disabled={!hasMore}>
              Older →
            </PageLink>
          </nav>
        )}
      </section>
    </div>
  );
}

function hasFilters(p: Record<string, string | undefined>): boolean {
  return Boolean(p.org || p.contact || p.publication || p.type || p.from || p.to);
}

function PageLink({
  params, page, disabled, children,
}: {
  params: Record<string, string | undefined>;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="text-2xs text-ink-faint opacity-50">{children}</span>;
  }
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "page") next.set(k, v);
  if (page > 1) next.set("page", String(page));
  return (
    <Link
      href={`/admin/activity${next.toString() ? `?${next}` : ""}`}
      className="text-2xs font-medium text-ink-muted hover:text-ink-muted"
    >
      {children}
    </Link>
  );
}

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-line pb-2">
      <h2 className="text-lg text-ink">{title}</h2>
      {note && <span className="text-2xs uppercase tracking-label text-ink-faint">{note}</span>}
    </div>
  );
}
