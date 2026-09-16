// ============================================================================
// Property events — the longitudinal spine.
// ----------------------------------------------------------------------------
// Events belong to a PROPERTY first and a marketing campaign second, which is
// what makes "16 Conduit Street, guide GBP 8.0m in 2025, withdrawn in 2026,
// relaunched at GBP 7.4m in 2027" one continuous history rather than three
// unrelated records.
//
// Append-only by policy: migration 0007 grants no DELETE on this table. A wrong
// event is corrected by recording another, never by erasing the first.
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
  /** When it happened in the MARKET. Defaults to now; set it for imported history. */
  occurredAt?: string | null;
  numericValue?: number | null;
  previousValue?: number | null;
  currency?: string | null;
  sourceKind?: SourceKind | null;
  sourceDocumentId?: string | null;
  sourceEmailId?: string | null;
  ingestionItemId?: string | null;
  createdBy?: string | null;
}

export interface PropertyEvent extends Omit<NewPropertyEvent, "orgId"> {
  eventId: string;
  occurredAt: string;
  recordedAt: string;
}

export async function recordEvent(tx: Queryable, event: NewPropertyEvent): Promise<string> {
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

export async function recordEvents(tx: Queryable, events: NewPropertyEvent[]): Promise<void> {
  for (const event of events) await recordEvent(tx, event);
}

function mapEvent(r: Record<string, unknown>): PropertyEvent {
  return {
    eventId: r.event_id as string,
    propertyId: r.property_id as string,
    opportunityId: (r.opportunity_id as string) ?? null,
    eventType: r.event_type as PropertyEventType,
    occurredAt: r.occurred_at as string,
    recordedAt: r.recorded_at as string,
    headline: r.headline as string,
    detail: str(r.detail),
    numericValue: num(r.numeric_value),
    previousValue: num(r.previous_value),
    currency: str(r.currency),
    sourceKind: (str(r.source_kind) as SourceKind) ?? null,
    sourceDocumentId: str(r.source_document_id),
    sourceEmailId: str(r.source_email_id),
    ingestionItemId: str(r.ingestion_item_id),
    createdBy: str(r.created_by),
  };
}

/**
 * The full history of a property, across every marketing campaign.
 * This is the view that makes the database proprietary rather than descriptive.
 */
export async function listPropertyTimeline(
  session: Session, propertyId: string,
): Promise<PropertyEvent[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `select * from property_events where property_id = $1
        order by occurred_at desc, recorded_at desc`, [propertyId]);
    return rows.map(mapEvent);
  });
}

/** Just this campaign, for the default view on an opportunity page. */
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

/**
 * Compare a newly observed value with what is held, and describe the change.
 * Returns null when nothing moved, so callers can append events unconditionally
 * without writing "price changed from X to X".
 */
export function priceChangeEvent(
  previous: number | null, next: number | null, currency: string | null,
): { eventType: PropertyEventType; headline: string } | null {
  if (next == null) return null;
  if (previous == null) {
    return { eventType: "price_quoted", headline: `Guide price recorded: ${format(next, currency)}` };
  }
  if (previous === next) return null;
  const direction = next < previous ? "reduced" : "increased";
  return {
    eventType: "price_changed",
    headline: `Guide price ${direction}: ${format(previous, currency)} to ${format(next, currency)}`,
  };
}

function format(value: number, currency: string | null): string {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "JPY" ? "¥" : "£";
  if (Math.abs(value) >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(2)}m`;
  if (Math.abs(value) >= 1_000) return `${symbol}${(value / 1_000).toFixed(0)}k`;
  return `${symbol}${value.toLocaleString("en-GB")}`;
}
