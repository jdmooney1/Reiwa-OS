// ============================================================================
// Pipeline import — loads Reiwa Capital's live deal pipeline into `opportunities`.
// ----------------------------------------------------------------------------
// Sources:
//   * data/sheet-snapshot.json — normalised snapshot of the Drive "Pipeline"
//     sheet (London + Amsterdam tabs). Broker-quoted figures, not underwriting.
//   * CURATED_DEALS below — deals worked on outside the sheet, plus stage /
//     figure overrides for deals that have progressed past first look.
//
// Idempotent: every row carries a stable `reference` (e.g. LDN-58-queens-gate)
// and is matched on (org_id, reference). Re-running refreshes the broker facts
// but NEVER touches stage, status or owner once a row exists — progression made
// inside Reiwa OS always wins over the spreadsheet.
// ============================================================================
import type { Queryable } from "@/lib/db/client";
import snapshot from "./data/sheet-snapshot.json";

export const REIWA_ORG_NAME = "Reiwa Capital";

export interface SheetRow {
  reference: string;
  name: string;
  market: string;
  city: string;
  country: string;
  address: string | null;
  submarket: string | null;
  assetType: string;
  strategy: string | null;
  strategyLabel: string | null;
  currency: string;
  targetPrice: number | null;
  brokerName: string | null;
  offMarket: boolean;
  imReceived: boolean;
  listedOn: string | null;
  sizeSqft: number | null;
  sizeSqm: number | null;
  passingRent: number | null;
  headlineYield: number | null;
  comments: string | null;
}

export type Stage = "new" | "screening" | "underwriting" | "ic" | "approved" | "acquired";
export type Status = "active" | "rejected" | "withdrawn" | "lost" | "converted";

/** One row ready for the database. */
export interface PipelineRecord {
  reference: string;
  name: string;
  market: string;
  submarket: string | null;
  city: string;
  country: string;
  address: string | null;
  assetType: string;
  strategy: string | null;
  stage: Stage;
  status: Status;
  currency: string;
  targetPrice: number | null;
  source: string | null;
  brokerName: string | null;
  vendorName: string | null;
  sizeSqft: number | null;
  sizeSqm: number | null;
  passingRent: number | null;
  niy: number | null;
  summary: string | null;
  listedOn: string | null;
}

type Curated = Partial<PipelineRecord> & { reference: string; notes?: string };

/**
 * Deals with context beyond the sheet. Figures are only filled where they are on
 * record; everything else stays null rather than being estimated.
 */
export const CURATED_DEALS: Curated[] = [
  {
    reference: "LDN-58-queens-gate",
    stage: "underwriting",
    address: "58 Queen's Gate, South Kensington, London SW7",
    vendorName: "Halsdon Ltd (UK SPV)",
    targetPrice: 11_650_000,
    passingRent: 449_637,
    sizeSqm: 747,
    sizeSqft: 8041,
    niy: 3.86,
    notes:
      "Freehold, 6 flats (4x 2-bed, 1x 1-bed, 1x 4-bed) with lift. Targeted via SPV share purchase. " +
      "Purchase price per IM deck £11.65m vs £12.0m guide. Cash flow model at v12 (depreciation-led), £10m senior " +
      "debt case; v8/v9 prepared for board meeting.",
  },
  {
    reference: "AMS-magna-plaza",
    stage: "underwriting",
    address: "Nieuwezijds Voorburgwal 182, Amsterdam",
    notes:
      "Former Main Post Office, neo-Gothic rijksmonument on Dam Square. 26-slide investor memorandum + 22-slide " +
      "underwriting appendix drafted. Lead concepts: luxury maison flagship / members' club-hospitality hybrid; " +
      "managed workspace, F&B and basement wellness as executing structure. Verify Amsterdam hotel moratorium before " +
      "underwriting. Execution via Forma Developments. NB sheet size (5,589 m²) differs from memo (~15,000 m² GFA) - reconcile.",
  },
  {
    reference: "LDN-28-pavilion-road",
    name: "28 Pavilion Road",
    market: "London",
    submarket: "Knightsbridge",
    city: "London",
    country: "United Kingdom",
    address: "28 Pavilion Road, Knightsbridge, London SW1X",
    assetType: "hotel",
    strategy: "development",
    stage: "screening",
    currency: "GBP",
    notes:
      "Freehold island site with implemented hotel planning consent. Pitch deck produced positioning Reiwa as " +
      "capital arranger via PropCo / OpCo / DevCo. Next: underwriting model with land price and RevPAR as swing inputs.",
  },
  {
    reference: "JPN-izu-heights-golf-resort",
    name: "Izu Heights Golf & Resort",
    market: "Japan",
    submarket: "Izu Peninsula",
    city: "Shizuoka",
    country: "Japan",
    assetType: "other",
    stage: "screening",
    currency: "JPY",
    sizeSqm: 841_000,
    notes: "Golf and resort estate, 84.1 ha on the Izu Peninsula.",
  },
  {
    reference: "BTN-queens-hotel",
    name: "Queens Hotel Brighton",
    market: "Brighton",
    submarket: "Seafront",
    city: "Brighton",
    country: "United Kingdom",
    assetType: "hotel",
    stage: "screening",
    status: "rejected",
    currency: "GBP",
    notes: "Passed: entry price discipline at guide.",
  },
  {
    reference: "BTN-dyke-road-avenue",
    name: "Dyke Road Avenue",
    market: "Brighton",
    city: "Brighton",
    country: "United Kingdom",
    assetType: "other",
    stage: "screening",
    status: "rejected",
    currency: "GBP",
    notes: "Passed: off-strategy.",
  },
];

function sheetSummary(r: SheetRow): string {
  const tags = [
    r.offMarket ? "Off-market" : "Marketed",
    r.imReceived ? "IM received" : null,
    r.strategyLabel ? `Broker strategy: ${r.strategyLabel}` : null,
  ].filter(Boolean);
  const parts = [tags.join(" · ")];
  if (r.comments) parts.push(r.comments);
  if (r.headlineYield != null) {
    parts.push("Yield shown is headline (passing income / guide price), not net of purchaser's costs.");
  }
  if (r.listedOn) parts.push(`Logged ${r.listedOn}.`);
  return parts.join(" ");
}

/** Map a sheet row onto a pipeline record (pure). */
export function fromSheet(r: SheetRow): PipelineRecord {
  return {
    reference: r.reference,
    name: r.name,
    market: r.market,
    submarket: r.submarket,
    city: r.city,
    country: r.country,
    address: r.address,
    assetType: r.assetType,
    strategy: r.strategy,
    // IM in hand = actively screening; otherwise a first-look lead.
    stage: r.imReceived ? "screening" : "new",
    status: "active",
    currency: r.currency,
    targetPrice: r.targetPrice,
    source: r.offMarket ? "Off-market" : "Marketed",
    brokerName: r.brokerName,
    vendorName: null,
    sizeSqft: r.sizeSqft,
    sizeSqm: r.sizeSqm,
    passingRent: r.passingRent,
    niy: r.headlineYield,
    summary: sheetSummary(r),
    listedOn: r.listedOn,
  };
}

/** Sheet rows + curated deals, overrides applied, one record per reference. */
export function buildPipeline(rows: SheetRow[] = snapshot.rows as SheetRow[]): PipelineRecord[] {
  const byRef = new Map<string, PipelineRecord>();
  for (const r of rows) byRef.set(r.reference, fromSheet(r));

  for (const c of CURATED_DEALS) {
    const { notes, ...fields } = c;
    const base = byRef.get(c.reference);
    const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (base) {
      const summary = [notes, base.summary].filter(Boolean).join(" ");
      byRef.set(c.reference, { ...base, ...defined, summary });
    } else {
      if (!c.name || !c.market) throw new Error(`Curated deal ${c.reference} needs a name and market`);
      byRef.set(c.reference, {
        name: c.name, market: c.market, submarket: null, city: c.city ?? c.market, country: c.country ?? "",
        address: null, assetType: "other", strategy: null, stage: "new", status: "active", currency: "GBP",
        targetPrice: null, source: "Reiwa origination", brokerName: null, vendorName: null, sizeSqft: null,
        sizeSqm: null, passingRent: null, niy: null, listedOn: null,
        ...defined, reference: c.reference, summary: notes ?? null,
      } as PipelineRecord);
    }
  }
  return [...byRef.values()];
}

export interface ImportResult {
  orgId: string;
  orgCreated: boolean;
  inserted: number;
  updated: number;
}

/**
 * Upsert the pipeline into Reiwa Capital's organisation. Runs on the privileged
 * connection (caller owns the transaction). Existing rows keep their stage,
 * status and owner.
 */
export async function importPipeline(
  db: Queryable,
  records: PipelineRecord[],
  opts: { ownerUserId?: string | null } = {},
): Promise<ImportResult> {
  let orgCreated = false;
  let org = (await db.query<{ org_id: string }>(
    "select org_id from organizations where name = $1 order by created_at limit 1", [REIWA_ORG_NAME])).rows[0];
  if (!org) {
    org = (await db.query<{ org_id: string }>(
      "insert into organizations(name, type) values ($1, 'investment_manager') returning org_id", [REIWA_ORG_NAME])).rows[0];
    orgCreated = true;
  }
  const orgId = org.org_id;
  const owner = opts.ownerUserId ?? null;
  let inserted = 0;
  let updated = 0;

  for (const r of records) {
    const existing = (await db.query<{ opportunity_id: string; property_id: string | null }>(
      "select opportunity_id, property_id from opportunities where org_id = $1 and reference = $2",
      [orgId, r.reference])).rows[0];

    const facts = [r.name, r.market, r.submarket, r.assetType, r.strategy, r.currency, r.targetPrice, r.source,
      r.brokerName, r.vendorName, r.sizeSqft, r.sizeSqm, r.passingRent, r.niy, r.summary];

    if (existing) {
      await db.query(
        `update opportunities set name=$2, market=$3, submarket=$4, asset_type=$5, strategy=$6, currency=$7,
           target_price=$8, source=$9, broker_name=$10, vendor_name=$11, size_sqft=$12, size_sqm=$13,
           passing_rent=$14, niy=$15, summary=$16
         where opportunity_id=$1`,
        [existing.opportunity_id, ...facts]);
      if (existing.property_id) {
        await db.query(
          "update properties set name=$2, address=$3, city=$4, country=$5, market=$6, asset_type=$7 where property_id=$1",
          [existing.property_id, r.name, r.address, r.city, r.country, r.market, r.assetType]);
      }
      updated++;
      continue;
    }

    const prop = (await db.query<{ property_id: string }>(
      `insert into properties(org_id, name, address, city, country, market, asset_type)
       values ($1,$2,$3,$4,$5,$6,$7) returning property_id`,
      [orgId, r.name, r.address, r.city, r.country, r.market, r.assetType])).rows[0];

    const archived = r.status === "active" ? null : new Date().toISOString();
    await db.query(
      `insert into opportunities(org_id, property_id, reference, name, market, submarket, asset_type, strategy,
         currency, target_price, source, broker_name, vendor_name, size_sqft, size_sqm, passing_rent, niy, summary,
         stage, status, archived_at, owner_user_id, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22,
         coalesce($23::date::timestamptz, now()))`,
      [orgId, prop.property_id, r.reference, ...facts, r.stage, r.status, archived, owner, r.listedOn]);
    inserted++;
  }
  return { orgId, orgCreated, inserted, updated };
}
