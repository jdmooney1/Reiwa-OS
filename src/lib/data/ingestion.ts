// ============================================================================
// Deal Inbox data layer — batches, items, matching, promotion.
// ----------------------------------------------------------------------------
// Nothing in this module writes to `opportunities` except promoteItem(), and
// promoteItem() only ever runs because a human pressed a button. That is the
// whole architecture: parse and score in staging, decide in the review queue,
// commit on approval.
//
// Every call runs under withSession, so RLS enforces org isolation and write
// scope. There is no investor policy on any of these tables at all.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";
import { resolveProperty, rankCandidates } from "@/lib/data/properties";
import { recordEvent, priceChangeEvent } from "@/lib/data/property-events";
import type { ColumnMapping } from "@/lib/ingestion/mapping";
import type { ExtractedRow } from "@/lib/ingestion/rows";
import { toExtractedPayload } from "@/lib/ingestion/rows";
import type { FieldKey } from "@/lib/ingestion/fields";
import type { MatchResult } from "@/lib/ingestion/match";

// ---- Types -----------------------------------------------------------------
export type BatchChannel = "upload" | "email_inbound" | "manual" | "api";
export type BatchKind = "spreadsheet" | "documents" | "emails" | "mixed" | "manual";
export type BatchStatus =
  | "received" | "parsing" | "ready_for_review" | "partly_promoted" | "completed" | "failed";
export type ReviewStatus = "new" | "needs_review" | "approved" | "merged" | "rejected" | "passed";

export interface IngestionBatch {
  batchId: string;
  orgId: string;
  channel: BatchChannel;
  kind: BatchKind;
  label: string | null;
  status: BatchStatus;
  defaultCurrency: string | null;
  defaultCountry: string | null;
  defaultAreaUnit: "sqft" | "sqm" | null;
  columnMappings: Record<string, FieldKey | null>;
  sourceFileName: string | null;
  itemCount: number;
  promotedCount: number;
  rejectedCount: number;
  error: string | null;
  receivedAt: string;
}

export interface IngestionItem {
  itemId: string;
  orgId: string;
  batchId: string;
  sequence: number;
  itemKind: string;
  rawPayload: Record<string, unknown>;
  extracted: Record<string, unknown>;
  extractionStatus: string;
  reviewStatus: ReviewStatus;
  confidenceOverall: number | null;
  missingFields: string[];
  issues: { severity: string; code: string; message: string; field?: string }[];
  displayName: string | null;
  displayLocation: string | null;
  identityKey: string | null;
  matchedPropertyId: string | null;
  matchedOpportunityId: string | null;
  promotedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  /** Joined for the inbox list. */
  batchLabel?: string | null;
  batchChannel?: BatchChannel;
  sourceFileName?: string | null;
  topMatchScore?: number | null;
  topMatchLabel?: string | null;
}

// ---- Batches ---------------------------------------------------------------
export interface NewBatch {
  orgId: string;
  channel?: BatchChannel;
  kind?: BatchKind;
  label?: string | null;
  defaultCurrency?: string | null;
  defaultCountry?: string | null;
  defaultAreaUnit?: "sqft" | "sqm" | null;
  columnMappings?: Record<string, FieldKey | null>;
  sourceFileName?: string | null;
  contentHash?: string | null;
  createdBy?: string | null;
}

export async function createBatch(tx: Queryable, input: NewBatch): Promise<string> {
  const { rows } = await tx.query<{ batch_id: string }>(
    `insert into ingestion_batches(org_id, channel, kind, label, default_currency,
       default_country, default_area_unit, column_mappings, source_file_name,
       content_hash, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'received',$11)
     returning batch_id`,
    [input.orgId, input.channel ?? "upload", input.kind ?? "spreadsheet", input.label ?? null,
     input.defaultCurrency ?? null, input.defaultCountry ?? null, input.defaultAreaUnit ?? null,
     JSON.stringify(input.columnMappings ?? {}), input.sourceFileName ?? null,
     input.contentHash ?? null, input.createdBy ?? null]);
  return rows[0].batch_id;
}

function mapBatch(r: Record<string, unknown>): IngestionBatch {
  return {
    batchId: r.batch_id as string,
    orgId: r.org_id as string,
    channel: r.channel as BatchChannel,
    kind: r.kind as BatchKind,
    label: str(r.label),
    status: r.status as BatchStatus,
    defaultCurrency: str(r.default_currency),
    defaultCountry: str(r.default_country),
    defaultAreaUnit: (str(r.default_area_unit) as "sqft" | "sqm") ?? null,
    columnMappings: (r.column_mappings as Record<string, FieldKey | null>) ?? {},
    sourceFileName: str(r.source_file_name),
    itemCount: Number(r.item_count ?? 0),
    promotedCount: Number(r.promoted_count ?? 0),
    rejectedCount: Number(r.rejected_count ?? 0),
    error: str(r.error),
    receivedAt: r.received_at as string,
  };
}

export async function listBatches(session: Session, limit = 50): Promise<IngestionBatch[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      "select * from ingestion_batches order by received_at desc limit $1", [limit]);
    return rows.map(mapBatch);
  });
}

export async function getBatch(session: Session, batchId: string): Promise<IngestionBatch | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      "select * from ingestion_batches where batch_id = $1", [batchId]);
    return rows[0] ? mapBatch(rows[0]) : null;
  });
}

export async function setBatchStatus(
  tx: Queryable, batchId: string, status: BatchStatus, error?: string | null,
): Promise<void> {
  await tx.query(
    `update ingestion_batches
        set status = $2, error = $3,
            completed_at = case when $2 in ('completed','failed') then now() else completed_at end
      where batch_id = $1`,
    [batchId, status, error ?? null]);
}

/** Recount a batch from its items, so the inbox badge never drifts. */
export async function refreshBatchCounts(tx: Queryable, batchId: string): Promise<void> {
  await tx.query(
    `update ingestion_batches b
        set item_count     = c.total,
            promoted_count = c.promoted,
            rejected_count = c.rejected,
            status = case
              when c.total = 0 then b.status
              when c.promoted + c.rejected = 0 then 'ready_for_review'
              when c.promoted + c.rejected < c.total then 'partly_promoted'
              else 'completed' end
       from (select count(*) as total,
                    count(*) filter (where review_status in ('approved','merged')) as promoted,
                    count(*) filter (where review_status in ('rejected','passed')) as rejected
               from ingestion_items where batch_id = $1) c
      where b.batch_id = $1`, [batchId]);
}

// ---- Items -----------------------------------------------------------------
/** Below this mean confidence, an item is routed to review rather than the queue. */
export const LOW_CONFIDENCE = 0.7;

/**
 * Persist parsed rows as staged items. The raw row is stored verbatim and is
 * frozen by trigger from this point on.
 */
export async function insertRows(
  tx: Queryable, orgId: string, batchId: string, rows: readonly ExtractedRow[],
): Promise<string[]> {
  const ids: string[] = [];
  let sequence = 0;
  for (const row of rows) {
    sequence += 1;
    if (row.isEmpty) continue;

    // What sends an item straight to review rather than the plain queue: a
    // blocking issue, thin overall confidence, or a missing field we expect.
    const blocking = row.issues.some((i) => i.severity === "error");
    const lowConfidence =
      row.confidenceOverall !== null && row.confidenceOverall < LOW_CONFIDENCE;
    const needsReview = blocking || lowConfidence || row.identityKey === null;

    const { rows: inserted } = await tx.query<{ item_id: string }>(
      `insert into ingestion_items(org_id, batch_id, item_kind, sequence, raw_payload,
         extracted, extraction_status, review_status, confidence_overall,
         missing_fields, issues, display_name, display_location, identity_key)
       values ($1,$2,'spreadsheet_row',$3,$4::jsonb,$5::jsonb,'extracted',$6,$7,$8,$9::jsonb,$10,$11,$12)
       returning item_id`,
      [orgId, batchId, sequence,
       JSON.stringify(row.raw), JSON.stringify(toExtractedPayload(row)),
       needsReview ? "needs_review" : "new",
       row.confidenceOverall, row.missingFields,
       JSON.stringify(row.issues),
       valueOf(row, "property_name"), locationOf(row), row.identityKey]);
    ids.push(inserted[0].item_id);
  }
  return ids;
}

const valueOf = (row: ExtractedRow, field: FieldKey): string | null => {
  const v = row.values[field]?.value;
  return v == null ? null : String(v);
};

const locationOf = (row: ExtractedRow): string | null => {
  const parts = [valueOf(row, "address"), valueOf(row, "city"), valueOf(row, "postcode")]
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

function mapItem(r: Record<string, unknown>): IngestionItem {
  return {
    itemId: r.item_id as string,
    orgId: r.org_id as string,
    batchId: r.batch_id as string,
    sequence: Number(r.sequence ?? 0),
    itemKind: r.item_kind as string,
    rawPayload: (r.raw_payload as Record<string, unknown>) ?? {},
    extracted: (r.extracted as Record<string, unknown>) ?? {},
    extractionStatus: r.extraction_status as string,
    reviewStatus: r.review_status as ReviewStatus,
    confidenceOverall: num(r.confidence_overall),
    missingFields: (r.missing_fields as string[]) ?? [],
    issues: (r.issues as IngestionItem["issues"]) ?? [],
    displayName: str(r.display_name),
    displayLocation: str(r.display_location),
    identityKey: str(r.identity_key),
    matchedPropertyId: str(r.matched_property_id),
    matchedOpportunityId: str(r.matched_opportunity_id),
    promotedAt: str(r.promoted_at),
    reviewNote: str(r.review_note),
    createdAt: r.created_at as string,
    batchLabel: str(r.batch_label),
    batchChannel: (str(r.batch_channel) as BatchChannel) ?? undefined,
    sourceFileName: str(r.source_file_name),
    topMatchScore: num(r.top_match_score),
    topMatchLabel: str(r.top_match_label),
  };
}

export interface InboxFilters {
  reviewStatus?: ReviewStatus[];
  batchId?: string | null;
  search?: string | null;
  limit?: number;
}

/** The Deal Inbox list. One query, including the best match per item. */
export async function listInbox(session: Session, filters: InboxFilters = {}): Promise<IngestionItem[]> {
  const { reviewStatus, batchId = null, search = null, limit = 200 } = filters;
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `select i.*, b.label as batch_label, b.channel as batch_channel,
              b.source_file_name,
              m.score as top_match_score, m.label as top_match_label
         from ingestion_items i
         join ingestion_batches b on b.batch_id = i.batch_id
         left join lateral (
           select c.score,
                  coalesce(o.name, p.name) as label
             from match_candidates c
             left join properties p on p.property_id = c.property_id
             left join opportunities o on o.opportunity_id = c.opportunity_id
            where c.item_id = i.item_id
            order by c.score desc
            limit 1) m on true
        where ($1::text[] is null or i.review_status = any($1))
          and ($2::uuid is null or i.batch_id = $2)
          and ($3::text is null or
               i.display_name ilike '%' || $3 || '%' or
               i.display_location ilike '%' || $3 || '%' or
               i.raw_payload::text ilike '%' || $3 || '%')
        order by i.created_at desc, i.sequence asc
        limit $4`,
      [reviewStatus && reviewStatus.length ? reviewStatus : null, batchId, search, limit]);
    return rows.map(mapItem);
  });
}

export async function getItem(session: Session, itemId: string): Promise<IngestionItem | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query("select * from ingestion_items where item_id = $1", [itemId]);
    return rows[0] ? mapItem(rows[0]) : null;
  });
}

// ---- Matching --------------------------------------------------------------
/** Score an item against existing properties and persist the candidates. */
export async function refreshCandidates(
  tx: Queryable, orgId: string, item: { itemId: string; extracted: Record<string, unknown> },
): Promise<MatchResult[]> {
  const field = (key: FieldKey): string | null => {
    const entry = item.extracted[key] as { value?: unknown } | undefined;
    return entry?.value == null ? null : String(entry.value);
  };
  const priceEntry = item.extracted.asking_price as { value?: unknown } | undefined;

  const ranked = await rankCandidates(tx, orgId, {
    address: field("address"),
    postcode: field("postcode"),
    name: field("property_name"),
    city: field("city"),
    broker: field("broker"),
    price: priceEntry?.value == null ? null : Number(priceEntry.value),
  });

  await tx.query("delete from match_candidates where item_id = $1 and decision = 'pending'",
    [item.itemId]);

  for (const result of ranked) {
    const target = result.target as { propertyId: string; opportunityId?: string | null };
    await tx.query(
      `insert into match_candidates(org_id, item_id, property_id, opportunity_id,
         score, band, signals, reasons)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [orgId, item.itemId, target.propertyId, target.opportunityId ?? null,
       result.score, result.band, JSON.stringify(result.signals), result.reasons]);
  }

  return ranked;
}

export async function listCandidates(
  session: Session, itemId: string,
): Promise<{ candidateId: string; propertyId: string | null; opportunityId: string | null;
             score: number; band: string; reasons: string[]; label: string | null }[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `select c.candidate_id, c.property_id, c.opportunity_id, c.score, c.band, c.reasons,
              coalesce(o.name, p.name) as label
         from match_candidates c
         left join properties p on p.property_id = c.property_id
         left join opportunities o on o.opportunity_id = c.opportunity_id
        where c.item_id = $1
        order by c.score desc`, [itemId]);
    return rows.map((r) => ({
      candidateId: r.candidate_id as string,
      propertyId: str(r.property_id),
      opportunityId: str(r.opportunity_id),
      score: Number(r.score),
      band: r.band as string,
      reasons: (r.reasons as string[]) ?? [],
      label: str(r.label),
    }));
  });
}

// ---- Promotion -------------------------------------------------------------
// The ONLY path from staging into `opportunities`, and it only ever runs
// because a human decided. Everything above this line is preparation.

export interface PromoteOptions {
  /** Attach to this existing opportunity instead of creating a new one. */
  attachToOpportunityId?: string | null;
  /** Attach to this existing property, creating a fresh opportunity under it. */
  attachToPropertyId?: string | null;
  /** Field overrides the reviewer edited before approving. */
  overrides?: Partial<Record<FieldKey, string | number | null>>;
  note?: string | null;
  userId?: string | null;
}

export interface PromoteResult {
  opportunityId: string;
  propertyId: string;
  createdOpportunity: boolean;
  createdProperty: boolean;
}

/**
 * Turn a reviewed item into (or into an update of) an opportunity.
 *
 * Attaching to an existing opportunity NEVER overwrites a populated field: it
 * fills blanks and records what changed as timeline events. Conflicting values
 * are surfaced as history rather than resolved by clobbering, which is the
 * Phase 2 provenance ledger's job to arbitrate properly.
 */
export async function promoteItem(
  session: Session, itemId: string, options: PromoteOptions = {},
): Promise<PromoteResult> {
  return withSession(session, async (tx) => {
    const { rows: itemRows } = await tx.query<Record<string, unknown>>(
      "select * from ingestion_items where item_id = $1", [itemId]);
    if (!itemRows[0]) throw new Error("Item not found or not permitted");
    const item = mapItem(itemRows[0]);
    if (item.promotedAt) throw new Error("This item has already been promoted");

    const { rows: batchRows } = await tx.query<Record<string, unknown>>(
      "select * from ingestion_batches where batch_id = $1", [item.batchId]);
    const batch = batchRows[0] ? mapBatch(batchRows[0]) : null;

    const value = (key: FieldKey): string | number | null => {
      if (options.overrides && key in options.overrides) return options.overrides[key] ?? null;
      const entry = item.extracted[key] as { value?: unknown } | undefined;
      return (entry?.value as string | number | null) ?? null;
    };
    const text = (key: FieldKey): string | null => {
      const v = value(key);
      return v == null ? null : String(v);
    };
    const number = (key: FieldKey): number | null => {
      const v = value(key);
      return v == null || v === "" ? null : Number(v);
    };

    const currency = text("currency") ?? batch?.defaultCurrency ?? "GBP";
    const name = text("property_name") ?? item.displayName ?? "Untitled opportunity";

    // ---- Property -----------------------------------------------------------
    let propertyId: string;
    let createdProperty = false;

    if (options.attachToOpportunityId) {
      const { rows } = await tx.query<{ property_id: string }>(
        "select property_id from opportunities where opportunity_id = $1",
        [options.attachToOpportunityId]);
      if (!rows[0]) throw new Error("Target opportunity not found or not permitted");
      propertyId = rows[0].property_id;
    } else if (options.attachToPropertyId) {
      propertyId = options.attachToPropertyId;
    } else {
      const resolved = await resolveProperty(tx, {
        orgId: item.orgId,
        name,
        address: text("address"),
        postcode: text("postcode"),
        city: text("city"),
        country: text("country") ?? batch?.defaultCountry ?? null,
        market: text("market"),
        submarket: text("submarket"),
        assetType: text("property_type"),
      });
      propertyId = resolved.propertyId;
      createdProperty = resolved.created;
    }

    // ---- Opportunity --------------------------------------------------------
    const askingPrice = number("asking_price");
    let opportunityId: string;
    let createdOpportunity = false;

    if (options.attachToOpportunityId) {
      opportunityId = options.attachToOpportunityId;

      const { rows: existingRows } = await tx.query<Record<string, unknown>>(
        "select * from opportunities where opportunity_id = $1", [opportunityId]);
      const existing = existingRows[0];
      const previousPrice = num(existing.target_price);

      // Fill blanks only. A populated field is never overwritten here.
      await tx.query(
        `update opportunities set
           target_price  = coalesce(target_price, $2),
           passing_rent  = coalesce(passing_rent, $3),
           erv           = coalesce(erv, $4),
           niy           = coalesce(niy, $5),
           size_sqft     = coalesce(size_sqft, $6),
           size_sqm      = coalesce(size_sqm, $7),
           broker_name   = coalesce(broker_name, $8),
           vendor_name   = coalesce(vendor_name, $9),
           summary       = coalesce(summary, $10),
           submarket     = coalesce(submarket, $11),
           source        = coalesce(source, $12),
           last_source_at = now()
         where opportunity_id = $1`,
        [opportunityId, askingPrice, number("passing_income"), number("erv"), number("niy"),
         number("floor_area_sqft"), number("floor_area_sqm"), text("broker"), text("vendor"),
         text("broker_description"), text("submarket"), text("deal_source")]);

      // A price that MOVED is intelligence, and is recorded even though the
      // column above was left alone.
      const change = priceChangeEvent(previousPrice, askingPrice, currency);
      if (change) {
        await recordEvent(tx, {
          orgId: item.orgId, propertyId, opportunityId,
          eventType: change.eventType, headline: change.headline,
          numericValue: askingPrice, previousValue: previousPrice, currency,
          sourceKind: "spreadsheet", ingestionItemId: itemId,
          detail: batch?.sourceFileName ? `Source: ${batch.sourceFileName}` : null,
          createdBy: options.userId ?? null,
        });
      }
    } else {
      const { rows } = await tx.query<{ opportunity_id: string }>(
        `insert into opportunities(org_id, property_id, name, market, submarket, asset_type,
           currency, target_price, passing_rent, erv, niy, size_sqft, size_sqm,
           broker_name, vendor_name, source, summary, stage, status, market_status,
           first_seen_at, last_source_at, created_by, owner_user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 'inbox','active',$18, now(), now(), $19, $19)
         returning opportunity_id`,
        [item.orgId, propertyId, name, text("market"), text("submarket"),
         text("property_type") ?? "other", currency, askingPrice, number("passing_income"),
         number("erv"), number("niy"), number("floor_area_sqft"), number("floor_area_sqm"),
         text("broker"), text("vendor"), text("deal_source") ?? batch?.sourceFileName ?? null,
         text("broker_description"), marketStatusFrom(text("sale_status")),
         options.userId ?? null]);
      opportunityId = rows[0].opportunity_id;
      createdOpportunity = true;

      await recordEvent(tx, {
        orgId: item.orgId, propertyId, opportunityId,
        eventType: "first_seen",
        headline: batch?.sourceFileName
          ? `First seen in ${batch.sourceFileName}`
          : "First seen",
        detail: text("broker") ? `Marketed by ${text("broker")}` : null,
        sourceKind: "spreadsheet", ingestionItemId: itemId,
        createdBy: options.userId ?? null,
      });

      if (askingPrice != null) {
        await recordEvent(tx, {
          orgId: item.orgId, propertyId, opportunityId,
          eventType: "price_quoted",
          headline: priceChangeEvent(null, askingPrice, currency)!.headline,
          numericValue: askingPrice, currency,
          sourceKind: "spreadsheet", ingestionItemId: itemId,
          createdBy: options.userId ?? null,
        });
      }
    }

    // ---- Close the item -----------------------------------------------------
    await tx.query(
      `update ingestion_items
          set review_status = $2, matched_property_id = $3, matched_opportunity_id = $4,
              promoted_at = now(), promoted_by = $5, reviewed_at = now(), reviewed_by = $5,
              review_note = coalesce($6, review_note)
        where item_id = $1`,
      [itemId, createdOpportunity ? "approved" : "merged", propertyId, opportunityId,
       options.userId ?? null, options.note ?? null]);

    await tx.query(
      `update match_candidates set decision = $2, decided_by = $3, decided_at = now()
        where item_id = $1 and decision = 'pending'`,
      [itemId, createdOpportunity ? "new_opportunity" : "attached", options.userId ?? null]);

    await refreshBatchCounts(tx, item.batchId);

    return { opportunityId, propertyId, createdOpportunity, createdProperty };
  });
}

/** A broker's free-text sale status, mapped onto the market_status axis. */
function marketStatusFrom(raw: string | null): string {
  if (!raw) return "unknown";
  const s = raw.toLowerCase();
  if (/\b(sold|completed|exchanged)\b/.test(s)) return "sold";
  if (/\b(under offer|sstc|agreed|u\/o)\b/.test(s)) return "under_offer";
  if (/\b(withdrawn|off market|pulled)\b/.test(s)) return "withdrawn";
  if (/\b(available|on market|for sale|launched)\b/.test(s)) return "available";
  return "unknown";
}

// ---- Review actions --------------------------------------------------------
export async function setReviewStatus(
  session: Session, itemIds: readonly string[], status: ReviewStatus, userId?: string | null,
): Promise<number> {
  if (itemIds.length === 0) return 0;
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ batch_id: string }>(
      `update ingestion_items
          set review_status = $2, reviewed_at = now(), reviewed_by = $3
        where item_id = any($1::uuid[]) and promoted_at is null
        returning batch_id`,
      [itemIds, status, userId ?? null]);
    for (const batchId of new Set(rows.map((r) => r.batch_id))) {
      await refreshBatchCounts(tx, batchId);
    }
    return rows.length;
  });
}

/** Promote many items in one pass. Failures are reported, never silent. */
export async function promoteMany(
  session: Session, itemIds: readonly string[], userId?: string | null,
): Promise<{ promoted: string[]; failed: { itemId: string; error: string }[] }> {
  const promoted: string[] = [];
  const failed: { itemId: string; error: string }[] = [];
  for (const itemId of itemIds) {
    try {
      const result = await promoteItem(session, itemId, { userId });
      promoted.push(result.opportunityId);
    } catch (e) {
      failed.push({ itemId, error: (e as Error).message });
    }
  }
  return { promoted, failed };
}

/** Items awaiting a decision, for the sidebar badge. */
export async function countAwaitingReview(session: Session): Promise<number> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ n: string }>(
      "select count(*) as n from ingestion_items where review_status in ('new','needs_review')");
    return Number(rows[0]?.n ?? 0);
  });
}
