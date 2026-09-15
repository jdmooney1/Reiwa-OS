// ============================================================================
// Opportunities data layer — database-backed CRUD, stage & status transitions.
// Every call runs under withSession, so RLS enforces org isolation + write scope.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";
import type {
  Opportunity, OppStage, OppStatus, OppPriority, SourceType,
} from "@/lib/data/opportunity-types";

export { OPP_STAGES, SOURCE_TYPES } from "@/lib/data/opportunity-types";
export type {
  Opportunity, OppStage, OppStatus, OppPriority, SourceType,
} from "@/lib/data/opportunity-types";

function mapOpp(r: Record<string, any>): Opportunity {
  return {
    opportunityId: r.opportunity_id, orgId: r.org_id, propertyId: r.property_id ?? null,
    name: r.name, market: str(r.market), submarket: str(r.submarket), assetType: r.asset_type,
    strategy: str(r.strategy), stage: r.stage, status: r.status, currency: r.currency,
    targetPrice: num(r.target_price), niy: num(r.niy), reversionaryYield: num(r.reversionary_yield),
    passingRent: num(r.passing_rent), erv: num(r.erv), capexBudget: num(r.capex_budget),
    targetIrr: num(r.target_irr), equityMultiple: num(r.equity_multiple), probability: num(r.probability),
    source: str(r.source), sourceType: r.source_type as SourceType,
    sourceContactName: str(r.source_contact_name), sourceContactEmail: str(r.source_contact_email),
    sourcedAt: str(r.sourced_at), referralNote: str(r.referral_note),
    brokerName: str(r.broker_name), vendorName: str(r.vendor_name),
    priority: r.priority as OppPriority,
    ownerUserId: r.owner_user_id ?? null, ownerName: str(r.owner_name),
    nextMilestone: str(r.next_milestone), nextMilestoneDate: str(r.next_milestone_date),
    lastMaterialUpdateAt: r.last_material_update_at ?? null,
    sizeSqft: num(r.size_sqft), sizeSqm: num(r.size_sqm), summary: str(r.summary),
    address: str(r.address), city: str(r.city), country: str(r.country),
    createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at ?? null,
    assetId: r.asset_id ?? null,
  };
}

const SELECT = `
  select o.*, p.address, p.city, p.country, a.asset_id,
         coalesce(owner.name, owner.email) as owner_name
  from opportunities o
  left join properties p on p.property_id = o.property_id
  left join assets a on a.opportunity_id = o.opportunity_id
  left join profiles owner on owner.user_id = o.owner_user_id`;

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
 * Create a property (neutral identity) + opportunity, atomically.
 *
 * Any headline economics supplied at origination open UNDERWRITING VERSION 1
 * rather than being written onto the opportunity row. That is the whole point
 * of Phase 1A: the first number anybody types about an investment is already a
 * version of the underwriting, authored and dated, not a loose field that the
 * real model later contradicts. The projection trigger fills the opportunity's
 * (now derived) headline columns from it.
 *
 * An opportunity logged with no figures gets no case, which is correct — it has
 * not been underwritten yet.
 */
export async function createOpportunity(session: Session, input: NewOpportunity): Promise<string> {
  return withSession(session, async (tx) => {
    const prop = await tx.query<{ property_id: string }>(
      `insert into properties(org_id, name, city, country, market, asset_type)
       values ($1,$2,$3,$4,$5,$6) returning property_id`,
      [input.orgId, input.name, input.city ?? null, input.country ?? null, input.market ?? null, input.assetType ?? "other"]);
    const opp = await tx.query<{ opportunity_id: string }>(
      `insert into opportunities(org_id, property_id, name, market, submarket, asset_type, strategy, currency,
         source, broker_name, vendor_name, probability, summary,
         owner_user_id, created_by, stage, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'new','active')
       returning opportunity_id`,
      [input.orgId, prop.rows[0].property_id, input.name, input.market ?? null, input.submarket ?? null,
       input.assetType ?? "other", input.strategy ?? null, input.currency ?? "GBP",
       input.source ?? null, input.brokerName ?? null, input.vendorName ?? null,
       input.probability ?? null, input.summary ?? null,
       // Owner is a choice and may be unassigned; author is a fact and is not.
       input.ownerUserId ?? null, session.userId]);
    const opportunityId = opp.rows[0].opportunity_id;

    const economics: [string, number | null | undefined][] = [
      ["acquisition_price", input.targetPrice],
      ["entry_yield_pct", input.niy],
      ["capex", input.capexBudget],
      ["target_irr", input.targetIrr],
    ];
    const given = economics.filter(([, v]) => v !== null && v !== undefined);
    if (given.length > 0) {
      const cols = given.map(([c]) => c);
      const vals = given.map(([, v]) => v);
      // $1 org_id, $2 opportunity_id, $3 created_by, $4 strategy; economics follow.
      const start = 5;
      await tx.query(
        `insert into investment_cases(org_id, opportunity_id, version, status, created_by, strategy, ${cols.join(", ")})
         values ($1,$2,1,'current',$3,$4,${cols.map((_, i) => `$${start + i}`).join(", ")})`,
        [input.orgId, opportunityId, session.userId, input.strategy ?? null, ...vals]);
    }
    return opportunityId;
  });
}

/**
 * What may be written on the opportunity itself: identity, origination and
 * workflow. No money.
 *
 * Purchase price, yields, IRR, equity multiple, rent, ERV and capex all live on
 * the versioned investment case and are PROJECTED onto this row by a trigger
 * (migration 0009). Leaving them writable here as well is how a pipeline card
 * ends up showing a price the approved underwriting has never heard of, with no
 * way to tell which one is real.
 */
const EDITABLE: Record<string, string> = {
  name: "name", market: "market", submarket: "submarket",
  assetType: "asset_type", strategy: "strategy", currency: "currency",
  probability: "probability", source: "source", brokerName: "broker_name",
  vendorName: "vendor_name", summary: "summary",
  // Origination (Phase 1A). Deliberately a handful of columns rather than a
  // counterparty directory: a source is a few facts about how the opportunity
  // arrived, and a CRM built to hold them would be a product of its own.
  sourceType: "source_type", sourceContactName: "source_contact_name",
  sourceContactEmail: "source_contact_email", sourcedAt: "sourced_at",
  referralNote: "referral_note",
  // Workflow. `lastMaterialUpdateAt` is absent on purpose — triggers set it
  // when something material happens, so it cannot be back-dated by an edit.
  priority: "priority", nextMilestone: "next_milestone",
  nextMilestoneDate: "next_milestone_date",
};

/** Financial fields that used to be writable here. Now owned by the case. */
export const CASE_OWNED_FIELDS: Record<string, string> = {
  targetPrice: "acquisitionPrice", niy: "entryYieldPct",
  reversionaryYield: "exitYieldPct", passingRent: "grossRentalIncome",
  erv: "erv", capexBudget: "capex", targetIrr: "targetIrr",
  equityMultiple: "targetEquityMultiple",
};
export async function updateOpportunity(
  session: Session, id: string, patch: Record<string, unknown>,
): Promise<void> {
  // Refused, not silently dropped: a caller that thinks it just changed the
  // purchase price and got no error will not look again.
  const owned = Object.keys(patch).filter((k) => k in CASE_OWNED_FIELDS);
  if (owned.length > 0) {
    throw new Error(
      `${owned.join(", ")} belong to the investment case, not the opportunity. ` +
      `Create or edit an underwriting version instead ` +
      `(${owned.map((k) => CASE_OWNED_FIELDS[k]).join(", ")}).`,
    );
  }
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
