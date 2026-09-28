// ============================================================================
// Pipeline deal load — staging to opportunities, idempotent on Ref.
// ----------------------------------------------------------------------------
// Rules this module exists to hold:
//
//   * Money is written to `investment_cases`, never onto the opportunity row.
//     The 0009 trigger projects it. An opportunity whose price was written
//     directly is a price the approved underwriting has never heard of.
//
//   * Properties are resolved ONLY through resolveProperty(). This module never
//     constructs, parses or asserts on an identity key: key shape is an
//     implementation detail of the normaliser, and a loader that reached into
//     it would have to be revised every time the rule improved.
//
//   * Re-running changes nothing. `reference` is unique per organisation, so a
//     second run finds and updates the row the first made.
//
//   * Nothing becomes investor-visible. No publication is created, and
//     visibility requires one (migration 0005).
// ============================================================================
import { type Queryable } from "@/lib/db/client";
import { str } from "@/lib/data/coerce";
import { resolveProperty } from "@/lib/data/properties";
import { recordEvent } from "@/lib/data/property-events";
import type { PipelineRow } from "@/lib/ingestion/pipeline-workbook";
import { isNotABuilding, entryYieldPct, classifyThread } from "@/lib/ingestion/pipeline-workbook";
import { upsertThread, linkThread } from "@/lib/data/email-threads";

export type LoadOutcome = "created" | "updated" | "skipped" | "failed" | "excluded";

export interface LoadedRow {
  ref: string;
  outcome: LoadOutcome;
  reason?: string;
  opportunityId?: string;
  propertyId?: string;
  /** The property carries no identity key: 1:1 by default, not by identity. */
  propertyUnkeyed?: boolean;
}

export interface LoadContext {
  orgId: string;
  userId: string;
  batchId: string;
}

/** Map a workbook asset type onto the opportunities enum, or leave it out. */
const ASSET_TYPE: Record<string, string> = {
  "office": "office", "retail": "retail", "industrial": "industrial",
  "logistics": "logistics", "residential": "residential", "multifamily": "multifamily",
  "hotel": "hotel", "student housing": "student_housing", "healthcare": "healthcare",
  "data centre": "data_centre", "mixed use": "mixed_use", "land": "land",
};

const assetType = (v: string | null): string =>
  (v && ASSET_TYPE[v.trim().toLowerCase()]) || "other";

/**
 * Origination shape. The workbook's "Off Market" flag is the only signal about
 * how a deal arrived; everything else would be a guess.
 */
const sourceType = (row: PipelineRow): string =>
  row.offMarket === true ? "off_market" : row.offMarket === false ? "broker_marketed" : "other";

export async function loadRow(
  tx: Queryable, ctx: LoadContext, row: PipelineRow,
): Promise<LoadedRow> {
  const notABuilding = isNotABuilding(row.ref);

  // The existing binding is read FIRST, because it decides whether a property
  // needs resolving at all.
  const existing = await tx.query<{ opportunity_id: string; property_id: string | null }>(
    "select opportunity_id, property_id from opportunities where org_id = $1 and reference = $2",
    [ctx.orgId, row.ref]);

  // ---- Property ------------------------------------------------------------
  // Resolved through resolveProperty and nothing else. Whether the address
  // yields a key, and what that key looks like, is that function's business.
  //
  // A row already bound to a property keeps it, and is NOT re-resolved. This is
  // what makes the load idempotent for the 15 addresses that carry no house
  // number: resolveProperty cannot match an unkeyable property - by design,
  // because a street name identifies a street rather than a building - so a
  // second run would create a fresh property for every one of them and orphan
  // the property the first run made.
  //
  // The cost is that a CHANGED address in the sheet does not re-bind an
  // existing opportunity. That is the safer direction: silently moving an
  // opportunity to a different building is a worse failure than a stale link
  // somebody can see and correct.
  let propertyId: string | undefined = existing.rows[0]?.property_id ?? undefined;
  let propertyUnkeyed = false;

  if (!notABuilding && !propertyId) {
    const resolved = await resolveProperty(tx, {
      orgId: ctx.orgId,
      name: row.name,
      address: row.address,
      city: row.market,
      market: row.market,
      submarket: row.submarket,
      assetType: assetType(row.assetType),
      firstSeenAt: row.dateReceived,
    });
    propertyId = resolved.propertyId;
    propertyUnkeyed = resolved.identityKey === null;
  } else if (propertyId) {
    // Report the exception on a re-run as faithfully as on the first run.
    const known = await tx.query<{ identity_key: string | null }>(
      "select identity_key from properties where property_id = $1", [propertyId]);
    propertyUnkeyed = known.rows[0]?.identity_key === null;
  }

  const common = [
    row.name, row.market, row.submarket, assetType(row.assetType),
    str(row.strategy), row.currency ?? "GBP", str(row.broker),
    sourceType(row), row.dateReceived, str(row.comments),
    row.triageStatus, row.triagePriority, str(row.triageNote),
  ];

  let opportunityId: string;
  let outcome: LoadOutcome;

  if (existing.rows[0]) {
    opportunityId = existing.rows[0].opportunity_id;
    await tx.query(
      `update opportunities set
         name = $3, market = $4, submarket = $5, asset_type = $6, strategy = $7,
         currency = $8, broker_name = $9, source_type = $10, sourced_at = $11::date,
         summary = $12, triage_status = $13, triage_priority = $14, triage_note = $15,
         property_id = coalesce($16, property_id)
       where org_id = $1 and reference = $2`,
      [ctx.orgId, row.ref, ...common, propertyId ?? null]);
    outcome = "updated";
  } else {
    const inserted = await tx.query<{ opportunity_id: string }>(
      `insert into opportunities(
         org_id, reference, property_id, name, market, submarket, asset_type, strategy,
         currency, broker_name, source_type, sourced_at, summary,
         triage_status, triage_priority, triage_note,
         stage, status, created_by, owner_user_id)
       values ($1,$2,$16,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,$14,$15,
               'new','active',$17,null)
       returning opportunity_id`,
      [ctx.orgId, row.ref, ...common, propertyId ?? null, ctx.userId]);
    opportunityId = inserted.rows[0].opportunity_id;
    outcome = "created";
  }

  // ---- Money: the investment case, never the opportunity row ---------------
  await upsertOriginationCase(tx, ctx, opportunityId, row);

  // ---- Timeline ------------------------------------------------------------
  if (propertyId && outcome === "created") {
    await recordEvent(tx, {
      orgId: ctx.orgId,
      propertyId,
      opportunityId,
      eventType: "first_seen",
      occurredAt: row.dateReceived,
      headline: `Recorded from the pipeline sheet as ${row.ref}`,
      detail: row.broker ? `Marketed by ${row.broker}` : null,
      sourceKind: "spreadsheet",
      createdBy: ctx.userId,
    });
  }

  // ---- Email thread --------------------------------------------------------
  // The sheet names at most one thread per deal. Firm-level threads, which
  // cover several deals at once, are loaded separately and deliberately left
  // unlinked - see loadMailMap().
  if (row.gmailThreadId) {
    const emailThreadId = await upsertThread(tx, {
      orgId: ctx.orgId,
      gmailThreadId: row.gmailThreadId,
      subject: row.name,
      market: row.market,
      classification: "deal",
      createdBy: ctx.userId,
    });
    await linkThread(tx, {
      orgId: ctx.orgId,
      opportunityId,
      emailThreadId,
      // A blank confidence is treated as needing review, never as settled.
      confidence: row.gmailConfidence === "high" ? "high" : "review",
      matchedSubject: row.name,
      linkedBy: ctx.userId,
    });
  }

  return {
    ref: row.ref,
    outcome,
    opportunityId,
    propertyId,
    propertyUnkeyed,
    reason: notABuilding ?? undefined,
  };
}

/**
 * Underwriting version 1 from the origination figures.
 *
 * Re-running must not stack versions, so an existing v1 is updated in place —
 * but only while it is still `draft` or `current`. Once a case has been
 * approved or superseded it is immutable by trigger (0008), and a loader that
 * tried to rewrite it would be trying to rewrite a decision.
 */
async function upsertOriginationCase(
  tx: Queryable, ctx: LoadContext, opportunityId: string, row: PipelineRow,
): Promise<void> {
  const price = row.priceBase;
  const income = row.incomeBase;
  const yieldPct = entryYieldPct(price, income);

  // Nothing to underwrite. An opportunity with no figures gets no case, which
  // is correct: it has not been underwritten.
  if (price === null && income === null) return;

  const existing = await tx.query<{ case_id: string; status: string }>(
    `select case_id, status from investment_cases
      where opportunity_id = $1 and version = 1`, [opportunityId]);

  if (existing.rows[0]) {
    if (existing.rows[0].status === "draft" || existing.rows[0].status === "current") {
      await tx.query(
        `update investment_cases
            set acquisition_price = $2, gross_rental_income = $3, entry_yield_pct = $4,
                strategy = coalesce($5, strategy)
          where case_id = $1`,
        [existing.rows[0].case_id, price, income, yieldPct, str(row.strategy)]);
    }
    return;
  }

  await tx.query(
    `insert into investment_cases(
       org_id, opportunity_id, version, status, created_by, strategy,
       acquisition_price, gross_rental_income, entry_yield_pct)
     values ($1,$2,1,'current',$3,$4,$5,$6,$7)`,
    [ctx.orgId, opportunityId, ctx.userId, str(row.strategy), price, income, yieldPct]);
}

/** Record what happened to a row, with the source row frozen beside it. */
export async function recordLoadRow(
  tx: Queryable, ctx: LoadContext, row: PipelineRow, result: LoadedRow,
): Promise<void> {
  await tx.query(
    `insert into deal_load_rows(
       org_id, batch_id, reference, raw_row, outcome, reason,
       opportunity_id, property_id, property_unkeyed)
     values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
     on conflict (batch_id, reference) do nothing`,
    [ctx.orgId, ctx.batchId, row.ref, JSON.stringify(row.raw), result.outcome,
     result.reason ?? null, result.opportunityId ?? null, result.propertyId ?? null,
     result.propertyUnkeyed ?? false]);
}


/**
 * Record the Mail Map threads, linked to nothing.
 *
 * Nineteen are firm-level or administrative and one is a property that is not
 * among the loaded deals. None is assigned automatically: a thread listing
 * eight buildings belongs to eight opportunities or to none, and guessing which
 * is exactly the error that paired "16 Conduit Street" with "9 Conduit Street".
 *
 * They are stored rather than dropped because an unmatched thread names a deal
 * the sheet is missing, and because a thread recorded as `not_a_deal` is what
 * stops a later pass offering it again as a candidate.
 */
export async function loadMailMap(
  tx: Queryable,
  ctx: LoadContext,
  threads: readonly { category: string; market: string | null; threadId: string;
                      subject: string | null; note: string | null }[],
): Promise<number> {
  for (const t of threads) {
    await upsertThread(tx, {
      orgId: ctx.orgId,
      gmailThreadId: t.threadId,
      subject: t.subject,
      market: t.market,
      classification: classifyThread(t.category, t.note),
      note: t.note,
      createdBy: ctx.userId,
    });
  }
  return threads.length;
}
