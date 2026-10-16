"use server";

// ============================================================================
// New deal from a teaser: drop, read, review, create. STAFF ONLY.
// ----------------------------------------------------------------------------
// Four steps, each its own action, so a person sits between the model and the
// database:
//
//   1. prepareTeaserUploadAction  mints a single-use upload URL for a path the
//                                 server chose (intake/<user>/<uuid>.<ext>).
//   2. readTeaserAction           reads that file with the model and returns a
//                                 typed reading plus any deal already in the
//                                 pipeline that looks like the same building.
//                                 WRITES NOTHING to the database.
//   3. createDealFromTeaserAction takes the person's REVIEWED reading, re-checks
//                                 it against the schema, maps it to a seed
//                                 record and lets parseDealSeed() refuse or
//                                 accept it, then creates the draft through the
//                                 same seedDeal() the command-line loader uses:
//                                 stage new, untriaged, owned by nobody, no
//                                 publication. The teaser is filed on the deal
//                                 as an internal Broker Brochure document in the
//                                 SAME transaction.
//      attachTeaserToDealAction   the alternative when the deal already exists:
//                                 file the teaser on it and create nothing.
//   4. discardTeaserAction        removes the intake file.
//
// Nothing here can publish, share or reach an investor: the imports are the
// specification, and tests/unit/teaser-intake-boundaries.test.ts holds them.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireStaffSession } from "@/lib/auth/admin";
import { AppError, assertSafeForDisplay } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import { withSession, type Queryable } from "@/lib/db/client";
import { isUuid } from "@/lib/data/portal-feed";
import { parseDealSeed } from "@/lib/ingestion/deal-seed";
import { similarNames, type Collision } from "@/lib/data/deal-seed";
import { createIntakeDeal, IntakeOrgError, TEASER_CATEGORY, type IntakeDealOutcome } from "@/lib/data/teaser-intake";
import { recordDocumentOn } from "@/lib/data/opportunity-documents";
import { titleFromFileName } from "@/lib/documents/suggest-title";
import { safeFileName } from "@/lib/documents/constraints";
import {
  TeaserExtractionSchema, toSeedRecord, intakeReference, uploadIdOf, emptyExtraction, rangeProblems,
  type TeaserExtraction,
} from "@/lib/teaser-intake/schema";
import { declaredIntakeType, maxBytesFor, tooLargeMessage } from "@/lib/teaser-intake/files";
import {
  createIntakeUpload, readIntakeObject, promoteIntakeObject, removeIntakeObject, removePromotedObject,
  sweepStaleIntake,
} from "@/lib/teaser-intake/intake-store";
import { extractTeaser, INTAKE_MODEL } from "@/lib/teaser-intake/extract";
import { teaserUnderwriting } from "@/lib/teaser-intake/underwriting";

/** A deal already in the pipeline that may be the same building. Safe to show. */
export interface PossibleMatch {
  opportunityId: string;
  name: string;
  reference: string | null;
  brokerName: string | null;
  price: number | null;
  currency: string | null;
  why: "same_property" | "similar_name";
}

// ---- 1. Upload --------------------------------------------------------------
export interface PrepareResult { error?: string; path?: string; signedUrl?: string }

export async function prepareTeaserUploadAction(fileName: string, mime: string, size: number): Promise<PrepareResult> {
  const { db } = await requireStaffSession();
  if (!db.canWrite) return { error: "Your account cannot create deals." };
  let out: PrepareResult = {};
  const r = await runAction("teaserIntake.prepare", {}, async () => {
    const type = declaredIntakeType(String(fileName ?? ""), String(mime ?? ""));
    if (!type) throw new AppError("Drop a PDF, PNG or JPEG of the teaser.");
    if (!Number.isFinite(size) || size <= 0) throw new AppError("The file is empty.");
    if (size > maxBytesFor(type)) throw new AppError(tooLargeMessage(type));
    await sweepStaleIntake(db.userId);
    out = await createIntakeUpload(db.userId, type);
  });
  return r.error ? { error: r.error } : out;
}

// ---- 2. Read ------------------------------------------------------------------
export interface ReadResult {
  error?: string;
  extraction?: TeaserExtraction;
  /** Set when the file could not be read by the model: the person can still fill the form by hand. */
  readError?: string;
  matches?: PossibleMatch[];
}

export async function readTeaserAction(path: string): Promise<ReadResult> {
  const { db } = await requireStaffSession();
  if (!db.canWrite) return { error: "Your account cannot create deals." };
  let out: ReadResult = {};
  const r = await runAction("teaserIntake.read", {}, async () => {
    const file = await readIntakeObject(db.userId, path);
    let extraction: TeaserExtraction;
    let readError: string | undefined;
    try {
      extraction = (await extractTeaser(file.bytes, file.type)).extraction;
    } catch (e) {
      // A reading that failed is not the end: the file is still here and the form can be filled by hand.
      if (!(e instanceof AppError)) throw e;
      extraction = emptyExtraction();
      readError = assertSafeForDisplay(e.message);
    }
    const matches = await withSession(db, (tx) => findPossibleMatches(tx, extraction));
    out = { extraction, readError, matches };
  });
  return r.error ? { error: r.error } : out;
}

/**
 * Read-only, and by NAME only: deals visible to this person whose name looks like this one.
 * An early warning on the review screen. The definitive check (same building, or similar
 * name, in the chosen organisation) is the one seedDeal() makes at creation.
 */
async function findPossibleMatches(tx: Queryable, x: TeaserExtraction): Promise<PossibleMatch[]> {
  const name = x.opportunity.name?.trim();
  if (!name) return [];
  const { rows } = await tx.query<{
    opportunity_id: string; name: string; reference: string | null; broker_name: string | null;
    target_price: string | null; currency: string | null;
  }>(`select opportunity_id, name, reference, broker_name, target_price, currency
        from opportunities where archived_at is null`);
  return rows
    .filter((o) => similarNames(o.name, name))
    .slice(0, 5)
    .map((o) => ({
      opportunityId: o.opportunity_id, name: o.name, reference: o.reference, brokerName: o.broker_name,
      price: o.target_price === null ? null : Number(o.target_price), currency: o.currency, why: "similar_name" as const,
    }));
}

// ---- 3. Create ----------------------------------------------------------------
export interface CreateInput {
  path: string;
  fileName: string | null;
  orgId: string;
  extraction: unknown;
  /** Create even though a deal for the same building is already in the pipeline. */
  allowExisting: boolean;
}

export interface CreateResult {
  error?: string;
  /** What must be fixed on the form, one line each. */
  problems?: string[];
  /** Set when the deal was held because it looks like one already in the pipeline. */
  held?: PossibleMatch[];
  opportunityId?: string;
}

export async function createDealFromTeaserAction(input: CreateInput): Promise<CreateResult> {
  const { db } = await requireStaffSession();
  if (!db.canWrite) return { error: "Your account cannot create deals." };

  let out: CreateResult = {};
  const r = await runAction("teaserIntake.create", {}, async () => {
    if (!isUuid(input.orgId)) throw new AppError("Choose the organisation the deal belongs to.");
    const checked = TeaserExtractionSchema.safeParse(input.extraction);
    if (!checked.success) throw new AppError("The reviewed details could not be read. Reload the page and drop the teaser again.");
    const x = checked.data;

    const problems = rangeProblems(x);
    // The deal's currency is recorded even when the teaser gives no figure, so it is always chosen, never assumed.
    if (!x.deal_terms.currency) problems.unshift("Choose the currency the deal is in: nothing is assumed to be GBP.");
    if (problems.length) { out = { problems }; return; }

    const uploadId = uploadIdOf(input.path);
    if (!uploadId) throw new AppError("That upload could not be found. Drop the file again.");
    const fileName = safeFileName(input.fileName ?? "") ?? null;
    // The model is recorded from the server's own setting, never from what the browser sent.
    const record = toSeedRecord(x, { fileName, model: INTAKE_MODEL });
    let deal;
    try {
      [deal] = parseDealSeed({ deals: [record] });
    } catch (e) {
      out = { problems: problemLines((e as Error).message) };
      return;
    }
    deal = { ...deal, reference: intakeReference(deal.name, uploadId) };

    // Read the file before opening the transaction: a missing or mislabelled file stops here.
    const file = await readIntakeObject(db.userId, input.path);

    let promoted: string | null = null;
    let result: IntakeDealOutcome;
    try {
      result = await withSession(db, (tx) => createIntakeDeal(tx, {
        orgId: input.orgId, userId: db.userId, allowExisting: input.allowExisting, deal, record, fileName,
        title: titleFromFileName(fileName ?? "") || "Teaser", mimeType: file.type, sizeBytes: file.bytes.byteLength,
        underwriting: teaserUnderwriting(x, { fileName }),
      }, async (opportunityId) => {
        promoted = await promoteIntakeObject(db.userId, input.path, opportunityId, file.type);
        return promoted;
      }));
    } catch (e) {
      // The transaction rolled back, so a copied file has no row: remove it.
      if (promoted) await removePromotedObject(promoted);
      if (e instanceof IntakeOrgError) throw new AppError("Choose the organisation the deal belongs to.");
      throw e;
    }
    if (result.kind === "held") {
      out = { held: await describeCollisions(db, result.collisions) };
      return;
    }
    await removeIntakeObject(db.userId, input.path);
    out = { opportunityId: result.opportunityId };
  }, { ruleMessage: "The deal could not be created." });

  if (r.error) return { error: r.error };
  if (out.opportunityId) revalidatePath("/pipeline");
  return out;
}

async function describeCollisions(db: Awaited<ReturnType<typeof requireStaffSession>>["db"], c: Collision[]): Promise<PossibleMatch[]> {
  if (c.length === 0) return [];
  const currencies = await withSession(db, async (tx) => (await tx.query<{ opportunity_id: string; currency: string | null }>(
    "select opportunity_id, currency from opportunities where opportunity_id = any($1::uuid[])",
    [c.map((x) => x.opportunityId)])).rows);
  const cur = new Map(currencies.map((r) => [r.opportunity_id, r.currency]));
  return c.map((x) => ({
    opportunityId: x.opportunityId, name: x.name, reference: x.reference, brokerName: x.brokerName,
    price: x.price, currency: cur.get(x.opportunityId) ?? null, why: x.why,
  }));
}

/** "Refusing the file (2 problems):\n  - "X": a\n  - "X": b" -> ["a", "b"], in words a person can act on. */
function problemLines(message: string): string[] {
  const lines = message.split("\n").map((l) => l.replace(/^\s*-\s*/, "").replace(/^("[^"]*"|deal #\d+): /, "").trim())
    .filter((l) => l && !/^Refusing the file/.test(l));
  return (lines.length ? lines : [message]).map((l) => l
    .replace(/opportunity\.name is required/, "A deal name is required.")
    .replace(/opportunity\.address is required.*/, "An address is required: without one the deal cannot be matched to a building.")
    .replace(/opportunity\.asset_type is required/, "Choose an asset type."))
    .map((l) => assertSafeForDisplay(l));
}

/** File the teaser on a deal that already exists, and create nothing else. */
export async function attachTeaserToDealAction(path: string, fileName: string | null, opportunityId: string): Promise<CreateResult> {
  const { db } = await requireStaffSession();
  if (!db.canWrite) return { error: "Your account cannot add documents." };
  let out: CreateResult = {};
  const r = await runAction("teaserIntake.attach", {}, async () => {
    if (!isUuid(opportunityId)) throw new AppError("That deal could not be found.");
    const file = await readIntakeObject(db.userId, path);
    const name = safeFileName(fileName ?? "") ?? null;
    let promoted: string | null = null;
    try {
      await withSession(db, async (tx) => {
        // Visibility first, under this person's own policies: nothing is copied for a deal they cannot see.
        const seen = await tx.query("select 1 from opportunities where opportunity_id = $1", [opportunityId]);
        if (!seen.rows[0]) throw new AppError("That deal could not be found.");
        promoted = await promoteIntakeObject(db.userId, path, opportunityId, file.type);
        await recordDocumentOn(tx, db.userId, opportunityId, {
          title: titleFromFileName(name ?? "") || "Teaser",
          storagePath: promoted, category: TEASER_CATEGORY, fileName: name,
          mimeType: file.type, sizeBytes: file.bytes.byteLength,
        });
      });
    } catch (e) {
      if (promoted) await removePromotedObject(promoted);
      throw e;
    }
    await removeIntakeObject(db.userId, path);
    out = { opportunityId };
  });
  if (r.error) return { error: r.error };
  revalidatePath(`/opportunities/${opportunityId}`, "layout");
  return out;
}

// ---- 4. Discard ---------------------------------------------------------------
/** Best-effort: never throws, so a page leaving cannot surface an error. */
export async function discardTeaserAction(path: string): Promise<void> {
  try {
    const { db } = await requireStaffSession();
    await removeIntakeObject(db.userId, path);
  } catch {
    // An expired session or a storage hiccup leaves the file for the daily sweep.
  }
}
