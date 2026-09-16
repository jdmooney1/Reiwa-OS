// ============================================================================
// Property events — the longitudinal record.
// ----------------------------------------------------------------------------
// Events belong to a PROPERTY first and to a marketing campaign second, which
// is what makes "16 Conduit Street, guide GBP 8.0m in 2025, withdrawn in 2026,
// relaunched at GBP 7.4m in 2027" one continuous history rather than three
// unrelated records.
//
// Append-only by privilege: migration 0012 grants no DELETE, so a wrong event
// is corrected by recording another rather than by erasing the first.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";

export type PropertyEventType =
  | "first_seen" | "price_quoted" | "price_changed" | "income_revised"
  | "broker_changed" | "brochure_received" | "email_received" | "tenancy_revised"
  | "market_status_changed" | "withdrawn" | "relaunched" | "sold" | "failed_sale"
  | "bid_submitted" | "reiwa_passed" | "reiwa_stage_changed" | "investor_approached"
  | "published" | "imported" | "note";

export type SourceKind =
  | "broker_email" | "brochure" | "spreadsheet" | "reiwa_manual"
  | "reiwa_assumption" | "underwriting" | "public_record";

export interface NewPropertyEvent {
  orgId: string;
  propertyId: string;
  opportunityId?: string | null;
  eventType: PropertyEventType;
  headline: string;
  detail?: string | null;
  /** When it happened in the MARKET. Defaults to now; set it for captured history. */
  occurredAt?: string | null;
  numericValue?: number | null;
  previousValue?: number | null;
  currency?: string | null;
  sourceKind?: SourceKind | null;
  sourceDocumentId?: string | null;
  sourceEmailId?: string | null;
  ingestionItemId?: string | null;
  /**
   * Who recorded it. Required unless `sourceKind` says what did — the database
   * enforces the pair (property_events_attribution_check), because an event
   * attributed to nothing is indistinguishable from one whose attribution was
   * lost.
   */
  createdBy?: string | null;
}

export interface PropertyEvent {
  eventId: string;
  propertyId: string;
  opportunityId: string | null;
  eventType: PropertyEventType;
  occurredAt: string;
  recordedAt: string;
  headline: string;
  detail: string | null;
  numericValue: number | null;
  previousValue: number | null;
  currency: string | null;
  sourceKind: SourceKind | null;
  createdBy: string | null;
}

export async function recordEvent(tx: Queryable, event: NewPropertyEvent): Promise<string> {
  if (!event.createdBy && !event.sourceKind) {
    throw new Error(
      "A property event needs either an author or a source: an event attributed " +
      "to nothing cannot be told apart from one whose attribution was lost.");
  }
  const { rows } = await tx.query<{ event_id: string }>(
    `insert into property_events(org_id, property_id, opportunity_id, event_type,
       occurred_at, headline, detail, numeric_value, previous_value, currency,
       source_kind, source_document_id, source_email_id, ingestion_item_id, created_by)
     values ($1,$2,$3,$4, coalesce($5::timestamptz, now()), $6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning event_id`,
    [event.orgId, event.propertyId, event.opportunityId ?? null, event.eventType,
     event.occurredAt ?? null, event.headline, event.detail ?? null,
     event.numericValue ?? null, event.previousValue ?? null, event.currency ?? null,
     event.sourceKind ?? null, event.sourceDocumentId ?? null, event.sourceEmailId ?? null,
     event.ingestionItemId ?? null, event.createdBy ?? null]);
  return rows[0].event_id;
}

function mapEvent(r: Record<string, unknown>): PropertyEvent {
  return {
    eventId: r.event_id as string,
    propertyId: r.property_id as string,
    opportunityId: str(r.opportunity_id),
    eventType: r.event_type as PropertyEventType,
    occurredAt: r.occurred_at as string,
    recordedAt: r.recorded_at as string,
    headline: r.headline as string,
    detail: str(r.detail),
    numericValue: num(r.numeric_value),
    previousValue: num(r.previous_value),
    currency: str(r.currency),
    sourceKind: str(r.source_kind) as SourceKind | null,
    createdBy: str(r.created_by),
  };
}

/** Events recorded inside a caller's transaction. */
export async function listPropertyTimelineOn(
  tx: Queryable, propertyId: string,
): Promise<PropertyEvent[]> {
  const { rows } = await tx.query(
    `select * from property_events where property_id = $1
      order by occurred_at desc, recorded_at desc`, [propertyId]);
  return rows.map(mapEvent);
}

/**
 * The full history of a property, across every marketing campaign.
 * This is the view that answers "has this been round before, and at what?".
 */
export async function listPropertyTimeline(
  session: Session, propertyId: string,
): Promise<PropertyEvent[]> {
  return withSession(session, (tx) => listPropertyTimelineOn(tx, propertyId));
}

/** Just this campaign, for the default view on an opportunity. */
export async function listOpportunityTimeline(
  session: Session, opportunityId: string,
): Promise<PropertyEvent[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `select * from property_events where opportunity_id = $1
        order by occurred_at desc, recorded_at desc`, [opportunityId]);
    return rows.map(mapEvent);
  });
}

// ---- Change description ----------------------------------------------------
/**
 * Describe a movement in a quoted price, or return null when nothing moved, so
 * callers can record unconditionally without writing "changed from X to X".
 */
export function priceChangeEvent(
  previous: number | null, next: number | null, currency: string | null,
): { eventType: PropertyEventType; headline: string } | null {
  if (next == null) return null;
  if (previous == null) {
    return { eventType: "price_quoted", headline: `Guide price recorded: ${money(next, currency)}` };
  }
  if (previous === next) return null;
  const direction = next < previous ? "reduced" : "increased";
  return {
    eventType: "price_changed",
    headline: `Guide price ${direction}: ${money(previous, currency)} to ${money(next, currency)}`,
  };
}

const SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$", JPY: "¥" };

function money(value: number, currency: string | null): string {
  const symbol = SYMBOL[currency ?? "GBP"] ?? "";
  if (Math.abs(value) >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(2)}m`;
  if (Math.abs(value) >= 1_000) return `${symbol}${(value / 1_000).toFixed(0)}k`;
  return `${symbol}${value.toLocaleString("en-GB")}`;
}
