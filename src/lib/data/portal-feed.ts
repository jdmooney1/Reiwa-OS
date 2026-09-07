// ============================================================================
// Investor-facing reads (P4) — the ONLY data source the portal ever uses.
// ----------------------------------------------------------------------------
// Every function here runs inside withInvestorSession(), so the caller presents
// nothing but their Supabase Auth user id and the database decides the rest:
// `app.current_investor_contact_id()` resolves the contact, and the P1 policies
// on investor_feed / publication_documents / investor_saved decide every row.
// No entitlement, organisation id or document tier is ever accepted from the
// application, from the client, or from a function argument.
//
// The internal tables — opportunities, investment_cases, assets, business_plans,
// transactions, organizations — are not referenced anywhere in this file, and
// must not be. The investor projection carries no internal identifier to leak:
// `investor_feed` is built from the investor-readable tables alone, and the
// provenance tables (publication_sources, publication_version_sources) are
// joined by nothing here.
//
// SERVER-ONLY.
// ============================================================================
import { withInvestorSession, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";
import type {
  Placement, EntitlementDocumentLevel, DocumentCategory, RequestType,
} from "@/lib/data/investor-portal";
import type { Currency } from "@/types/database";

/** The approved, investor-visible shape of one opportunity. */
export interface PortalOpportunity {
  publicationId: string;
  versionId: string;
  placement: Placement;
  sortOrder: number;
  investorNote: string | null;
  documentAccessLevel: EntitlementDocumentLevel;
  title: string;
  headline: string | null;
  overview: string | null;
  market: string | null;
  submarket: string | null;
  city: string | null;
  country: string | null;
  assetType: string | null;
  strategy: string | null;
  currency: Currency;
  headlinePrice: number | null;
  targetNiy: number | null;
  targetIrr: number | null;
  targetEquityMultiple: number | null;
  holdPeriodYears: number | null;
  sizeSqft: number | null;
  sizeSqm: number | null;
  highlights: string[];
  publishedAt: string | null;
}

export interface PortalDocument {
  documentId: string;
  title: string;
  category: DocumentCategory;
  accessLevel: EntitlementDocumentLevel; // 'internal' can never arrive here
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

// Every column the investor projection exposes. `storage_path` is deliberately
// absent from the document projection below for the same reason: it is an
// internal delivery detail, not investor content.
const FEED_COLUMNS = `
  publication_id, version_id, placement, sort_order, investor_note,
  document_access_level, title, headline, overview, market, submarket, city,
  country, asset_type, strategy, currency, headline_price, target_niy,
  target_irr, target_equity_multiple, hold_period_years, size_sqft, size_sqm,
  highlights, published_at`;

interface FeedRow {
  publication_id: string; version_id: string; placement: string; sort_order: number;
  investor_note: string | null; document_access_level: string; title: string;
  headline: string | null; overview: string | null; market: string | null;
  submarket: string | null; city: string | null; country: string | null;
  asset_type: string | null; strategy: string | null; currency: string;
  headline_price: unknown; target_niy: unknown; target_irr: unknown;
  target_equity_multiple: unknown; hold_period_years: unknown;
  size_sqft: unknown; size_sqm: unknown; highlights: unknown; published_at: string | null;
}

function toOpportunity(r: FeedRow): PortalOpportunity {
  return {
    publicationId: r.publication_id,
    versionId: r.version_id,
    placement: r.placement as Placement,
    sortOrder: r.sort_order,
    investorNote: r.investor_note,
    documentAccessLevel: r.document_access_level as EntitlementDocumentLevel,
    title: r.title,
    headline: r.headline,
    overview: r.overview,
    market: r.market,
    submarket: r.submarket,
    city: r.city,
    country: r.country,
    assetType: r.asset_type,
    strategy: r.strategy,
    currency: (r.currency as Currency) ?? "GBP",
    headlinePrice: num(r.headline_price),
    targetNiy: num(r.target_niy),
    targetIrr: num(r.target_irr),
    targetEquityMultiple: num(r.target_equity_multiple),
    holdPeriodYears: num(r.hold_period_years),
    sizeSqft: num(r.size_sqft),
    sizeSqm: num(r.size_sqm),
    highlights: Array.isArray(r.highlights) ? (r.highlights as string[]).map(String) : [],
    publishedAt: str(r.published_at),
  };
}

// ---- Home feed -------------------------------------------------------------

export interface PortalFeed {
  featured: PortalOpportunity | null;
  secondary: PortalOpportunity[];
}

/**
 * Everything this investor may currently see, split by placement. A hidden or
 * revoked entitlement, a withdrawn publication and a publication whose only
 * version is still in review all resolve to nothing — the view's own WHERE
 * clause and the caller's RLS remove them before this code runs.
 */
export async function loadPortalFeed(authUserId: string): Promise<PortalFeed> {
  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<FeedRow>(
      `select ${FEED_COLUMNS} from investor_feed
        order by case placement when 'featured' then 0 else 1 end, sort_order, title`);
    return rows;
  });
  const all = rows.map(toOpportunity);
  return {
    featured: all.find((o) => o.placement === "featured") ?? null,
    secondary: all.filter((o) => o.placement === "secondary"),
  };
}

/**
 * One opportunity, or null when this investor may not see it. Passing another
 * organisation's publication id — or a withdrawn, hidden or unentitled one —
 * returns null rather than an error: the id is not a capability.
 */
export async function loadPortalOpportunity(
  authUserId: string, publicationId: string,
): Promise<PortalOpportunity | null> {
  if (!isUuid(publicationId)) return null;
  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<FeedRow>(
      `select ${FEED_COLUMNS} from investor_feed where publication_id = $1`, [publicationId]);
    return rows;
  });
  return rows[0] ? toOpportunity(rows[0]) : null;
}

/**
 * The documents on an opportunity's active version that this investor's tier
 * permits. `publication_documents_tiered` decides: a standard entitlement never
 * sees a diligence document, and `internal` is refused at every tier, so no
 * internal document's metadata can reach investor code by any path.
 */
export async function loadPortalDocuments(
  authUserId: string, versionId: string,
): Promise<PortalDocument[]> {
  if (!isUuid(versionId)) return [];
  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<{
      document_id: string; title: string; category: string; access_level: string;
      file_name: string | null; mime_type: string | null; size_bytes: unknown;
    }>(
      `select document_id, title, category, access_level, file_name, mime_type, size_bytes
         from publication_documents
        where version_id = $1
        order by sort_order, title`, [versionId]);
    return rows;
  });
  return rows.map((r) => ({
    documentId: r.document_id,
    title: r.title,
    category: r.category as DocumentCategory,
    accessLevel: r.access_level as EntitlementDocumentLevel,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: num(r.size_bytes),
  }));
}

/**
 * Resolve one document for download, under the investor's OWN row level
 * security — the single authorisation gate in front of Storage (P6).
 *
 * This one statement is the whole check, because `publication_documents_tiered`
 * already encodes every condition the product requires:
 *
 *   * identity      — app.current_investor_contact_id() from auth.uid();
 *   * active contact and active organisation — both resolved by that helper;
 *   * visible entitlement to the publication;
 *   * publication still `published`, version still the ACTIVE published one;
 *   * document tier at or below the entitlement's tier;
 *   * `internal` refused outright, at every tier.
 *
 * A revoked entitlement, a withdrawn publication, a superseded version, a
 * deactivated contact or a suspended organisation therefore all produce the
 * same answer — null — on the very next request, with no cache to invalidate.
 *
 * `storage_path` is read here and used only to mint a signed URL server-side.
 * It is never returned to a caller that could send it to a browser.
 */
export async function resolveDocumentDownload(
  authUserId: string, documentId: string,
): Promise<{ storagePath: string; fileName: string; mimeType: string | null;
             publicationId: string; versionId: string; title: string } | null> {
  if (!isUuid(documentId)) return null;
  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<{
      storage_path: string; file_name: string | null; mime_type: string | null;
      title: string; version_id: string; publication_id: string;
    }>(
      `select d.storage_path, d.file_name, d.mime_type, d.title,
              d.version_id, v.publication_id
         from publication_documents d
         join publication_versions v on v.version_id = d.version_id
        where d.document_id = $1`, [documentId]);
    return rows;
  });
  const r = rows[0];
  if (!r) return null;
  return {
    storagePath: r.storage_path,
    fileName: r.file_name ?? `${r.title}.pdf`,
    mimeType: r.mime_type,
    publicationId: r.publication_id,
    versionId: r.version_id,
    title: r.title,
  };
}

// ---- Saved -----------------------------------------------------------------

/**
 * This contact's saved opportunities. The join is against investor_feed, so an
 * opportunity whose entitlement is later hidden or revoked — or whose
 * publication is withdrawn — drops out of the list even though the saved row
 * still exists. Saved state is personal: `investor_saved_own_select` restricts
 * it to the current contact, never the organisation.
 */
export async function loadSavedOpportunities(authUserId: string): Promise<PortalOpportunity[]> {
  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<FeedRow & { saved_at: string }>(
      `select ${FEED_COLUMNS.split(",").map((c) => `f.${c.trim()}`).join(", ")}, s.created_at as saved_at
         from investor_saved s
         join investor_feed f on f.publication_id = s.publication_id
        order by s.created_at desc`);
    return rows;
  });
  return rows.map(toOpportunity);
}

/** The publication ids this contact has saved (for save-state on cards). */
export async function loadSavedIds(authUserId: string): Promise<string[]> {
  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<{ publication_id: string }>(
      "select publication_id from investor_saved");
    return rows;
  });
  return rows.map((r) => r.publication_id);
}

// ---- Compare ---------------------------------------------------------------

export { COMPARE_LIMIT } from "@/lib/portal/constants";
import { COMPARE_LIMIT } from "@/lib/portal/constants";

/**
 * The comparison set for a list of publication ids supplied by the client.
 * The ids are a *request*, never an authorisation: the list is de-duplicated,
 * capped at COMPARE_LIMIT and then resolved through investor_feed, so anything
 * this investor is not currently entitled to simply does not come back. Order
 * follows the order asked for, minus whatever was dropped.
 */
export async function loadComparison(
  authUserId: string, publicationIds: string[],
): Promise<PortalOpportunity[]> {
  const wanted = [...new Set(publicationIds.filter(isUuid))].slice(0, COMPARE_LIMIT);
  if (wanted.length === 0) return [];
  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<FeedRow>(
      `select ${FEED_COLUMNS} from investor_feed where publication_id = any($1::uuid[])`, [wanted]);
    return rows;
  });
  const byId = new Map(rows.map((r) => [r.publication_id, toOpportunity(r)]));
  return wanted.map((id) => byId.get(id)).filter((o): o is PortalOpportunity => Boolean(o));
}

// ---- Requests --------------------------------------------------------------

export interface PortalRequest {
  requestId: string;
  publicationId: string | null;
  requestType: RequestType;
  message: string | null;
  createdAt: string;
}

/** This contact's own submitted requests for one opportunity, newest first. */
export async function loadRequestsForPublication(
  authUserId: string, publicationId: string,
): Promise<PortalRequest[]> {
  if (!isUuid(publicationId)) return [];
  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<{
      request_id: string; publication_id: string | null; request_type: string;
      message: string | null; created_at: string;
    }>(
      `select request_id, publication_id, request_type, message, created_at
         from investor_requests where publication_id = $1 order by created_at desc`,
      [publicationId]);
    return rows;
  });
  return rows.map((r) => ({
    requestId: r.request_id,
    publicationId: r.publication_id,
    requestType: r.request_type as RequestType,
    message: r.message,
    createdAt: r.created_at,
  }));
}

// ---- Writes (all RLS-gated; the policies re-check entitlement) -------------

/**
 * Save an opportunity for this contact. `investor_saved_own_insert` carries
 * `app.investor_can_read_publication(publication_id)` in its WITH CHECK, so a
 * publication the investor cannot currently read cannot be saved even if the id
 * is guessed. Saving twice is a no-op rather than an error.
 */
export async function saveOpportunity(authUserId: string, publicationId: string): Promise<boolean> {
  if (!isUuid(publicationId)) return false;
  try {
    return await withInvestorSession(authUserId, async (tx) => {
      const { rows } = await tx.query<{ saved_id: string }>(
        `insert into investor_saved(investor_contact_id, publication_id)
         values (app.current_investor_contact_id(), $1)
         on conflict (investor_contact_id, publication_id) do nothing
         returning saved_id`, [publicationId]);
      return rows.length > 0;
    });
  } catch (e) {
    // The policy refused it: not an error the investor caused or can fix, and
    // not something to surface as a failure — nothing was saved, and that is
    // the whole answer.
    if (isPolicyRefusal(e)) return false;
    throw e;
  }
}

export async function unsaveOpportunity(authUserId: string, publicationId: string): Promise<boolean> {
  if (!isUuid(publicationId)) return false;
  return withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<{ saved_id: string }>(
      "delete from investor_saved where publication_id = $1 returning saved_id", [publicationId]);
    return rows.length > 0;
  });
}

/**
 * Submit a request against an entitled publication. The WITH CHECK on
 * `investor_requests_own_insert` binds the row to the caller's own contact and
 * organisation and re-tests entitlement, so a forged publication id is rejected
 * by the database rather than by this code.
 */
export async function submitRequest(
  authUserId: string, publicationId: string, requestType: RequestType, message: string | null,
): Promise<string | null> {
  if (!isUuid(publicationId)) return null;
  const trimmed = message?.trim() ? message.trim().slice(0, 2000) : null;
  try {
    return await withInvestorSession(authUserId, async (tx) => {
      const { rows } = await tx.query<{ request_id: string }>(
        `insert into investor_requests(
           investor_contact_id, investor_org_id, publication_id, request_type, message)
         values (app.current_investor_contact_id(), app.current_investor_org_id(), $1, $2, $3)
         returning request_id`, [publicationId, requestType, trimmed]);
      return rows[0]?.request_id ?? null;
    });
  } catch (e) {
    // A forged or revoked publication id is refused by the policy. The caller
    // turns a null into the investor-facing message; nothing was written.
    if (isPolicyRefusal(e)) return null;
    throw e;
  }
}

/**
 * True when PostgreSQL refused the write because of a row level security
 * policy (SQLSTATE 42501). Distinguished from every other failure so a genuine
 * fault still surfaces rather than being reported as a polite refusal.
 */
function isPolicyRefusal(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "42501";
}

// ---- Activity --------------------------------------------------------------
// Factual events only (P1's enumerated list). P5 owns the engagement layer;
// nothing here derives a score, a duration or an inferred preference.

export type PortalEventType =
  | "login" | "opportunity_viewed" | "saved" | "unsaved" | "compared"
  | "document_viewed" | "document_downloaded" | "information_requested";

/**
 * Record one factual event. Never throws: an activity write failing must not
 * take a page or an action down with it, and the event carries no meaning the
 * product depends on.
 */
export async function recordPortalEvent(
  authUserId: string, eventType: PortalEventType,
  opts: { publicationId?: string | null; versionId?: string | null; context?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await withInvestorSession(authUserId, async (tx: Queryable) => {
      await tx.query(
        `insert into investor_activity_events(
           investor_contact_id, investor_org_id, event_type, publication_id, version_id, context)
         values (app.current_investor_contact_id(), app.current_investor_org_id(), $1, $2, $3, $4)`,
        [eventType,
         opts.publicationId && isUuid(opts.publicationId) ? opts.publicationId : null,
         opts.versionId && isUuid(opts.versionId) ? opts.versionId : null,
         JSON.stringify(opts.context ?? {})]);
    });
  } catch {
    // Deliberately swallowed — see above.
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Keeps a malformed path segment out of a uuid parameter (a 22P02 error). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
