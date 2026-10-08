// ============================================================================
// Loading structured deal records as draft opportunities. Runs inside the caller's
// transaction, so RLS and the caller's rollback decide everything.
// ----------------------------------------------------------------------------
// WHAT A "DRAFT" IS HERE. The opportunity lands at stage 'new', status 'active',
// triage_status 'untriaged': in the pipeline's own needs-triage queue, owned by nobody. No
// publication is created, and an investor can see a deal only through one (0005), so nothing
// loaded here is reachable from an investor view. A human promotes a deal by triaging it and
// publishing it; nothing in this file does either.
//
// RULES (the same ones deal-load.ts holds, plus two):
//   * Properties come from resolveProperty() and nothing else.
//   * Money goes to investment_cases, never onto the opportunity row (0009 projects it).
//   * Re-running changes nothing a person has since edited: the seed only ever writes into a
//     field that is still EMPTY. So a deal that moved from 'guided' to 'under_offer' in the UI
//     stays where it is.
//   * A deal is never created next to one that already exists. If another opportunity is bound
//     to the same property, or has a near-identical name, the deal is HELD and reported, and
//     written only on --allow-existing. Two records for one building is the failure this guards.
//   * Closed history is never written to. A reference that matches an ARCHIVED or MERGED
//     opportunity is not "the deal this seed already loaded": that record is finished. The deal is
//     HELD, whatever --allow-existing says, and the report names what happened to it (merged into
//     which survivor, or archived with which status).
// ============================================================================
import type { Queryable } from "@/lib/db/client";
import { resolveProperty } from "@/lib/data/properties";
import { recordEvent } from "@/lib/data/property-events";
import type { SeedDeal } from "@/lib/ingestion/deal-seed";

export interface SeedContext {
  orgId: string;
  userId: string;
  /** Write a deal even though an opportunity for the same building already exists. */
  allowExisting: boolean;
}

export interface Collision {
  opportunityId: string;
  reference: string | null;
  name: string;
  brokerName: string | null;
  price: number | null;
  why: CollisionWhy;
  /** Closed-history collisions only: the record's status (e.g. "merged", "withdrawn"). */
  status?: string;
  /** already_merged only: the opportunity it was merged into, and that record's name. */
  mergedInto?: string | null;
  mergedIntoName?: string | null;
}

export type CollisionWhy = "same_property" | "similar_name" | "already_merged" | "already_archived";

/** One line for a report or a load-row reason: says what the record IS, not just that it collides. */
export function describeCollision(c: Collision): string {
  const ref = c.reference ?? c.opportunityId;
  if (c.why === "already_merged") {
    return `already loaded and merged into ${c.mergedInto ?? "an unknown record"}${c.mergedIntoName ? ` ("${c.mergedIntoName}")` : ""} [${ref}]`;
  }
  if (c.why === "already_archived") return `already loaded and archived (status ${c.status ?? "unknown"}) [${ref}]`;
  return `${c.why} ${ref}`;
}

/** What a seed reference that matches a closed (archived or merged) record reports. Pure, so it is tested directly. */
export function closedRecordCollision(
  row: { opportunity_id: string; reference: string | null; name: string; broker_name: string | null; target_price: string | null; status: string; merged_into: string | null },
  survivorName: string | null,
): Collision {
  const merged = row.status === "merged" || row.merged_into !== null;
  return {
    opportunityId: row.opportunity_id, reference: row.reference, name: row.name, brokerName: row.broker_name,
    price: row.target_price === null ? null : Number(row.target_price),
    why: merged ? "already_merged" : "already_archived", status: row.status,
    ...(merged ? { mergedInto: row.merged_into, mergedIntoName: survivorName } : {}),
  };
}

export type SeedOutcome = "created" | "updated" | "held";

export interface SeededDeal {
  reference: string;
  outcome: SeedOutcome;
  opportunityId?: string;
  propertyId?: string;
  propertyUnkeyed?: boolean;
  collisions: Collision[];
}

/**
 * Spelling and naming variants that mean the same word in a building's name, each mapped to ONE form.
 * A small table, on purpose: the failure it closes is "Emerald Theatre" and "Emerald Theater" reading
 * as two buildings, and the next one will be a pair like it. Not a fuzzy matcher: a variant belongs
 * here only when two spellings are the same word.
 *
 * Keys are single lowercase words (tests hold that, and that no value is itself a key, so mapping
 * never chains). To extend: add the pair, add a test for it.
 */
export const NAME_VARIANTS: Readonly<Record<string, string>> = {
  // British / American spelling
  theatre: "theater", centre: "center", harbour: "harbor", colour: "color", grey: "gray",
  metre: "meter", neighbourhood: "neighborhood", programme: "program",
  // Street-type and place abbreviations (street and saint share "st": both abbreviate to it)
  street: "st", saint: "st", road: "rd", avenue: "ave", av: "ave", square: "sq", place: "pl",
  court: "ct", garden: "gdns", gardens: "gdns", lane: "ln", terrace: "ter", mount: "mt",
  building: "bldg", buildings: "bldg", bldgs: "bldg",
  // Spelled-out numbers: "One Fleet Place" and "1 Fleet Place"
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
};

/**
 * A building name reduced to what identifies it: lowercase, "&" read as "and", apostrophes and a plural or
 * possessive "s" dropped (so "Queen's", "Queens" and "Queen" agree), punctuation ignored, "the" ignored, and
 * each variant word mapped to its one form.
 */
export function normaliseName(s: string): string {
  return s.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019`]s\b/g, "")   // a possessive: "James's" is "James"
    .replace(/['\u2019`]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== "" && t !== "the")
    .map((t) => NAME_VARIANTS[t] ?? NAME_VARIANTS[stem(t)] ?? stem(t))
    .join("");
}

/** A plural or possessive "s" dropped, so "Queen's", "Queens" and "Queen" agree and "James's" is "James". */
const stem = (t: string): string => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);

/** Whether two names are plausibly the same building: equal, or one contains the other (min 6 characters). */
export function similarNames(a: string, b: string): boolean {
  const x = normaliseName(a), y = normaliseName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.includes(short);
}

/** A live opportunity: not archived and not merged. The only kind a seed reference may update. */
const LIVE = "archived_at is null and status <> 'merged'";
/** Closed history: the exact complement of LIVE (written with the `o` alias used where it is read). */
const CLOSED = "(o.archived_at is not null or o.status = 'merged')";

export async function seedDeal(tx: Queryable, ctx: SeedContext, deal: SeedDeal): Promise<SeededDeal> {
  await tx.query("savepoint seed_deal");

  // The record this seed already loaded: LIVE ones only. An archived or merged record is closed
  // history; matching it here used to send the loader into the update branch below, writing into it.
  const existing = await tx.query<{ opportunity_id: string; property_id: string | null }>(
    `select opportunity_id, property_id from opportunities where org_id = $1 and reference = $2 and ${LIVE}`,
    [ctx.orgId, deal.reference]);

  // ---- Property ----
  let propertyId = existing.rows[0]?.property_id ?? undefined;
  let identityKey: string | null = null;
  if (!propertyId) {
    const resolved = await resolveProperty(tx, {
      orgId: ctx.orgId, name: deal.name, address: deal.address, city: deal.market,
      market: deal.market, assetType: deal.assetType,
    });
    propertyId = resolved.propertyId;
    identityKey = resolved.identityKey;
  } else {
    identityKey = (await tx.query<{ identity_key: string | null }>(
      "select identity_key from properties where property_id = $1", [propertyId])).rows[0]?.identity_key ?? null;
  }

  // ---- Collisions: only for a deal not already loaded (and still live) by this seed ----
  const collisions: Collision[] = [];
  let closedHistory = false;
  if (!existing.rows[0]) {
    // The reference may match a CLOSED record. That is a hold of its own kind, reported first and
    // by name, and no flag overrides it: the reference is taken (it is unique per organisation),
    // and closed history is not written to.
    const closed = await tx.query<{ opportunity_id: string; reference: string | null; name: string; broker_name: string | null; target_price: string | null; status: string; merged_into: string | null }>(
      `select o.opportunity_id, o.reference, o.name, o.broker_name, o.target_price, o.status,
              to_jsonb(o) ->> 'merged_into_opportunity_id' as merged_into
         from opportunities o
        where o.org_id = $1 and o.reference = $2 and ${CLOSED}`,
      [ctx.orgId, deal.reference]);
    if (closed.rows[0]) {
      closedHistory = true;
      const survivor = closed.rows[0].merged_into
        ? (await tx.query<{ name: string }>("select name from opportunities where opportunity_id = $1", [closed.rows[0].merged_into])).rows[0]?.name ?? null
        : null;
      collisions.push(closedRecordCollision(closed.rows[0], survivor));
    }

    const others = await tx.query<{ opportunity_id: string; reference: string | null; name: string; broker_name: string | null; target_price: string | null; property_id: string | null }>(
      `select opportunity_id, reference, name, broker_name, target_price, property_id
         from opportunities where org_id = $1 and ${LIVE}`, [ctx.orgId]);
    for (const o of others.rows) {
      const why = o.property_id === propertyId ? "same_property" : similarNames(o.name, deal.name) ? "similar_name" : null;
      if (why) collisions.push({
        opportunityId: o.opportunity_id, reference: o.reference, name: o.name, brokerName: o.broker_name,
        price: o.target_price === null ? null : Number(o.target_price), why,
      });
    }
    if (closedHistory || (collisions.length > 0 && !ctx.allowExisting)) {
      // Undo the property this call may have created: a held deal leaves no trace.
      await tx.query("rollback to savepoint seed_deal");
      return { reference: deal.reference, outcome: "held", collisions };
    }
  }

  // ---- Opportunity ----
  const p = deal.photo;
  let opportunityId: string;
  let outcome: SeedOutcome;
  if (existing.rows[0]) {
    opportunityId = existing.rows[0].opportunity_id;
    const updated = await tx.query(
      `update opportunities set
         property_id        = coalesce(property_id, $3),
         market             = coalesce(market, $4),
         source             = coalesce(source, $5),
         broker_name        = coalesce(broker_name, $6),
         source_contact_name = coalesce(source_contact_name, $7),
         size_sqft          = coalesce(size_sqft, $8),
         deal_stage         = coalesce(deal_stage, $9),
         data_completeness  = coalesce(data_completeness, $10),
         photo_reference_type = case when photo_reference_type is null then $11 else photo_reference_type end,
         photo_url          = case when photo_reference_type is null then $12 else photo_url end,
         source_attachments = case when photo_reference_type is null then $13::jsonb else source_attachments end,
         source_facts       = $14::jsonb || source_facts
       where org_id = $1 and reference = $2 and ${LIVE}
       returning opportunity_id`,
      [ctx.orgId, deal.reference, propertyId, deal.market, deal.sourcing, deal.brokerName, deal.sourceContactName,
       deal.sizeSqft, deal.dealStage, deal.dataCompleteness, p.type, p.url, JSON.stringify(p.attachments),
       JSON.stringify(deal.sourceFacts)]);
    // The row was found live a moment ago in this transaction; if the update touched anything else,
    // something is badly wrong and the run must stop rather than carry on.
    if (updated.rows.length !== 1) throw new Error(`seed update for ${deal.reference} touched ${updated.rows.length} rows, expected 1`);
    outcome = "updated";
  } else {
    const ins = await tx.query<{ opportunity_id: string }>(
      `insert into opportunities(
         org_id, reference, property_id, name, market, asset_type, currency,
         source, source_type, broker_name, source_contact_name, size_sqft, deal_stage,
         photo_reference_type, photo_url, source_attachments, data_completeness, source_facts,
         stage, status, created_by, owner_user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,
               'new','active',$19,null)
       returning opportunity_id`,
      [ctx.orgId, deal.reference, propertyId, deal.name, deal.market, deal.assetType, deal.money.currency,
       deal.sourcing, deal.sourceType, deal.brokerName, deal.sourceContactName, deal.sizeSqft, deal.dealStage,
       p.type, p.url, JSON.stringify(p.attachments), deal.dataCompleteness, JSON.stringify(deal.sourceFacts),
       ctx.userId]);
    opportunityId = ins.rows[0].opportunity_id;
    outcome = "created";
  }

  // ---- Building facts: fill what is blank, never overwrite what is there ----
  const f = deal.property;
  await tx.query(
    `update properties set
       heritage_status        = coalesce(heritage_status, $2),
       tenure                 = coalesce(tenure, $3),
       unexpired_term_years   = coalesce(unexpired_term_years, $4),
       ground_rent_pa         = coalesce(ground_rent_pa, $5),
       ground_rent_note       = coalesce(ground_rent_note, $6),
       wault_to_expiry_years  = coalesce(wault_to_expiry_years, $7),
       wault_to_breaks_years  = coalesce(wault_to_breaks_years, $8),
       covenant_rating        = coalesce(covenant_rating, $9),
       rent_review_mechanism  = coalesce(rent_review_mechanism, $10),
       epc_rating             = coalesce(epc_rating, $11),
       transport_connectivity = coalesce(transport_connectivity, $12)
     where property_id = $1`,
    [propertyId, f.heritageStatus, f.tenure, f.unexpiredTermYears, f.groundRentPa, f.groundRentNote,
     f.waultToExpiryYears, f.waultToBreaksYears, f.covenantRating, f.rentReviewMechanism, f.epcRating,
     f.transportConnectivity]);

  // ---- Money: the investment case, and only if there is something to put in it ----
  const m = deal.money;
  if (m.guidePrice !== null || m.niyPct !== null || m.passingRent !== null) {
    const c = await tx.query<{ case_id: string; status: string }>(
      "select case_id, status from investment_cases where opportunity_id = $1 and version = 1", [opportunityId]);
    if (c.rows[0]) {
      // An approved or superseded case is a decision: never touched. A working one is filled where blank.
      if (c.rows[0].status === "draft" || c.rows[0].status === "current") {
        await tx.query(
          `update investment_cases set
             acquisition_price   = coalesce(acquisition_price, $2),
             entry_yield_pct     = coalesce(entry_yield_pct, $3),
             gross_rental_income = coalesce(gross_rental_income, $4)
           where case_id = $1`, [c.rows[0].case_id, m.guidePrice, m.niyPct, m.passingRent]);
      }
    } else {
      await tx.query(
        `insert into investment_cases(org_id, opportunity_id, version, status, created_by,
           acquisition_price, entry_yield_pct, gross_rental_income)
         values ($1,$2,1,'current',$3,$4,$5,$6)`,
        [ctx.orgId, opportunityId, ctx.userId, m.guidePrice, m.niyPct, m.passingRent]);
    }
  }

  // ---- Timeline ----
  if (outcome === "created") {
    await recordEvent(tx, {
      orgId: ctx.orgId, propertyId, opportunityId, eventType: "first_seen",
      headline: "Recorded from broker material", detail: deal.sourcing,
      sourceKind: deal.sourceKind, createdBy: ctx.userId,
    });
  }

  return { reference: deal.reference, outcome, opportunityId, propertyId, propertyUnkeyed: identityKey === null, collisions };
}
