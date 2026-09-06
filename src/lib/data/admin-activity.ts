// ============================================================================
// Investor engagement & commercial intelligence (P5) — INTERNAL ADMIN ONLY.
// ----------------------------------------------------------------------------
// A factual, auditable read over the P1 activity record. Every function runs
// through withSession() on a Reiwa admin session, so the `*_admin` policies
// from 0005 decide access: an investor session matches none of them and reads
// nothing here, and neither does an ordinary internal org user.
//
// What this layer deliberately does NOT do:
//   * no engagement score, lead score, ranking or suitability inference;
//   * no session duration — the record holds instants, not intervals, and one
//     is never subtracted from another to invent "time spent";
//   * no derived intent of any kind.
// Everything returned is either an event that was actually recorded, or a
// count/most-recent-timestamp over those events. If Reiwa did not record it,
// this module cannot show it.
//
// It is also strictly read-only over investor_activity_events: there is no
// update or delete statement against that table anywhere in the application,
// which is what keeps the record an append-only audit trail.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { str } from "@/lib/data/coerce";
import type { RequestType, RequestStatus } from "@/lib/data/investor-portal";

export { REPORTABLE_EVENTS } from "@/lib/activity-events";
export type { ActivityEventType } from "@/lib/activity-events";
import type { ActivityEventType } from "@/lib/activity-events";
import { REPORTABLE_EVENTS } from "@/lib/activity-events";

export interface ActivityRow {
  eventId: string;
  occurredAt: string;
  eventType: ActivityEventType;
  investorOrgId: string;
  investorOrgName: string;
  investorContactId: string;
  contactName: string;
  contactEmail: string;
  publicationId: string | null;
  publicationTitle: string | null;
  documentId: string | null;
  documentTitle: string | null;
  /** How many opportunities a comparison held. Recorded, not inferred. */
  comparedCount: number | null;
}

export interface ActivityFilters {
  investorOrgId?: string | null;
  investorContactId?: string | null;
  publicationId?: string | null;
  eventTypes?: ActivityEventType[];
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

// The publication title an event refers to: the version it was recorded
// against when one was captured, otherwise the publication's current active
// version. Titles are investor-approved content, so this leaks nothing.
const EVENT_SELECT = `
  select e.event_id, e.occurred_at, e.event_type,
         e.investor_org_id, o.name as org_name,
         e.investor_contact_id, c.name as contact_name, c.email as contact_email,
         e.publication_id,
         coalesce(ev.title, av.title) as publication_title,
         e.document_id, d.title as document_title,
         case when e.event_type = 'compared'
              then jsonb_array_length(coalesce(e.context -> 'publication_ids', '[]'::jsonb))
         end as compared_count
    from investor_activity_events e
    join investor_organizations o on o.investor_org_id = e.investor_org_id
    join investor_contacts c on c.investor_contact_id = e.investor_contact_id
    left join publication_versions ev on ev.version_id = e.version_id
    left join investor_publications p on p.publication_id = e.publication_id
    left join publication_versions av on av.version_id = p.active_version_id
    left join publication_documents d on d.document_id = e.document_id`;

interface RawEvent {
  event_id: string; occurred_at: string; event_type: string;
  investor_org_id: string; org_name: string; investor_contact_id: string;
  contact_name: string; contact_email: string; publication_id: string | null;
  publication_title: string | null; document_id: string | null;
  document_title: string | null; compared_count: unknown;
}

function toRow(r: RawEvent): ActivityRow {
  return {
    eventId: r.event_id,
    occurredAt: r.occurred_at,
    eventType: r.event_type as ActivityEventType,
    investorOrgId: r.investor_org_id,
    investorOrgName: r.org_name,
    investorContactId: r.investor_contact_id,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    publicationId: r.publication_id,
    publicationTitle: str(r.publication_title),
    documentId: r.document_id,
    documentTitle: str(r.document_title),
    comparedCount: r.compared_count == null ? null : Number(r.compared_count),
  };
}

/** Build the WHERE clause for the filters that were actually supplied. */
function whereFor(f: ActivityFilters, params: unknown[]): string {
  const clauses: string[] = [];
  if (f.investorOrgId) { params.push(f.investorOrgId); clauses.push(`e.investor_org_id = $${params.length}`); }
  if (f.investorContactId) { params.push(f.investorContactId); clauses.push(`e.investor_contact_id = $${params.length}`); }
  if (f.publicationId) { params.push(f.publicationId); clauses.push(`e.publication_id = $${params.length}`); }
  if (f.eventTypes && f.eventTypes.length > 0) {
    params.push(f.eventTypes); clauses.push(`e.event_type = any($${params.length}::text[])`);
  }
  if (f.from) { params.push(f.from); clauses.push(`e.occurred_at >= $${params.length}::timestamptz`); }
  if (f.to) { params.push(f.to); clauses.push(`e.occurred_at < ($${params.length}::timestamptz + interval '1 day')`); }
  return clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
}

export interface ActivityPage {
  rows: ActivityRow[];
  total: number;
}

/** The filtered activity feed, newest first. */
export async function listActivity(
  session: Session, filters: ActivityFilters = {},
): Promise<ActivityPage> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  return withSession(session, async (tx) => {
    const params: unknown[] = [];
    const where = whereFor(filters, params);

    // The filters only ever reference `e`, so the count needs no joins.
    const counted = await tx.query<{ n: string }>(
      `select count(*)::text as n from investor_activity_events e ${where}`, [...params]);

    params.push(limit, offset);
    const { rows } = await tx.query<RawEvent>(
      `${EVENT_SELECT} ${where} order by e.occurred_at desc, e.event_id
        limit $${params.length - 1} offset $${params.length}`, params);

    return { rows: rows.map(toRow), total: Number(counted.rows[0].n) };
  });
}

// ---- Investor organisation ------------------------------------------------

export interface OrgActivitySummary {
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  /** Recorded counts, by event type. Nothing is weighted or combined. */
  counts: Record<ActivityEventType, number>;
  /** Distinct publications this organisation's contacts have opened. */
  opportunitiesViewed: { publicationId: string; title: string; views: number; lastViewedAt: string }[];
  /** Per-contact totals, so an operator can see who is actually looking. */
  contacts: {
    investorContactId: string; name: string; email: string;
    isActive: boolean; lastLoginAt: string | null; lastActivityAt: string | null; events: number;
  }[];
  recent: ActivityRow[];
}

const ZERO_COUNTS = (): Record<ActivityEventType, number> =>
  Object.fromEntries(REPORTABLE_EVENTS.map((t) => [t, 0])) as Record<ActivityEventType, number>;

/** Everything factual recorded for one investor organisation. */
export async function getOrgActivity(
  session: Session, investorOrgId: string,
): Promise<OrgActivitySummary> {
  return withSession(session, async (tx) => {
    const counts = ZERO_COUNTS();
    const byType = await tx.query<{ event_type: string; n: string }>(
      `select event_type, count(*)::text as n from investor_activity_events
        where investor_org_id = $1 group by event_type`, [investorOrgId]);
    for (const r of byType.rows) {
      if (r.event_type in counts) counts[r.event_type as ActivityEventType] = Number(r.n);
    }

    const stamps = (await tx.query<{ last_login: string | null; last_activity: string | null }>(
      `select max(occurred_at) filter (where event_type = 'login') as last_login,
              max(occurred_at)                                     as last_activity
         from investor_activity_events where investor_org_id = $1`, [investorOrgId])).rows[0];

    const viewed = await tx.query<{
      publication_id: string; title: string | null; n: string; last_viewed: string;
    }>(
      `select e.publication_id,
              coalesce(max(ev.title), max(av.title)) as title,
              count(*)::text as n, max(e.occurred_at) as last_viewed
         from investor_activity_events e
         left join publication_versions ev on ev.version_id = e.version_id
         left join investor_publications p on p.publication_id = e.publication_id
         left join publication_versions av on av.version_id = p.active_version_id
        where e.investor_org_id = $1 and e.event_type = 'opportunity_viewed'
          and e.publication_id is not null
        group by e.publication_id
        order by max(e.occurred_at) desc`, [investorOrgId]);

    const contacts = await tx.query<{
      investor_contact_id: string; name: string; email: string; is_active: boolean;
      last_login: string | null; last_activity: string | null; events: string;
    }>(
      `select c.investor_contact_id, c.name, c.email, c.is_active,
              max(e.occurred_at) filter (where e.event_type = 'login') as last_login,
              max(e.occurred_at) as last_activity,
              count(e.event_id)::text as events
         from investor_contacts c
         left join investor_activity_events e
                on e.investor_contact_id = c.investor_contact_id
        where c.investor_org_id = $1
        group by c.investor_contact_id, c.name, c.email, c.is_active
        order by max(e.occurred_at) desc nulls last, c.name`, [investorOrgId]);

    const recent = await tx.query<RawEvent>(
      `${EVENT_SELECT} where e.investor_org_id = $1
        order by e.occurred_at desc, e.event_id limit 40`, [investorOrgId]);

    return {
      lastLoginAt: stamps?.last_login ?? null,
      lastActivityAt: stamps?.last_activity ?? null,
      counts,
      opportunitiesViewed: viewed.rows.map((r) => ({
        publicationId: r.publication_id,
        title: r.title ?? "—",
        views: Number(r.n),
        lastViewedAt: r.last_viewed,
      })),
      contacts: contacts.rows.map((r) => ({
        investorContactId: r.investor_contact_id,
        name: r.name,
        email: r.email,
        isActive: r.is_active,
        lastLoginAt: r.last_login,
        lastActivityAt: r.last_activity,
        events: Number(r.events),
      })),
      recent: recent.rows.map(toRow),
    };
  });
}

// ---- Publication ----------------------------------------------------------

export interface PublicationActivity {
  totals: Record<ActivityEventType, number>;
  /** One row per investor organisation that has actually done something. */
  byOrganisation: {
    investorOrgId: string; name: string;
    views: number; saves: number; compares: number; requests: number;
    lastActivityAt: string;
  }[];
  recent: ActivityRow[];
}

/** Factual investor activity recorded against one publication. */
export async function getPublicationActivity(
  session: Session, publicationId: string,
): Promise<PublicationActivity> {
  return withSession(session, async (tx) => {
    const totals = ZERO_COUNTS();
    const byType = await tx.query<{ event_type: string; n: string }>(
      `select event_type, count(*)::text as n from investor_activity_events
        where publication_id = $1 group by event_type`, [publicationId]);
    for (const r of byType.rows) {
      if (r.event_type in totals) totals[r.event_type as ActivityEventType] = Number(r.n);
    }

    const byOrg = await tx.query<{
      investor_org_id: string; name: string; views: string; saves: string;
      compares: string; requests: string; last_activity: string;
    }>(
      `select e.investor_org_id, o.name,
              count(*) filter (where e.event_type = 'opportunity_viewed')::text     as views,
              count(*) filter (where e.event_type = 'saved')::text                  as saves,
              count(*) filter (where e.event_type = 'compared')::text               as compares,
              count(*) filter (where e.event_type = 'information_requested')::text  as requests,
              max(e.occurred_at) as last_activity
         from investor_activity_events e
         join investor_organizations o on o.investor_org_id = e.investor_org_id
        where e.publication_id = $1
        group by e.investor_org_id, o.name
        order by max(e.occurred_at) desc`, [publicationId]);

    const recent = await tx.query<RawEvent>(
      `${EVENT_SELECT} where e.publication_id = $1
        order by e.occurred_at desc, e.event_id limit 30`, [publicationId]);

    return {
      totals,
      byOrganisation: byOrg.rows.map((r) => ({
        investorOrgId: r.investor_org_id,
        name: r.name,
        views: Number(r.views),
        saves: Number(r.saves),
        compares: Number(r.compares),
        requests: Number(r.requests),
        lastActivityAt: r.last_activity,
      })),
      recent: recent.rows.map(toRow),
    };
  });
}

// ---- Requests / follow-up -------------------------------------------------

export interface RequestRow {
  requestId: string;
  requestType: RequestType;
  status: RequestStatus;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  investorOrgId: string;
  investorOrgName: string;
  investorContactId: string;
  contactName: string;
  contactEmail: string;
  publicationId: string | null;
  publicationTitle: string | null;
}

export const OPEN_REQUEST_STATUSES: RequestStatus[] = ["new", "acknowledged", "in_progress"];

/**
 * Requests with the organisation, contact and opportunity resolved. `openOnly`
 * narrows to the ones still needing a Reiwa response.
 */
export async function listRequests(
  session: Session,
  opts: { investorOrgId?: string | null; publicationId?: string | null; openOnly?: boolean } = {},
): Promise<RequestRow[]> {
  return withSession(session, async (tx) => {
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (opts.investorOrgId) { params.push(opts.investorOrgId); clauses.push(`r.investor_org_id = $${params.length}`); }
    if (opts.publicationId) { params.push(opts.publicationId); clauses.push(`r.publication_id = $${params.length}`); }
    if (opts.openOnly) { params.push(OPEN_REQUEST_STATUSES); clauses.push(`r.status = any($${params.length}::text[])`); }
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";

    const { rows } = await tx.query<Record<string, string | null>>(
      `select r.request_id, r.request_type, r.status, r.message, r.created_at, r.updated_at,
              r.investor_org_id, o.name as org_name,
              r.investor_contact_id, c.name as contact_name, c.email as contact_email,
              r.publication_id, av.title as publication_title
         from investor_requests r
         join investor_organizations o on o.investor_org_id = r.investor_org_id
         join investor_contacts c on c.investor_contact_id = r.investor_contact_id
         left join investor_publications p on p.publication_id = r.publication_id
         left join publication_versions av on av.version_id = p.active_version_id
         ${where}
        order by case r.status when 'new' then 0 when 'acknowledged' then 1
                               when 'in_progress' then 2 else 3 end,
                 r.created_at desc`, params);

    return rows.map((r) => ({
      requestId: r.request_id as string,
      requestType: r.request_type as RequestType,
      status: r.status as RequestStatus,
      message: str(r.message),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      investorOrgId: r.investor_org_id as string,
      investorOrgName: r.org_name as string,
      investorContactId: r.investor_contact_id as string,
      contactName: r.contact_name as string,
      contactEmail: r.contact_email as string,
      publicationId: r.publication_id ?? null,
      publicationTitle: str(r.publication_title),
    }));
  });
}

// ---- Operational signals for the admin home -------------------------------

export interface ActivitySignals {
  openRequests: number;
  /** Organisations with at least one recorded event in the window. */
  activeOrganisations: { investorOrgId: string; name: string; events: number; lastActivityAt: string }[];
  /** Publications with recorded activity in the window. */
  activePublications: { publicationId: string; title: string; events: number; lastActivityAt: string }[];
  windowDays: number;
}

/**
 * A few operational signals, deliberately small: counts and most-recent
 * timestamps over a fixed window. Not a dashboard.
 */
export async function getActivitySignals(
  session: Session, windowDays = 30,
): Promise<ActivitySignals> {
  const days = Math.min(Math.max(windowDays, 1), 365);
  return withSession(session, async (tx) => {
    const open = (await tx.query<{ n: string }>(
      `select count(*)::text as n from investor_requests where status = any($1::text[])`,
      [OPEN_REQUEST_STATUSES])).rows[0];

    const orgs = await tx.query<{ investor_org_id: string; name: string; n: string; last_at: string }>(
      `select e.investor_org_id, o.name, count(*)::text as n, max(e.occurred_at) as last_at
         from investor_activity_events e
         join investor_organizations o on o.investor_org_id = e.investor_org_id
        where e.occurred_at >= now() - make_interval(days => $1)
        group by e.investor_org_id, o.name
        order by max(e.occurred_at) desc limit 8`, [days]);

    const pubs = await tx.query<{ publication_id: string; title: string | null; n: string; last_at: string }>(
      `select e.publication_id,
              coalesce(max(ev.title), max(av.title)) as title,
              count(*)::text as n, max(e.occurred_at) as last_at
         from investor_activity_events e
         left join publication_versions ev on ev.version_id = e.version_id
         left join investor_publications p on p.publication_id = e.publication_id
         left join publication_versions av on av.version_id = p.active_version_id
        where e.publication_id is not null
          and e.occurred_at >= now() - make_interval(days => $1)
        group by e.publication_id
        order by max(e.occurred_at) desc limit 8`, [days]);

    return {
      openRequests: Number(open.n),
      activeOrganisations: orgs.rows.map((r) => ({
        investorOrgId: r.investor_org_id, name: r.name,
        events: Number(r.n), lastActivityAt: r.last_at,
      })),
      activePublications: pubs.rows.map((r) => ({
        publicationId: r.publication_id, title: r.title ?? "—",
        events: Number(r.n), lastActivityAt: r.last_at,
      })),
      windowDays: days,
    };
  });
}

// ---- Filter option lists --------------------------------------------------

export interface ActivityFilterOptions {
  organisations: { investorOrgId: string; name: string }[];
  contacts: { investorContactId: string; name: string; investorOrgId: string }[];
  publications: { publicationId: string; title: string }[];
}

/** The organisations, contacts and publications that appear in the record. */
export async function getActivityFilterOptions(session: Session): Promise<ActivityFilterOptions> {
  return withSession(session, async (tx) => {
    const orgs = await tx.query<{ investor_org_id: string; name: string }>(
      "select investor_org_id, name from investor_organizations order by name");
    const contacts = await tx.query<{ investor_contact_id: string; name: string; investor_org_id: string }>(
      "select investor_contact_id, name, investor_org_id from investor_contacts order by name");
    const pubs = await tx.query<{ publication_id: string; title: string }>(
      `select p.publication_id, v.title
         from investor_publications p
         join publication_versions v on v.version_id = p.active_version_id
        order by v.title`);
    return {
      organisations: orgs.rows.map((r) => ({ investorOrgId: r.investor_org_id, name: r.name })),
      contacts: contacts.rows.map((r) => ({
        investorContactId: r.investor_contact_id, name: r.name, investorOrgId: r.investor_org_id,
      })),
      publications: pubs.rows.map((r) => ({ publicationId: r.publication_id, title: r.title })),
    };
  });
}
