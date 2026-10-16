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
