// ============================================================================
// Investment Portal — P2 admin read models & workflow helpers.
// ----------------------------------------------------------------------------
// Aggregated views for the /admin screens, built ON TOP of the frozen P1 layer
// (src/lib/data/investor-portal.ts). Everything here runs inside withSession(),
// so the caller's own RLS decides visibility: every portal table is admin-only
// for reads of other people's data, which means a non-admin session gets empty
// results and failed writes from these functions — there is no privileged path.
//
// No new database objects are introduced by P2. These are queries and statement
// sequences over the P1 schema only.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str, bool } from "@/lib/data/coerce";
import type {
  InvestorOrgStatus, PublicationStatus, VersionStatus, Placement,
  EntitlementDocumentLevel, PublicationVersion,
} from "@/lib/data/investor-portal";

// ---- Workflow state of a publication, as the admin thinks about it ---------
// The publication row knows draft/published/withdrawn; the versions know
// in_review and open drafts. The admin screens present one combined state.
export type WorkflowState = "draft" | "in_review" | "published" | "withdrawn";

export function workflowState(
  status: PublicationStatus, hasInReview: boolean,
): WorkflowState {
  if (hasInReview) return "in_review";
  return status;
}

// ============================================================================
// Admin home — operational counts and workflow queues
// ============================================================================
export interface AdminOverview {
  counts: {
    investorOrganizations: number;
    activeContacts: number;
    publicationsInDraft: number;
    publicationsInReview: number;
    publicationsPublished: number;
    visibleAssignments: number;
  };
  /** Versions submitted for review and awaiting a decision. */
  reviewQueue: {
    publicationId: string;
    versionId: string;
    versionNumber: number;
    title: string;
    submittedAt: string | null;
  }[];
  /** Live publications no investor organisation can currently see. */
  unassignedPublished: {
    publicationId: string;
    title: string;
    lastPublishedAt: string | null;
  }[];
  /** Active investor organisations with no visible opportunity at all. */
  investorsWithoutAssignments: {
    investorOrgId: string;
    name: string;
  }[];
}

export async function getAdminOverview(session: Session): Promise<AdminOverview> {
  return withSession(session, async (tx) => {
    const counts = (await tx.query<Record<string, string>>(`
      select
        (select count(*) from investor_organizations)                          as investor_orgs,
        (select count(*) from investor_contacts where is_active)               as active_contacts,
        (select count(*) from investor_publications p
          where p.status = 'draft'
            and not exists (select 1 from publication_versions v
                             where v.publication_id = p.publication_id
                               and v.status = 'in_review'))                    as in_draft,
        (select count(distinct v.publication_id) from publication_versions v
          where v.status = 'in_review')                                        as in_review,
        (select count(*) from investor_publications where status = 'published') as published,
        (select count(*) from publication_entitlements where is_visible)       as visible
    `)).rows[0];

    const reviewQueue = (await tx.query<Record<string, unknown>>(`
      select v.publication_id, v.version_id, v.version_number, v.title, v.submitted_at
        from publication_versions v
       where v.status = 'in_review'
       order by v.submitted_at nulls last, v.created_at
    `)).rows.map((r) => ({
      publicationId: r.publication_id as string,
      versionId: r.version_id as string,
      versionNumber: Number(r.version_number),
      title: r.title as string,
      submittedAt: (r.submitted_at as string | null) ?? null,
    }));

    const unassignedPublished = (await tx.query<Record<string, unknown>>(`
      select p.publication_id, v.title, p.last_published_at
        from investor_publications p
        join publication_versions v on v.version_id = p.active_version_id
       where p.status = 'published'
         and not exists (select 1 from publication_entitlements e
                          where e.publication_id = p.publication_id and e.is_visible)
       order by p.last_published_at desc nulls last
    `)).rows.map((r) => ({
      publicationId: r.publication_id as string,
      title: r.title as string,
      lastPublishedAt: (r.last_published_at as string | null) ?? null,
    }));

    const investorsWithoutAssignments = (await tx.query<Record<string, unknown>>(`
      select o.investor_org_id, o.name
        from investor_organizations o
       where o.status = 'active'
         and not exists (select 1 from publication_entitlements e
                          where e.investor_org_id = o.investor_org_id and e.is_visible)
       order by o.name
    `)).rows.map((r) => ({
      investorOrgId: r.investor_org_id as string,
      name: r.name as string,
    }));

    return {
      counts: {
        investorOrganizations: Number(counts.investor_orgs),
        activeContacts: Number(counts.active_contacts),
        publicationsInDraft: Number(counts.in_draft),
        publicationsInReview: Number(counts.in_review),
        publicationsPublished: Number(counts.published),
        visibleAssignments: Number(counts.visible),
      },
      reviewQueue,
      unassignedPublished,
      investorsWithoutAssignments,
    };
  });
}

// ============================================================================
// Investor organisations — list view
// ============================================================================
export interface InvestorOrgSummary {
  investorOrgId: string;
  name: string;
  status: InvestorOrgStatus;
  linkedInternalOrganizationName: string | null;
  contactsActive: number;
  contactsTotal: number;
  visibleOpportunities: number;
  featuredTitle: string | null;
  updatedAt: string;
}

export async function listInvestorOrgSummaries(session: Session): Promise<InvestorOrgSummary[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(`
      select o.investor_org_id, o.name, o.status, o.updated_at,
             io.name as linked_name,
             (select count(*) from investor_contacts c
               where c.investor_org_id = o.investor_org_id and c.is_active)  as contacts_active,
             (select count(*) from investor_contacts c
               where c.investor_org_id = o.investor_org_id)                  as contacts_total,
             (select count(*) from publication_entitlements e
               where e.investor_org_id = o.investor_org_id and e.is_visible) as visible_count,
             (select coalesce(v.title, fv.title)
                from publication_entitlements e
                join investor_publications p on p.publication_id = e.publication_id
                left join publication_versions v on v.version_id = p.active_version_id
                left join publication_versions fv on fv.version_id =
                  (select version_id from publication_versions
                    where publication_id = p.publication_id
                    order by version_number desc limit 1)
               where e.investor_org_id = o.investor_org_id
                 and e.is_visible and e.placement = 'featured'
               limit 1)                                                      as featured_title
        from investor_organizations o
        left join organizations io on io.org_id = o.linked_internal_organization_id
       order by o.name
    `);
    return rows.map((r) => ({
      investorOrgId: r.investor_org_id as string,
      name: r.name as string,
      status: r.status as InvestorOrgStatus,
      linkedInternalOrganizationName: str(r.linked_name),
      contactsActive: Number(r.contacts_active),
      contactsTotal: Number(r.contacts_total),
      visibleOpportunities: Number(r.visible_count),
      featuredTitle: str(r.featured_title),
      updatedAt: r.updated_at as string,
    }));
  });
}

export async function getInvestorOrganization(
  session: Session, investorOrgId: string,
): Promise<{
  investorOrgId: string;
  name: string;
  status: InvestorOrgStatus;
  linkedInternalOrganizationId: string | null;
  linkedInternalOrganizationName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
} | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `select o.*, io.name as linked_name
         from investor_organizations o
         left join organizations io on io.org_id = o.linked_internal_organization_id
        where o.investor_org_id = $1`,
      [investorOrgId]);
    const r = rows[0];
    if (!r) return null;
    return {
      investorOrgId: r.investor_org_id as string,
      name: r.name as string,
      status: r.status as InvestorOrgStatus,
      linkedInternalOrganizationId: (r.linked_internal_organization_id as string | null) ?? null,
      linkedInternalOrganizationName: str(r.linked_name),
      notes: str(r.notes),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  });
}

// ============================================================================
// Publications — list view
// ============================================================================
export interface PublicationSummary {
  publicationId: string;
  status: PublicationStatus;
  state: WorkflowState;
  /** The active published version if live, otherwise the newest version. */
  title: string;
  market: string | null;
  assetType: string | null;
  currentVersionNumber: number;
  currentVersionStatus: VersionStatus;
  hasOpenDraft: boolean;
  hasInReview: boolean;
  sourceChanged: boolean;
  opportunityName: string | null;
  assignedOrgs: number;
  visibleOrgs: number;
  lastPublishedAt: string | null;
  updatedAt: string;
}

export async function listPublicationSummaries(session: Session): Promise<PublicationSummary[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(`
      with latest as (
        select distinct on (publication_id) publication_id, version_id, version_number, status, title, market, asset_type
          from publication_versions
         order by publication_id, version_number desc
      )
      select p.publication_id, p.status, p.active_version_id, p.last_published_at, p.updated_at,
             av.title as active_title, av.market as active_market, av.asset_type as active_asset_type,
             av.version_number as active_number, av.status as active_status,
             l.title as latest_title, l.market as latest_market, l.asset_type as latest_asset_type,
             l.version_number as latest_number, l.status as latest_status,
             coalesce(av.version_id, l.version_id) as display_version_id,
             exists (select 1 from publication_versions v
                      where v.publication_id = p.publication_id and v.status = 'draft')     as has_draft,
             exists (select 1 from publication_versions v
                      where v.publication_id = p.publication_id and v.status = 'in_review') as has_in_review,
             o.name as opportunity_name,
             (select count(*) from publication_entitlements e
               where e.publication_id = p.publication_id)                                   as assigned_orgs,
             (select count(*) from publication_entitlements e
               where e.publication_id = p.publication_id and e.is_visible)                  as visible_orgs,
             (vs.source_fingerprint is not null
              and vs.source_fingerprint
                  is distinct from app.opportunity_publication_fingerprint(ps.opportunity_id)) as source_changed
        from investor_publications p
        left join publication_versions av on av.version_id = p.active_version_id
        left join latest l on l.publication_id = p.publication_id
        left join publication_sources ps on ps.publication_id = p.publication_id
        left join opportunities o on o.opportunity_id = ps.opportunity_id
        left join publication_version_sources vs on vs.version_id = coalesce(av.version_id, l.version_id)
       order by p.updated_at desc
    `);
    return rows.map((r) => {
      const active = r.active_number != null;
      return {
        publicationId: r.publication_id as string,
        status: r.status as PublicationStatus,
        state: workflowState(r.status as PublicationStatus, bool(r.has_in_review)),
        title: (active ? r.active_title : r.latest_title) as string,
        market: str(active ? r.active_market : r.latest_market),
        assetType: str(active ? r.active_asset_type : r.latest_asset_type),
        currentVersionNumber: Number(active ? r.active_number : r.latest_number),
        currentVersionStatus: (active ? r.active_status : r.latest_status) as VersionStatus,
        hasOpenDraft: bool(r.has_draft),
        hasInReview: bool(r.has_in_review),
        sourceChanged: bool(r.source_changed),
        opportunityName: str(r.opportunity_name),
        assignedOrgs: Number(r.assigned_orgs),
        visibleOrgs: Number(r.visible_orgs),
        lastPublishedAt: (r.last_published_at as string | null) ?? null,
        updatedAt: r.updated_at as string,
      };
    });
  });
}

// ============================================================================
// Publication detail — source panel
// ============================================================================
export interface PublicationSourcePanel {
  opportunityId: string;
  opportunityName: string | null;
  opportunityStage: string | null;
  opportunityStatus: string | null;
  linkedAt: string;
}

/** The internal opportunity behind a publication, admin-only by RLS. */
export async function getPublicationSourcePanel(
  session: Session, publicationId: string,
): Promise<PublicationSourcePanel | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `select ps.opportunity_id, ps.linked_at, o.name, o.stage, o.status
         from publication_sources ps
         left join opportunities o on o.opportunity_id = ps.opportunity_id
        where ps.publication_id = $1`,
      [publicationId]);
    const r = rows[0];
    if (!r) return null;
    return {
      opportunityId: r.opportunity_id as string,
      opportunityName: str(r.name),
      opportunityStage: str(r.stage),
      opportunityStatus: str(r.status),
      linkedAt: r.linked_at as string,
    };
  });
}

/** Per-version drift against the current source, for the version history table. */
export interface VersionDrift {
  versionId: string;
  capturedAt: string | null;
  changed: boolean;
}

export async function listVersionDrift(
  session: Session, publicationId: string,
): Promise<VersionDrift[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `select v.version_id, vs.source_captured_at,
              (vs.source_fingerprint is not null
               and vs.source_fingerprint
                   is distinct from app.opportunity_publication_fingerprint(ps.opportunity_id)) as changed
         from publication_versions v
         join publication_sources ps on ps.publication_id = v.publication_id
         left join publication_version_sources vs on vs.version_id = v.version_id
        where v.publication_id = $1`,
      [publicationId]);
    return rows.map((r) => ({
      versionId: r.version_id as string,
      capturedAt: (r.source_captured_at as string | null) ?? null,
      changed: bool(r.changed),
    }));
  });
}

export async function getPublicationVersion(
  session: Session, versionId: string,
): Promise<PublicationVersion | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      "select * from publication_versions where version_id = $1", [versionId]);
    const r = rows[0];
    if (!r) return null;
    return {
      versionId: r.version_id, publicationId: r.publication_id,
      versionNumber: Number(r.version_number), status: r.status,
      title: r.title, headline: str(r.headline), overview: str(r.overview),
      market: str(r.market), submarket: str(r.submarket), city: str(r.city), country: str(r.country),
      assetType: str(r.asset_type), strategy: str(r.strategy), currency: r.currency,
      headlinePrice: num(r.headline_price), targetNiy: num(r.target_niy), targetIrr: num(r.target_irr),
      targetEquityMultiple: num(r.target_equity_multiple), holdPeriodYears: num(r.hold_period_years),
      sizeSqft: num(r.size_sqft), sizeSqm: num(r.size_sqm),
      highlights: Array.isArray(r.highlights) ? (r.highlights as string[]) : [],
      createdAt: r.created_at, submittedAt: r.submitted_at ?? null,
      publishedAt: r.published_at ?? null, supersededAt: r.superseded_at ?? null,
    };
  });
}

// ============================================================================
// New draft from an existing version (the "edit a published publication" path)
// ----------------------------------------------------------------------------
// A published version is immutable, so editing means: copy its content into a
// fresh draft version and edit that. The copy carries the SOURCE FINGERPRINT of
// the version it came from — the content still describes that captured
// snapshot, so drift keeps being reported honestly rather than being silently
// reset. Refreshing from the internal opportunity is a separate, explicit
// action (createPublicationFromOpportunity), never a side effect.
// ============================================================================
export async function createDraftFromVersion(
  session: Session, sourceVersionId: string,
  options: { copyDocuments?: boolean } = {}, actorUserId?: string | null,
): Promise<{ versionId: string; versionNumber: number }> {
  return withSession(session, (tx) =>
    createDraftFromVersionOn(tx, sourceVersionId, options, actorUserId ?? null));
}

export async function createDraftFromVersionOn(
  tx: Queryable, sourceVersionId: string,
  options: { copyDocuments?: boolean } = {}, actorUserId: string | null = null,
): Promise<{ versionId: string; versionNumber: number }> {
  const source = await tx.query<{ publication_id: string }>(
    "select publication_id from publication_versions where version_id = $1", [sourceVersionId]);
  if (!source.rows[0]) {
    throw new Error(`Publication version ${sourceVersionId} not found, or not readable by this session`);
  }
  const publicationId = source.rows[0].publication_id;

  const open = await tx.query<{ version_id: string; status: string }>(
    `select version_id, status from publication_versions
      where publication_id = $1 and status in ('draft', 'in_review')`, [publicationId]);
  if (open.rows[0]) {
    throw new Error(
      open.rows[0].status === "draft"
        ? "This publication already has an open draft — edit that draft instead of starting another."
        : "This publication has a version in review — return it to draft or publish it first.");
  }

  const { rows } = await tx.query<{ version_id: string; version_number: number }>(
    `insert into publication_versions
       (publication_id, version_number, status, created_by,
        title, headline, overview, market, submarket, city, country, asset_type, strategy,
        currency, headline_price, target_niy, target_irr, target_equity_multiple,
        hold_period_years, size_sqft, size_sqm, highlights)
     select publication_id,
            (select coalesce(max(version_number), 0) + 1 from publication_versions
              where publication_id = $2),
            'draft', $3,
            title, headline, overview, market, submarket, city, country, asset_type, strategy,
            currency, headline_price, target_niy, target_irr, target_equity_multiple,
            hold_period_years, size_sqft, size_sqm, highlights
       from publication_versions where version_id = $1
     returning version_id, version_number`,
    [sourceVersionId, publicationId, actorUserId]);
  const created = rows[0];

  // The draft still describes the snapshot the source version captured.
  await tx.query(
    `insert into publication_version_sources(version_id, source_fingerprint, source_captured_at)
     select $1, source_fingerprint, source_captured_at
       from publication_version_sources where version_id = $2`,
    [created.version_id, sourceVersionId]);

  if (options.copyDocuments !== false) {
    await tx.query(
      `insert into publication_documents
         (version_id, title, category, storage_path, file_name, mime_type, size_bytes,
          access_level, sort_order, created_by)
       select $1, title, category, storage_path, file_name, mime_type, size_bytes,
              access_level, sort_order, $3
         from publication_documents where version_id = $2`,
      [created.version_id, sourceVersionId, actorUserId]);
  }

  return { versionId: created.version_id, versionNumber: Number(created.version_number) };
}

/**
 * Guard shared by both "new draft" paths: a publication works on one editable
 * version at a time, so the screens stay unambiguous about what is being edited.
 */
export async function assertNoOpenVersion(session: Session, publicationId: string): Promise<void> {
  await withSession(session, async (tx) => {
    const { rows } = await tx.query<{ status: string }>(
      `select status from publication_versions
        where publication_id = $1 and status in ('draft', 'in_review')`, [publicationId]);
    if (rows[0]) {
      throw new Error(
        rows[0].status === "draft"
          ? "This publication already has an open draft — edit that draft instead of starting another."
          : "This publication has a version in review — return it to draft or publish it first.");
    }
  });
}

/**
 * Update a document's metadata. P1 models documents as part of a version's
 * snapshot; the lifecycle trigger rejects this once the version is published.
 */
export async function updatePublicationDocument(
  session: Session, documentId: string,
  patch: { title?: string; category?: string; accessLevel?: string; sortOrder?: number },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const map: Record<string, string> = {
    title: "title", category: "category", accessLevel: "access_level", sortOrder: "sort_order",
  };
  for (const [key, column] of Object.entries(map)) {
    if (key in patch && (patch as Record<string, unknown>)[key] !== undefined) {
      params.push((patch as Record<string, unknown>)[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length === 0) return;
  params.push(documentId);
  await withSession(session, (tx) =>
    tx.query(`update publication_documents set ${sets.join(", ")}
              where document_id = $${params.length}`, params));
}

// ============================================================================
// Investor access to a publication
// ============================================================================
export interface PublicationEntitlementRow {
  entitlementId: string;
  investorOrgId: string;
  investorOrgName: string;
  investorOrgStatus: InvestorOrgStatus;
  isVisible: boolean;
  placement: Placement;
  sortOrder: number;
  investorNote: string | null;
  documentAccessLevel: EntitlementDocumentLevel;
  updatedAt: string;
}

export async function listEntitlementsForPublication(
  session: Session, publicationId: string,
): Promise<PublicationEntitlementRow[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `select e.*, o.name as org_name, o.status as org_status
         from publication_entitlements e
         join investor_organizations o on o.investor_org_id = e.investor_org_id
        where e.publication_id = $1
        order by o.name`,
      [publicationId]);
    return rows.map((r) => ({
      entitlementId: r.entitlement_id as string,
      investorOrgId: r.investor_org_id as string,
      investorOrgName: r.org_name as string,
      investorOrgStatus: r.org_status as InvestorOrgStatus,
      isVisible: bool(r.is_visible),
      placement: r.placement as Placement,
      sortOrder: Number(r.sort_order),
      investorNote: str(r.investor_note),
      documentAccessLevel: r.document_access_level as EntitlementDocumentLevel,
      updatedAt: r.updated_at as string,
    }));
  });
}

/** Persist a new ordering for an organisation's secondary opportunities. */
export async function reorderSecondaryEntitlements(
  session: Session, investorOrgId: string, orderedEntitlementIds: string[],
): Promise<void> {
  await withSession(session, async (tx) => {
    for (let i = 0; i < orderedEntitlementIds.length; i++) {
      await tx.query(
        `update publication_entitlements set sort_order = $1
          where entitlement_id = $2 and investor_org_id = $3 and placement = 'secondary'`,
        [i, orderedEntitlementIds[i], investorOrgId]);
    }
  });
}

// ============================================================================
// Creating a publication — eligible internal opportunities
// ============================================================================
export interface EligibleOpportunity {
  opportunityId: string;
  name: string;
  city: string | null;
  market: string | null;
  assetType: string | null;
  strategy: string | null;
  stage: string;
}

/** Active internal opportunities that do not have a publication yet. */
export async function listEligibleOpportunities(session: Session): Promise<EligibleOpportunity[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(`
      select o.opportunity_id, o.name, pr.city, o.market, o.asset_type, o.strategy, o.stage
        from opportunities o
        left join properties pr on pr.property_id = o.property_id
       where o.status = 'active'
         and not exists (select 1 from publication_sources ps
                          where ps.opportunity_id = o.opportunity_id)
       order by o.name
    `);
    return rows.map((r) => ({
      opportunityId: r.opportunity_id as string,
      name: r.name as string,
      city: str(r.city),
      market: str(r.market),
      assetType: str(r.asset_type),
      strategy: str(r.strategy),
      stage: r.stage as string,
    }));
  });
}

/** The publication already linked to an internal opportunity, if any. */
export async function getPublicationForOpportunity(
  session: Session, opportunityId: string,
): Promise<string | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ publication_id: string }>(
      "select publication_id from publication_sources where opportunity_id = $1", [opportunityId]);
    return rows[0]?.publication_id ?? null;
  });
}

/** Options for the "assign publication" picker on an investor page. */
export interface PublicationOption {
  publicationId: string;
  title: string;
  status: PublicationStatus;
}

export async function listPublicationOptions(session: Session): Promise<PublicationOption[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(`
      with latest as (
        select distinct on (publication_id) publication_id, title
          from publication_versions
         order by publication_id, version_number desc
      )
      select p.publication_id, p.status, coalesce(av.title, l.title, 'Untitled publication') as title
        from investor_publications p
        left join publication_versions av on av.version_id = p.active_version_id
        left join latest l on l.publication_id = p.publication_id
       order by title
    `);
    return rows.map((r) => ({
      publicationId: r.publication_id as string,
      title: r.title as string,
      status: r.status as PublicationStatus,
    }));
  });
}
