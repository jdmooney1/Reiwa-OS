// ============================================================================
// Opportunities data layer — database-backed CRUD, stage & status transitions.
// Every call runs under withSession, so RLS enforces org isolation + write scope.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { resolveProperty } from "@/lib/data/properties";
import { recordEvent } from "@/lib/data/property-events";
import { num, str } from "@/lib/data/coerce";
import type { Opportunity, OppStage, OppStatus } from "@/lib/data/opportunity-types";

export { OPP_STAGES } from "@/lib/data/opportunity-types";
export type {
  Opportunity, OppStage, OppStatus, MarketStatus, ReiwaPosition,
} from "@/lib/data/opportunity-types";

function mapOpp(r: Record<string, any>): Opportunity {
  return {
    opportunityId: r.opportunity_id, orgId: r.org_id, propertyId: r.property_id ?? null,
    name: r.name, market: str(r.market), submarket: str(r.submarket), assetType: r.asset_type,
    strategy: str(r.strategy), stage: r.stage, status: r.status, currency: r.currency,
    marketStatus: (r.market_status ?? "unknown") as Opportunity["marketStatus"],
    reiwaPosition: (r.reiwa_position ?? "none") as Opportunity["reiwaPosition"],
    firstSeenAt: str(r.first_seen_at), lastSourceAt: str(r.last_source_at),
    targetPrice: num(r.target_price), niy: num(r.niy), reversionaryYield: num(r.reversionary_yield),
    passingRent: num(r.passing_rent), erv: num(r.erv), capexBudget: num(r.capex_budget),
    targetIrr: num(r.target_irr), equityMultiple: num(r.equity_multiple), probability: num(r.probability),
    source: str(r.source), brokerName: str(r.broker_name), vendorName: str(r.vendor_name),
    sizeSqft: num(r.size_sqft), sizeSqm: num(r.size_sqm), summary: str(r.summary),
    address: str(r.address), city: str(r.city), country: str(r.country),
    createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at ?? null,
    assetId: r.asset_id ?? null,
  };
}

const SELECT = `
  select o.*, p.address, p.city, p.country, a.asset_id
  from opportunities o
  left join properties p on p.property_id = o.property_id
  left join assets a on a.opportunity_id = o.opportunity_id`;

export async function listOpportunities(session: Session): Promise<Opportunity[]> {
  return withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query(`${SELECT} order by o.updated_at desc`);
    return rows.map(mapOpp);
  });
}

export async function getOpportunity(session: Session, id: string): Promise<Opportunity | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(`${SELECT} where o.opportunity_id = $1`, [id]);
    return rows[0] ? mapOpp(rows[0]) : null;
  });
}

export interface NewOpportunity {
  orgId: string;
  name: string;
  /** Address and postcode drive property identity; without them nothing dedupes. */
  address?: string | null;
  postcode?: string | null;
  city?: string | null;
  country?: string | null;
  market?: string | null;
  submarket?: string | null;
  assetType?: string;
  strategy?: string | null;
  currency?: string;
  targetPrice?: number | null;
  source?: string | null;
  brokerName?: string | null;
  vendorName?: string | null;
  niy?: number | null;
  targetIrr?: number | null;
  capexBudget?: number | null;
  probability?: number | null;
  summary?: string | null;
  ownerUserId?: string | null;
}

/**
 * Resolve the property (never blindly create one) and create the opportunity,
 * atomically.
 *
 * This previously inserted a FRESH `properties` row on every call, which meant
 * the property-centric model documented in docs/10 was not actually true in the
 * data: the same building recurring in the pipeline produced unrelated records
 * with no shared history (docs/17 D1). resolveProperty() matches on the
 * identity key first, so a recurrence joins the property it belongs to.
 */
export async function createOpportunity(session: Session, input: NewOpportunity): Promise<string> {
  return withSession(session, async (tx) => {
    const resolved = await resolveProperty(tx, {
      orgId: input.orgId,
      name: input.name,
      address: input.address ?? null,
      postcode: input.postcode ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      market: input.market ?? null,
      submarket: input.submarket ?? null,
      assetType: input.assetType ?? "other",
    });
    const prop = { rows: [{ property_id: resolved.propertyId }] };
    const opp = await tx.query<{ opportunity_id: string }>(
      `insert into opportunities(org_id, property_id, name, market, submarket, asset_type, strategy, currency,
         target_price, source, broker_name, vendor_name, niy, target_irr, capex_budget, probability, summary,
         owner_user_id, created_by, stage, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,'new','active')
       returning opportunity_id`,
      [input.orgId, prop.rows[0].property_id, input.name, input.market ?? null, input.submarket ?? null,
       input.assetType ?? "other", input.strategy ?? null, input.currency ?? "GBP", input.targetPrice ?? null,
       input.source ?? null, input.brokerName ?? null, input.vendorName ?? null, input.niy ?? null,
       input.targetIrr ?? null, input.capexBudget ?? null, input.probability ?? null, input.summary ?? null,
       input.ownerUserId ?? null]);

    const opportunityId = opp.rows[0].opportunity_id;

    // The timeline starts here, not at the first import: an opportunity typed in
    // by hand is as much market intelligence as one that arrived in a
    // spreadsheet.
    await recordEvent(tx, {
      orgId: input.orgId,
      propertyId: resolved.propertyId,
      opportunityId,
      eventType: "first_seen",
      headline: resolved.created
        ? "Opportunity created in Reiwa OS"
        : "New opportunity recorded against an existing property",
      detail: input.brokerName ? `Marketed by ${input.brokerName}` : null,
      sourceKind: "reiwa_manual",
      createdBy: input.ownerUserId ?? null,
    });

    if (input.targetPrice != null) {
      await recordEvent(tx, {
        orgId: input.orgId,
        propertyId: resolved.propertyId,
        opportunityId,
        eventType: "price_quoted",
        headline: `Guide price recorded`,
        numericValue: input.targetPrice,
        currency: input.currency ?? "GBP",
        sourceKind: "reiwa_manual",
        createdBy: input.ownerUserId ?? null,
      });
    }

    return opportunityId;
  });
}

const EDITABLE: Record<string, string> = {
  name: "name", strategy: "strategy", targetPrice: "target_price", niy: "niy",
  reversionaryYield: "reversionary_yield", passingRent: "passing_rent", erv: "erv",
  capexBudget: "capex_budget", targetIrr: "target_irr", equityMultiple: "equity_multiple",
  probability: "probability", source: "source", brokerName: "broker_name",
  vendorName: "vendor_name", summary: "summary", submarket: "submarket",
  marketStatus: "market_status", reiwaPosition: "reiwa_position",
  // Stage and status also have dedicated transitions (setStage/setOutcome);
  // they are editable here so a reviewer can correct one without an archive.
  stage: "stage", status: "status",
};

export async function updateOpportunity(
  session: Session, id: string, patch: Record<string, unknown>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of Object.entries(EDITABLE)) {
    if (k in patch) { params.push(patch[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (sets.length === 0) return;
  params.push(id);
  await withSession(session, (tx) =>
    tx.query(`update opportunities set ${sets.join(", ")} where opportunity_id = $${params.length}`, params));
}

export async function setStage(session: Session, id: string, stage: OppStage): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("update opportunities set stage = $1 where opportunity_id = $2", [stage, id]));
}

/** Archive with an alternate outcome (rejected / withdrawn / lost). */
export async function setOutcome(session: Session, id: string, status: OppStatus): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("update opportunities set status = $1, archived_at = now() where opportunity_id = $2", [status, id]));
}

export async function reactivate(session: Session, id: string): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("update opportunities set status = 'active', archived_at = null where opportunity_id = $1", [id]));
}
