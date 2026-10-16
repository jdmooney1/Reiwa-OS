// ============================================================================
// Creating a draft deal from a reviewed teaser, inside the caller's transaction.
// ----------------------------------------------------------------------------
// The deal itself is made by seedDeal(), exactly as the command-line loader
// makes one: stage new, active, untriaged, owned by nobody, its money on a
// version-1 investment case, and HELD (nothing written) when a deal for the same
// building is already in the pipeline. This file adds only the provenance the
// loader also keeps (a deal_load batch and the record verbatim) and the teaser
// itself, filed as an INTERNAL document in the same commit, so a deal never
// exists without the file it was read from, nor a file without its deal.
//
// The storage copy is handed in as `fileIt`, so this runs, and is tested,
// against Postgres alone.
// ============================================================================
import type { Queryable } from "@/lib/db/client";
import type { SeedDeal } from "@/lib/ingestion/deal-seed";
import { seedDeal, type Collision } from "@/lib/data/deal-seed";
import { recordDocumentOn } from "@/lib/data/opportunity-documents";
import { hasUnderwriting, type TeaserUnderwriting } from "@/lib/teaser-intake/underwriting";

/** The category a teaser is filed under on the deal (lib/documents/catalog.ts). */
export const TEASER_CATEGORY = "Broker Brochure";

export interface IntakeDealInput {
  orgId: string;
  userId: string;
  allowExisting: boolean;
  deal: SeedDeal;
  /** The reviewed record exactly as the parser read it: kept verbatim with the batch. */
  record: Record<string, unknown>;
  fileName: string | null;
  title: string;
  mimeType: string;
  sizeBytes: number;
  /** What the teaser states for underwriting v1 (lib/teaser-intake/underwriting.ts). */
  underwriting?: TeaserUnderwriting;
}

export type IntakeDealOutcome =
  | { kind: "held"; collisions: Collision[] }
  | { kind: "done"; opportunityId: string; outcome: "created" | "updated"; documentId: string };

export async function createIntakeDeal(
  tx: Queryable, input: IntakeDealInput, fileIt: (opportunityId: string) => Promise<string>,
): Promise<IntakeDealOutcome> {
  // RLS decides whether this person may write to the organisation; this only makes the refusal readable.
  const org = await tx.query("select 1 from organizations where org_id = $1", [input.orgId]);
  if (!org.rows[0]) throw new IntakeOrgError();

  const seeded = await seedDeal(tx, { orgId: input.orgId, userId: input.userId, allowExisting: input.allowExisting }, input.deal);
  // seedDeal has already rolled its own work back: a held deal leaves no trace, and nothing below runs.
  if (seeded.outcome === "held") return { kind: "held", collisions: seeded.collisions };
  const opportunityId = seeded.opportunityId!;
  const outcome = seeded.outcome;

  const batch = await tx.query<{ batch_id: string }>(
    `insert into deal_load_batches(org_id, source_file, source_sheet, rows_read, rows_created, rows_updated, finished_at, created_by)
     values ($1,$2,'teaser-intake',1,$3,$4,now(),$5) returning batch_id`,
    [input.orgId, input.fileName ?? "teaser", outcome === "created" ? 1 : 0, outcome === "updated" ? 1 : 0, input.userId]);
  await tx.query(
    `insert into deal_load_rows(org_id, batch_id, reference, raw_row, outcome, opportunity_id, property_id, property_unkeyed)
     values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`,
    [input.orgId, batch.rows[0].batch_id, input.deal.reference, JSON.stringify(input.record), outcome,
     opportunityId, seeded.propertyId ?? null, seeded.propertyUnkeyed ?? false]);

  if (input.underwriting && outcome === "created") {
    await seedUnderwriting(tx, input, opportunityId, input.underwriting);
  }

  const storagePath = await fileIt(opportunityId);
  const documentId = await recordDocumentOn(tx, input.userId, opportunityId, {
    title: input.title, storagePath, category: TEASER_CATEGORY, fileName: input.fileName,
    mimeType: input.mimeType, sizeBytes: input.sizeBytes,
  });
  return { kind: "done", opportunityId, outcome, documentId };
}

/** The organisation is not one this person can write to. */
export class IntakeOrgError extends Error {
  constructor() { super("organisation not visible"); this.name = "IntakeOrgError"; }
}

/**
 * Underwriting v1 for a deal this call has just created.
 *
 * seedDeal() may already have made version 1 (from price, NIY and passing rent); that
 * version is filled where blank and given the teaser's tenancy and notes, existing keys
 * winning. Otherwise version 1 is created here, as the working version. Only ever for a
 * deal created in this transaction, so no version a person has worked on is touched.
 */
async function seedUnderwriting(tx: Queryable, input: IntakeDealInput, opportunityId: string, u: TeaserUnderwriting): Promise<void> {
  if (!hasUnderwriting(u)) return;
  const f = u.fields;
  const rationale = `From the broker teaser${input.fileName ? ` (${input.fileName})` : ""}: figures as the broker states them, not yet underwritten.`;
  const existing = await tx.query<{ case_id: string; status: string }>(
    "select case_id, status from investment_cases where opportunity_id = $1 and version = 1", [opportunityId]);
  const c = existing.rows[0];
  if (c) {
    if (c.status !== "current" && c.status !== "draft") return;
    await tx.query(
      `update investment_cases set
         acquisition_price   = coalesce(acquisition_price, $2),
         entry_yield_pct     = coalesce(entry_yield_pct, $3),
         gross_rental_income = coalesce(gross_rental_income, $4),
         erv                 = coalesce(erv, $5),
         occupancy_pct       = coalesce(occupancy_pct, $6),
         change_rationale    = coalesce(change_rationale, $7),
         assumptions         = $8::jsonb || assumptions
       where case_id = $1`,
      [c.case_id, f.acquisition_price, f.entry_yield_pct, f.gross_rental_income, f.erv, f.occupancy_pct,
       rationale, JSON.stringify(u.assumptions)]);
    return;
  }
  await tx.query(
    `insert into investment_cases(org_id, opportunity_id, version, status, created_by,
       acquisition_price, entry_yield_pct, gross_rental_income, erv, occupancy_pct, change_rationale, assumptions)
     values ($1,$2,1,'current',$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [input.orgId, opportunityId, input.userId, f.acquisition_price, f.entry_yield_pct, f.gross_rental_income,
     f.erv, f.occupancy_pct, rationale, JSON.stringify(u.assumptions)]);
}

// ---- Reading it back, for the Underwriting tab -----------------------------
export interface TeaserBrief {
  fileName: string | null;
  documentId: string | null;
  tenancy: Record<string, unknown>[];
  highlights: string[];
  otherFacts: { label: string; value: string }[];
  dataCompleteness: string | null;
  priceBasis: string | null;
  flags: { code: string; message: string }[];
}

/**
 * What the teaser said, for the deal's own staff. Null for a deal that did not come from a
 * teaser. Read under the caller's policies, so a deal they cannot see returns null.
 */
export async function getTeaserBrief(tx: Queryable, opportunityId: string): Promise<TeaserBrief | null> {
  const { rows } = await tx.query<{ facts: Record<string, any> | null; data_completeness: string | null }>(
    "select source_facts as facts, data_completeness from opportunities where opportunity_id = $1", [opportunityId]);
  const facts = rows[0]?.facts;
  if (!facts || typeof facts.teaser_intake !== "object" || facts.teaser_intake === null) return null;
  const doc = await tx.query<{ document_id: string }>(
    `select document_id from opportunity_documents
      where opportunity_id = $1 and category = $2 order by created_at limit 1`, [opportunityId, TEASER_CATEGORY]);
  const arr = <T,>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : []);
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
  const isStr = (x: unknown): x is string => typeof x === "string";
  return {
    fileName: typeof facts.teaser_intake.file_name === "string" ? facts.teaser_intake.file_name : null,
    documentId: doc.rows[0]?.document_id ?? null,
    tenancy: arr(facts.tenants, isObj),
    highlights: arr(facts.highlights, isStr),
    otherFacts: arr(facts.other_facts, isObj).filter((f) => isStr(f.label) && isStr(f.value)) as { label: string; value: string }[],
    dataCompleteness: rows[0]?.data_completeness ?? null,
    priceBasis: isObj(facts.deal_terms) && isStr(facts.deal_terms.price_basis) ? facts.deal_terms.price_basis : null,
    flags: arr(facts._loader_flags, isObj).filter((f) => isStr(f.code) && isStr(f.message)) as { code: string; message: string }[],
  };
}
