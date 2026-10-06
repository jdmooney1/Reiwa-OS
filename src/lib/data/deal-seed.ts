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
  why: "same_property" | "similar_name";
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

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

/** Whether two names are plausibly the same building: equal, or one contains the other (min 6 characters). */
export function similarNames(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.includes(short);
}

export async function seedDeal(tx: Queryable, ctx: SeedContext, deal: SeedDeal): Promise<SeededDeal> {
  await tx.query("savepoint seed_deal");

  const existing = await tx.query<{ opportunity_id: string; property_id: string | null }>(
    "select opportunity_id, property_id from opportunities where org_id = $1 and reference = $2",
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

  // ---- Collisions: only for a deal not already loaded by this seed ----
  const collisions: Collision[] = [];
  if (!existing.rows[0]) {
    const others = await tx.query<{ opportunity_id: string; reference: string | null; name: string; broker_name: string | null; target_price: string | null; property_id: string | null }>(
      `select opportunity_id, reference, name, broker_name, target_price, property_id
         from opportunities where org_id = $1 and archived_at is null`, [ctx.orgId]);
    for (const o of others.rows) {
      const why = o.property_id === propertyId ? "same_property" : similarNames(o.name, deal.name) ? "similar_name" : null;
      if (why) collisions.push({
        opportunityId: o.opportunity_id, reference: o.reference, name: o.name, brokerName: o.broker_name,
        price: o.target_price === null ? null : Number(o.target_price), why,
      });
    }
    if (collisions.length > 0 && !ctx.allowExisting) {
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
    await tx.query(
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
       where org_id = $1 and reference = $2`,
      [ctx.orgId, deal.reference, propertyId, deal.market, deal.sourcing, deal.brokerName, deal.sourceContactName,
       deal.sizeSqft, deal.dealStage, deal.dataCompleteness, p.type, p.url, JSON.stringify(p.attachments),
       JSON.stringify(deal.sourceFacts)]);
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
