// ============================================================================
// Investment Portal — server-side administration data layer (P1).
// ----------------------------------------------------------------------------
// Everything a future P2 admin screen needs to run the portal: investor
// organisations and contacts, publications and their versions, documents, and
// entitlements. No screens are built on it yet.
//
// Every call runs inside withSession(), so the caller's own RLS decides what it
// may touch — these functions hold no privilege of their own and never reach for
// the privileged connection. The portal write policies require app.is_admin().
//
// The INVESTOR read path is not here. Investors read through
// withInvestorSession() and the policies in migration 0005; nothing in this
// module is reachable from a portal session.
//
// Provenance — which internal opportunity a publication came from, and the
// digest its draft was taken at — lives in the admin-only `publication_sources`
// and `publication_version_sources` tables, never on an investor-readable row.
// The prefill and drift functions below are the only things that read it.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str, bool } from "@/lib/data/coerce";

// ---- Types -----------------------------------------------------------------
export type InvestorOrgStatus = "active" | "suspended" | "closed";
export type PublicationStatus = "draft" | "published" | "withdrawn";
export type VersionStatus = "draft" | "in_review" | "published" | "superseded";
export type Placement = "featured" | "secondary";
/** What an entitlement may grant. `internal` is deliberately not a member. */
export type EntitlementDocumentLevel = "standard" | "diligence";
/** What a document may be classified as. `internal` never reaches an investor. */
export type DocumentAccessLevel = EntitlementDocumentLevel | "internal";
export type DocumentCategory =
  | "teaser" | "financials" | "legal" | "technical" | "esg" | "data_room" | "other";
export type RequestType = "information" | "meeting" | "diligence_access" | "other";
export type RequestStatus = "new" | "acknowledged" | "in_progress" | "closed";

export interface InvestorOrganization {
  investorOrgId: string;
  name: string;
  status: InvestorOrgStatus;
  linkedInternalOrganizationId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvestorContact {
  investorContactId: string;
  investorOrgId: string;
  email: string;
  name: string;
  title: string | null;
  isActive: boolean;
  authUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationVersion {
  versionId: string;
  publicationId: string;
  versionNumber: number;
  status: VersionStatus;
  title: string;
  headline: string | null;
  overview: string | null;
  market: string | null;
  submarket: string | null;
  city: string | null;
  country: string | null;
  assetType: string | null;
  strategy: string | null;
  currency: string;
  headlinePrice: number | null;
  targetNiy: number | null;
  targetIrr: number | null;
  targetEquityMultiple: number | null;
  holdPeriodYears: number | null;
  sizeSqft: number | null;
  sizeSqm: number | null;
  highlights: string[];
  createdAt: string;
  submittedAt: string | null;
  publishedAt: string | null;
  supersededAt: string | null;
}

export interface Publication {
  publicationId: string;
  status: PublicationStatus;
  activeVersionId: string | null;
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationDocument {
  documentId: string;
  versionId: string;
  title: string;
  category: DocumentCategory;
  storagePath: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  accessLevel: DocumentAccessLevel;
  sortOrder: number;
  createdAt: string;
}

export interface Entitlement {
  entitlementId: string;
  investorOrgId: string;
  publicationId: string;
  isVisible: boolean;
  placement: Placement;
  sortOrder: number;
  investorNote: string | null;
  documentAccessLevel: EntitlementDocumentLevel;
  createdAt: string;
  updatedAt: string;
}

/**
 * The private mapping back to internal Reiwa OS. Readable by Reiwa admins only,
 * and stored on no investor-readable row — see publication_sources and
 * publication_version_sources in migration 0005.
 */
export interface PublicationProvenance {
  publicationId: string;
  opportunityId: string;
  linkedAt: string;
}

export interface VersionProvenance {
  versionId: string;
  sourceFingerprint: string;
  sourceCapturedAt: string;
}

// ---- Row mappers -----------------------------------------------------------
function mapOrg(r: Record<string, any>): InvestorOrganization {
  return {
    investorOrgId: r.investor_org_id, name: r.name, status: r.status,
    linkedInternalOrganizationId: r.linked_internal_organization_id ?? null,
    notes: str(r.notes), createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function mapContact(r: Record<string, any>): InvestorContact {
  return {
    investorContactId: r.investor_contact_id, investorOrgId: r.investor_org_id,
    email: r.email, name: r.name, title: str(r.title), isActive: bool(r.is_active),
    authUserId: r.auth_user_id ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function mapVersion(r: Record<string, any>): PublicationVersion {
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
}

function mapPublication(r: Record<string, any>): Publication {
  return {
    publicationId: r.publication_id, status: r.status,
    activeVersionId: r.active_version_id ?? null,
    firstPublishedAt: r.first_published_at ?? null, lastPublishedAt: r.last_published_at ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function mapDocument(r: Record<string, any>): PublicationDocument {
  return {
    documentId: r.document_id, versionId: r.version_id, title: r.title, category: r.category,
    storagePath: r.storage_path, fileName: str(r.file_name), mimeType: str(r.mime_type),
    sizeBytes: num(r.size_bytes), accessLevel: r.access_level,
    sortOrder: Number(r.sort_order), createdAt: r.created_at,
  };
}

function mapEntitlement(r: Record<string, any>): Entitlement {
  return {
    entitlementId: r.entitlement_id, investorOrgId: r.investor_org_id,
    publicationId: r.publication_id, isVisible: bool(r.is_visible), placement: r.placement,
    sortOrder: Number(r.sort_order), investorNote: str(r.investor_note),
    documentAccessLevel: r.document_access_level,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Build a `set` clause from a camelCase patch and an allow-list of columns. */
function assignments(
  allowed: Record<string, string>, patch: Record<string, unknown>, params: unknown[],
): string[] {
  const sets: string[] = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (key in patch) {
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  return sets;
}

// ============================================================================
// Investor organisations & contacts
// ============================================================================
export interface NewInvestorOrganization {
  name: string;
  status?: InvestorOrgStatus;
  /** Reference only — recording it grants no permission anywhere. */
  linkedInternalOrganizationId?: string | null;
  notes?: string | null;
}

export async function createInvestorOrganization(
  session: Session, input: NewInvestorOrganization,
): Promise<string> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ investor_org_id: string }>(
      `insert into investor_organizations(name, status, linked_internal_organization_id, notes)
       values ($1,$2,$3,$4) returning investor_org_id`,
      [input.name, input.status ?? "active", input.linkedInternalOrganizationId ?? null,
       input.notes ?? null]);
    return rows[0].investor_org_id;
  });
}

const ORG_EDITABLE: Record<string, string> = {
  name: "name",
  status: "status",
  linkedInternalOrganizationId: "linked_internal_organization_id",
  notes: "notes",
};

export async function updateInvestorOrganization(
  session: Session, investorOrgId: string, patch: Record<string, unknown>,
): Promise<void> {
  const params: unknown[] = [];
  const sets = assignments(ORG_EDITABLE, patch, params);
  if (sets.length === 0) return;
  params.push(investorOrgId);
  await withSession(session, (tx) =>
    tx.query(`update investor_organizations set ${sets.join(", ")}
              where investor_org_id = $${params.length}`, params));
}

export async function listInvestorOrganizations(session: Session): Promise<InvestorOrganization[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query("select * from investor_organizations order by name");
    return rows.map(mapOrg);
  });
}

export interface NewInvestorContact {
  investorOrgId: string;
  email: string;
  name: string;
  title?: string | null;
  /** The Supabase Auth user id. Until it is set the contact cannot sign in. */
  authUserId?: string | null;
  isActive?: boolean;
}

export async function createInvestorContact(
  session: Session, input: NewInvestorContact,
): Promise<string> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ investor_contact_id: string }>(
      `insert into investor_contacts(investor_org_id, email, name, title, auth_user_id, is_active)
       values ($1,$2,$3,$4,$5,$6) returning investor_contact_id`,
      [input.investorOrgId, input.email.trim(), input.name, input.title ?? null,
       input.authUserId ?? null, input.isActive ?? true]);
    return rows[0].investor_contact_id;
  });
}

const CONTACT_EDITABLE: Record<string, string> = {
  name: "name",
  email: "email",
  title: "title",
  isActive: "is_active",
  authUserId: "auth_user_id",
  investorOrgId: "investor_org_id",
};

export async function updateInvestorContact(
  session: Session, investorContactId: string, patch: Record<string, unknown>,
): Promise<void> {
  const params: unknown[] = [];
  const sets = assignments(CONTACT_EDITABLE, patch, params);
  if (sets.length === 0) return;
  params.push(investorContactId);
  await withSession(session, (tx) =>
    tx.query(`update investor_contacts set ${sets.join(", ")}
              where investor_contact_id = $${params.length}`, params));
}

export async function listInvestorContacts(
  session: Session, investorOrgId?: string,
): Promise<InvestorContact[]> {
  return withSession(session, async (tx) => {
    const { rows } = investorOrgId
      ? await tx.query("select * from investor_contacts where investor_org_id = $1 order by name",
                       [investorOrgId])
      : await tx.query("select * from investor_contacts order by name");
    return rows.map(mapContact);
  });
}

// ============================================================================
// The publication boundary
// ----------------------------------------------------------------------------
// The whitelist itself lives in SQL (app.opportunity_publication_source) so that
// it is enforced at the boundary rather than by convention in the app. This map
// documents it in TypeScript and names the version column each approved field
// lands in; it is the only path by which internal data becomes investor data.
// ============================================================================
export const PUBLICATION_SOURCE_FIELDS = {
  title: "title",
  market: "market",
  submarket: "submarket",
  city: "city",
  country: "country",
  asset_type: "asset_type",
  strategy: "strategy",
  currency: "currency",
  headline_price: "headline_price",
  target_niy: "target_niy",
  target_irr: "target_irr",
  target_equity_multiple: "target_equity_multiple",
  size_sqft: "size_sqft",
  size_sqm: "size_sqm",
  overview: "overview",
} as const;

export type PublicationSourceField = keyof typeof PUBLICATION_SOURCE_FIELDS;

/** The approved projection of an internal opportunity, straight from the boundary. */
export async function readPublicationSource(
  session: Session, opportunityId: string,
): Promise<Record<string, unknown> | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ source: Record<string, unknown> | null }>(
      "select app.opportunity_publication_source($1) as source", [opportunityId]);
    return rows[0]?.source ?? null;
  });
}

const SOURCE_COLUMNS = Object.values(PUBLICATION_SOURCE_FIELDS);

/**
 * Prefill a NEW draft version from an internal opportunity, through the approved
 * whitelist and nothing else.
 *
 * This is a one-way copy. Once the draft exists it is an independent record:
 * later edits to the opportunity cannot reach it. The fingerprint captured here
 * is what lets a future admin screen warn that the internal record has moved on.
 *
 * Creates the publication identity on first call (one per opportunity) and a new
 * draft version on every call.
 */
export async function createPublicationFromOpportunity(
  session: Session, opportunityId: string, actorUserId?: string | null,
): Promise<{ publicationId: string; versionId: string; versionNumber: number }> {
  return withSession(session, async (tx) => {
    const publicationId = await ensurePublication(tx, opportunityId, actorUserId ?? null);
    const created = await insertDraftFromSource(tx, publicationId, opportunityId, actorUserId ?? null);
    return { publicationId, ...created };
  });
}

/**
 * Find (or create) the publication identity for an internal opportunity. The
 * relationship is looked up through the private mapping — it is not stored on
 * the publication row, and `publication_sources.opportunity_id` being unique is
 * what still guarantees one publication identity per opportunity.
 */
async function ensurePublication(
  tx: Queryable, opportunityId: string, actorUserId: string | null,
): Promise<string> {
  const existing = await tx.query<{ publication_id: string }>(
    "select publication_id from publication_sources where opportunity_id = $1", [opportunityId]);
  if (existing.rows[0]) return existing.rows[0].publication_id;

  const inserted = await tx.query<{ publication_id: string }>(
    `insert into investor_publications(status, created_by)
     values ('draft',$1) returning publication_id`,
    [actorUserId]);
  if (!inserted.rows[0]) {
    throw new Error(`Could not create a publication for opportunity ${opportunityId}`);
  }
  const publicationId = inserted.rows[0].publication_id;
  await tx.query(
    "insert into publication_sources(publication_id, opportunity_id, linked_by) values ($1,$2,$3)",
    [publicationId, opportunityId, actorUserId]);
  return publicationId;
}

async function insertDraftFromSource(
  tx: Queryable, publicationId: string, opportunityId: string, actorUserId: string | null,
): Promise<{ versionId: string; versionNumber: number }> {
  // The whitelist is applied by the database function; the app never selects
  // columns from `opportunities` for investor-facing use.
  const source = await tx.query<{ source: Record<string, unknown> | null; fingerprint: string | null }>(
    `select app.opportunity_publication_source($1) as source,
            app.opportunity_publication_fingerprint($1) as fingerprint`,
    [opportunityId]);
  const projection = source.rows[0]?.source;
  if (!projection) {
    throw new Error(`Opportunity ${opportunityId} is not readable, so it cannot be published`);
  }

  const values: unknown[] = [publicationId, actorUserId];
  const columns: string[] = [];
  const placeholders: string[] = [];
  for (const column of SOURCE_COLUMNS) {
    if (!(column in projection)) continue; // jsonb_strip_nulls drops empty fields
    values.push(projection[column]);
    columns.push(column);
    placeholders.push(`$${values.length}`);
  }
  // `title` is not null: fall back to the publication reference if the source
  // opportunity somehow has no name.
  if (!columns.includes("title")) {
    values.push("Untitled opportunity");
    columns.push("title");
    placeholders.push(`$${values.length}`);
  }

  const { rows } = await tx.query<{ version_id: string; version_number: number }>(
    `insert into publication_versions
       (publication_id, created_by, version_number, status${columns.length ? ", " + columns.join(", ") : ""})
     values
       ($1, $2,
        (select coalesce(max(version_number), 0) + 1 from publication_versions where publication_id = $1),
        'draft'${placeholders.length ? ", " + placeholders.join(", ") : ""})
     returning version_id, version_number`,
    values);

  // Provenance is recorded privately, never on the version row itself.
  await tx.query(
    "insert into publication_version_sources(version_id, source_fingerprint) values ($1,$2)",
    [rows[0].version_id, source.rows[0].fingerprint]);

  return { versionId: rows[0].version_id, versionNumber: Number(rows[0].version_number) };
}

/**
 * Has the internal opportunity changed since this version's draft was taken?
 * Compares the privately stored fingerprint with the boundary's current digest,
 * resolving the opportunity through the private mapping. The answer is advisory:
 * nothing is copied and the publication is not modified.
 *
 * An investor cannot reach any part of this: the two provenance tables are
 * admin-only, so the query returns no row for them at all.
 */
export async function publicationSourceDrift(
  session: Session, versionId: string,
): Promise<{ changed: boolean; capturedFingerprint: string | null; currentFingerprint: string | null }> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ captured: string | null; current: string | null }>(
      `select vs.source_fingerprint as captured,
              app.opportunity_publication_fingerprint(ps.opportunity_id) as current
         from publication_versions v
         join publication_sources ps on ps.publication_id = v.publication_id
         left join publication_version_sources vs on vs.version_id = v.version_id
        where v.version_id = $1`,
      [versionId]);
    const row = rows[0];
    if (!row) throw new Error(`No provenance recorded for publication version ${versionId}`);
    return {
      changed: row.captured !== row.current,
      capturedFingerprint: row.captured,
      currentFingerprint: row.current,
    };
  });
}

/** The internal opportunity behind a publication. Admin-only, by RLS. */
export async function getPublicationProvenance(
  session: Session, publicationId: string,
): Promise<PublicationProvenance | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{
      publication_id: string; opportunity_id: string; linked_at: string;
    }>("select publication_id, opportunity_id, linked_at from publication_sources where publication_id = $1",
       [publicationId]);
    return rows[0]
      ? {
          publicationId: rows[0].publication_id,
          opportunityId: rows[0].opportunity_id,
          linkedAt: rows[0].linked_at,
        }
      : null;
  });
}

/** What a version's draft was taken from, and when. Admin-only, by RLS. */
export async function getVersionProvenance(
  session: Session, versionId: string,
): Promise<VersionProvenance | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{
      version_id: string; source_fingerprint: string; source_captured_at: string;
    }>(`select version_id, source_fingerprint, source_captured_at
          from publication_version_sources where version_id = $1`, [versionId]);
    return rows[0]
      ? {
          versionId: rows[0].version_id,
          sourceFingerprint: rows[0].source_fingerprint,
          sourceCapturedAt: rows[0].source_captured_at,
        }
      : null;
  });
}

// ============================================================================
// Version lifecycle
// ============================================================================
const VERSION_EDITABLE: Record<string, string> = {
  title: "title",
  headline: "headline",
  overview: "overview",
  market: "market",
  submarket: "submarket",
  city: "city",
  country: "country",
  assetType: "asset_type",
  strategy: "strategy",
  currency: "currency",
  headlinePrice: "headline_price",
  targetNiy: "target_niy",
  targetIrr: "target_irr",
  targetEquityMultiple: "target_equity_multiple",
  holdPeriodYears: "hold_period_years",
  sizeSqft: "size_sqft",
  sizeSqm: "size_sqm",
  highlights: "highlights",
};

/**
 * Edit a draft. Content is frozen once a version is submitted for review and the
 * whole row is frozen once published — both enforced by trigger, so this guard
 * is a courtesy, not the control.
 */
export async function updateDraftVersion(
  session: Session, versionId: string, patch: Record<string, unknown>,
): Promise<void> {
  // `highlights` is jsonb: send JSON text, not a Postgres array literal.
  const normalised = "highlights" in patch
    ? { ...patch, highlights: JSON.stringify(patch.highlights ?? []) }
    : patch;
  const params: unknown[] = [];
  const sets = assignments(VERSION_EDITABLE, normalised, params);
  if (sets.length === 0) return;
  params.push(versionId);
  await withSession(session, (tx) =>
    tx.query(`update publication_versions set ${sets.join(", ")}
              where version_id = $${params.length} and status = 'draft'`, params));
}

export async function submitVersionForReview(
  session: Session, versionId: string, actorUserId?: string | null,
): Promise<void> {
  await withSession(session, async (tx) => {
    const { rows } = await tx.query<{ version_id: string }>(
      `update publication_versions
          set status = 'in_review', submitted_at = now(), submitted_by = $2
        where version_id = $1 and status = 'draft'
        returning version_id`,
      [versionId, actorUserId ?? null]);
    if (!rows[0]) {
      throw new Error(`Publication version ${versionId} is not a draft and cannot be submitted`);
    }
  });
}

/** Return an in-review version to the author. */
export async function returnVersionToDraft(session: Session, versionId: string): Promise<void> {
  await withSession(session, (tx) =>
    tx.query(`update publication_versions set status = 'draft', submitted_at = null, submitted_by = null
              where version_id = $1 and status = 'in_review'`, [versionId]));
}

/**
 * Publish, inside a transaction the caller already owns.
 *
 * The supersede of the outgoing version and the repointing of the publication
 * are one unit of work: a publication is never briefly pointing at nothing or at
 * two live versions. Atomicity comes from the enclosing transaction, and the
 * `for update` locks make concurrent publishes serialise rather than race;
 * `publication_versions_single_published` makes the two-live-versions state
 * unrepresentable regardless.
 *
 * This is deliberately NOT a database function. A publication lifecycle function
 * would have to be granted to `authenticated` for the admin data layer to call
 * it — and `authenticated` is the role a portal investor authenticates on. As a
 * statement sequence it needs no EXECUTE grant at all, and each statement is
 * gated by the admin write policy on its own table.
 */
export async function publishVersionOn(
  tx: Queryable, versionId: string, actorUserId: string | null = null,
): Promise<string> {
  const version = await tx.query<{ publication_id: string; status: VersionStatus }>(
    "select publication_id, status from publication_versions where version_id = $1 for update",
    [versionId]);
  if (!version.rows[0]) {
    throw new Error(`Publication version ${versionId} not found, or not writable by this session`);
  }
  const { publication_id: publicationId, status } = version.rows[0];
  if (status !== "draft" && status !== "in_review") {
    throw new Error(`Publication version ${versionId} cannot be published from status ${status}`);
  }

  const publication = await tx.query<{ active_version_id: string | null }>(
    "select active_version_id from investor_publications where publication_id = $1 for update",
    [publicationId]);
  const previous = publication.rows[0]?.active_version_id ?? null;

  if (previous && previous !== versionId) {
    await tx.query(
      `update publication_versions set status = 'superseded', superseded_at = now()
        where version_id = $1 and status = 'published'`, [previous]);
  }
  await tx.query(
    `update publication_versions set status = 'published', published_at = now(), published_by = $2
      where version_id = $1`, [versionId, actorUserId]);
  await tx.query(
    `update investor_publications
        set status = 'published',
            active_version_id = $2,
            first_published_at = coalesce(first_published_at, now()),
            last_published_at = now()
      where publication_id = $1`, [publicationId, versionId]);

  return versionId;
}

/** Publish, in a transaction of its own, gated by the caller's RLS. */
export async function publishVersion(
  session: Session, versionId: string, actorUserId?: string | null,
): Promise<string> {
  return withSession(session, (tx) => publishVersionOn(tx, versionId, actorUserId ?? null));
}

/**
 * Withdraw the live version, inside a transaction the caller already owns. The
 * version is superseded and the pointer cleared together, so the publication
 * leaves every investor's portal at once.
 */
export async function supersedeActiveVersionOn(
  tx: Queryable, publicationId: string,
): Promise<string | null> {
  const publication = await tx.query<{ active_version_id: string | null }>(
    "select active_version_id from investor_publications where publication_id = $1 for update",
    [publicationId]);
  const previous = publication.rows[0]?.active_version_id ?? null;
  if (!previous) return null;

  await tx.query(
    `update publication_versions set status = 'superseded', superseded_at = now()
      where version_id = $1 and status = 'published'`, [previous]);
  await tx.query(
    "update investor_publications set status = 'withdrawn', active_version_id = null where publication_id = $1",
    [publicationId]);
  return previous;
}

/** Withdraw the live version, in a transaction of its own. */
export async function supersedeActiveVersion(
  session: Session, publicationId: string,
): Promise<string | null> {
  return withSession(session, (tx) => supersedeActiveVersionOn(tx, publicationId));
}

export async function listPublications(session: Session): Promise<Publication[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query("select * from investor_publications order by created_at desc");
    return rows.map(mapPublication);
  });
}

export async function getPublication(
  session: Session, publicationId: string,
): Promise<Publication | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      "select * from investor_publications where publication_id = $1", [publicationId]);
    return rows[0] ? mapPublication(rows[0]) : null;
  });
}

export async function listPublicationVersions(
  session: Session, publicationId: string,
): Promise<PublicationVersion[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      "select * from publication_versions where publication_id = $1 order by version_number desc",
      [publicationId]);
    return rows.map(mapVersion);
  });
}

// ============================================================================
// Documents
// ============================================================================
export interface NewPublicationDocument {
  versionId: string;
  title: string;
  category?: DocumentCategory;
  /** Private storage object path. Never handed to a browser directly. */
  storagePath: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  accessLevel?: DocumentAccessLevel;
  sortOrder?: number;
}

export async function addPublicationDocument(
  session: Session, input: NewPublicationDocument, actorUserId?: string | null,
): Promise<string> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ document_id: string }>(
      `insert into publication_documents
         (version_id, title, category, storage_path, file_name, mime_type, size_bytes,
          access_level, sort_order, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning document_id`,
      [input.versionId, input.title, input.category ?? "other", input.storagePath,
       input.fileName ?? null, input.mimeType ?? null, input.sizeBytes ?? null,
       input.accessLevel ?? "standard", input.sortOrder ?? 0, actorUserId ?? null]);
    return rows[0].document_id;
  });
}

export async function removePublicationDocument(session: Session, documentId: string): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("delete from publication_documents where document_id = $1", [documentId]));
}

export async function listPublicationDocuments(
  session: Session, versionId: string,
): Promise<PublicationDocument[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      "select * from publication_documents where version_id = $1 order by sort_order, title",
      [versionId]);
    return rows.map(mapDocument);
  });
}

// ============================================================================
// Entitlements
// ============================================================================
export interface EntitlementGrant {
  investorOrgId: string;
  publicationId: string;
  isVisible?: boolean;
  placement?: Placement;
  sortOrder?: number;
  investorNote?: string | null;
  documentAccessLevel?: EntitlementDocumentLevel;
}

/**
 * Grant (or re-grant) an entitlement. Default deny: unless `isVisible` is passed
 * the row exists but shows the investor nothing.
 */
export async function grantEntitlement(
  session: Session, input: EntitlementGrant, actorUserId?: string | null,
): Promise<string> {
  return withSession(session, async (tx) => {
    if (input.isVisible && input.placement === "featured") {
      await demoteFeatured(tx, input.investorOrgId, null);
    }
    const { rows } = await tx.query<{ entitlement_id: string }>(
      `insert into publication_entitlements
         (investor_org_id, publication_id, is_visible, placement, sort_order,
          investor_note, document_access_level, granted_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (investor_org_id, publication_id) do update
         set is_visible = excluded.is_visible,
             placement = excluded.placement,
             sort_order = excluded.sort_order,
             investor_note = excluded.investor_note,
             document_access_level = excluded.document_access_level
       returning entitlement_id`,
      [input.investorOrgId, input.publicationId, input.isVisible ?? false,
       input.placement ?? "secondary", input.sortOrder ?? 0, input.investorNote ?? null,
       input.documentAccessLevel ?? "standard", actorUserId ?? null]);
    return rows[0].entitlement_id;
  });
}

const ENTITLEMENT_EDITABLE: Record<string, string> = {
  isVisible: "is_visible",
  placement: "placement",
  sortOrder: "sort_order",
  investorNote: "investor_note",
  documentAccessLevel: "document_access_level",
};

export async function updateEntitlement(
  session: Session, entitlementId: string, patch: Record<string, unknown>,
): Promise<void> {
  const params: unknown[] = [];
  const sets = assignments(ENTITLEMENT_EDITABLE, patch, params);
  if (sets.length === 0) return;
  params.push(entitlementId);
  await withSession(session, async (tx) => {
    if (patch.placement === "featured" && patch.isVisible !== false) {
      const { rows } = await tx.query<{ investor_org_id: string }>(
        "select investor_org_id from publication_entitlements where entitlement_id = $1",
        [entitlementId]);
      if (rows[0]) await demoteFeatured(tx, rows[0].investor_org_id, entitlementId);
    }
    await tx.query(`update publication_entitlements set ${sets.join(", ")}
                    where entitlement_id = $${params.length}`, params);
  });
}

/**
 * Revoke access while keeping the record. The investor loses sight of the
 * publication on their next query — visibility is re-derived per statement.
 */
export async function revokeEntitlement(session: Session, entitlementId: string): Promise<void> {
  await withSession(session, (tx) =>
    tx.query(`update publication_entitlements set is_visible = false, placement = 'secondary'
              where entitlement_id = $1`, [entitlementId]));
}

/**
 * Place a publication in an investor's portal. Assigning `featured` demotes the
 * organisation's current featured entitlement in the same transaction — the
 * database enforces the one-featured rule regardless (a partial unique index),
 * this just makes the assignment usable from an admin screen.
 */
export async function setEntitlementPlacement(
  session: Session, entitlementId: string, placement: Placement, sortOrder?: number,
): Promise<void> {
  await withSession(session, async (tx) => {
    const { rows } = await tx.query<{ investor_org_id: string }>(
      "select investor_org_id from publication_entitlements where entitlement_id = $1",
      [entitlementId]);
    if (!rows[0]) throw new Error(`Entitlement ${entitlementId} not found`);
    if (placement === "featured") await demoteFeatured(tx, rows[0].investor_org_id, entitlementId);
    await tx.query(
      `update publication_entitlements set placement = $2, sort_order = coalesce($3, sort_order)
       where entitlement_id = $1`,
      [entitlementId, placement, sortOrder ?? null]);
  });
}

/** Step the organisation's current featured entitlement down to secondary. */
async function demoteFeatured(tx: Queryable, investorOrgId: string, keep: string | null): Promise<void> {
  await tx.query(
    `update publication_entitlements set placement = 'secondary'
      where investor_org_id = $1 and placement = 'featured' and is_visible
        and ($2::uuid is null or entitlement_id <> $2)`,
    [investorOrgId, keep]);
}

export async function listEntitlements(
  session: Session, investorOrgId: string,
): Promise<Entitlement[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `select * from publication_entitlements where investor_org_id = $1
       order by placement, sort_order`, [investorOrgId]);
    return rows.map(mapEntitlement);
  });
}

export interface AssignedPublication {
  entitlement: Entitlement;
  publication: Publication;
  activeVersion: PublicationVersion | null;
}

/** What an investor organisation is assigned — the admin's view of their portal. */
export async function listPublicationsForInvestorOrg(
  session: Session, investorOrgId: string,
): Promise<AssignedPublication[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `select row_to_json(e) as entitlement, row_to_json(p) as publication, row_to_json(v) as version
         from publication_entitlements e
         join investor_publications p on p.publication_id = e.publication_id
         left join publication_versions v on v.version_id = p.active_version_id
        where e.investor_org_id = $1
        order by e.placement, e.sort_order`,
      [investorOrgId]);
    return rows.map((r) => ({
      entitlement: mapEntitlement(r.entitlement as Record<string, unknown>),
      publication: mapPublication(r.publication as Record<string, unknown>),
      activeVersion: r.version ? mapVersion(r.version as Record<string, unknown>) : null,
    }));
  });
}

// ============================================================================
// Requests (admin triage side)
// ============================================================================
export interface InvestorRequestRecord {
  requestId: string;
  investorContactId: string;
  investorOrgId: string;
  publicationId: string | null;
  requestType: RequestType;
  message: string | null;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
}

export async function listInvestorRequests(session: Session): Promise<InvestorRequestRecord[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, string | null>>(
      "select * from investor_requests order by created_at desc");
    return rows.map((r) => ({
      requestId: r.request_id as string,
      investorContactId: r.investor_contact_id as string,
      investorOrgId: r.investor_org_id as string,
      publicationId: r.publication_id ?? null,
      requestType: r.request_type as RequestType,
      message: str(r.message),
      status: r.status as RequestStatus,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  });
}

export async function setInvestorRequestStatus(
  session: Session, requestId: string, status: RequestStatus, actorUserId?: string | null,
): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("update investor_requests set status = $2, handled_by = $3 where request_id = $1",
             [requestId, status, actorUserId ?? null]));
}
