"use server";

// ============================================================================
// Deal Inbox server actions.
// ----------------------------------------------------------------------------
// Upload and parse, confirm a mapping and import, review, promote, bulk-act.
// Every action re-derives the session server-side; nothing trusts a form field
// for identity or org scope.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { withSession } from "@/lib/db/client";
import { parseSpreadsheet, kindForFile, type Sheet } from "@/lib/ingestion/spreadsheet";
import { suggestMappings, summariseMappings, headerSignature, type ColumnMapping } from "@/lib/ingestion/mapping";
import { extractRow } from "@/lib/ingestion/rows";
import { isFieldKey, type FieldKey } from "@/lib/ingestion/fields";
import type { CurrencyCode, AreaUnit } from "@/lib/ingestion/parse-values";
import {
  createBatch, insertRows, refreshBatchCounts, refreshCandidates, setBatchStatus,
  promoteItem, promoteMany, setReviewStatus, getBatch,
  type ReviewStatus,
} from "@/lib/data/ingestion";
import { createOpportunity } from "@/lib/data/opportunities";

/** Upload cap. A broker list is kilobytes; anything near this is not one. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;

async function writeSession() {
  const auth = await requireAuth();
  if (auth.role === "investor_viewer") {
    throw new Error("Investor accounts cannot ingest opportunities.");
  }
  return auth;
}

// ---- Step 1: parse an upload and return a mapping proposal ------------------
export interface ParsePreview {
  fileName: string;
  sheetName: string;
  headers: string[];
  mappings: ColumnMapping[];
  summary: ReturnType<typeof summariseMappings>;
  /** First rows, already interpreted, so the preview shows what WILL import. */
  sampleRows: {
    cells: unknown[];
    values: Record<string, { value: unknown; confidence: number | null; notes: string[] }>;
    issues: { severity: string; code: string; message: string }[];
    identityKey: string | null;
  }[];
  totalRows: number;
  skippedLeadingRows: number;
  warnings: string[];
  headerSignature: string;
  /** Encoded so the confirm step re-parses the same grid without a re-upload. */
  grid: unknown[][];
}

export async function parseUploadAction(formData: FormData): Promise<ParsePreview> {
  await writeSession();

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file was uploaded.");
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is 15MB.`);
  }
  if (!kindForFile(file.name, file.type)) {
    throw new Error(
      `${file.name} is not a supported spreadsheet. Upload .xlsx, .xlsm, .csv or .tsv ` +
      `(legacy .xls must be re-saved as .xlsx first).`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseSpreadsheet(buffer, file.name, file.type);
  const sheet: Sheet | undefined = parsed.sheets[0];
  if (!sheet || sheet.headers.length === 0) {
    throw new Error("No readable header row was found in that file.");
  }

  const currency = (formData.get("defaultCurrency") as CurrencyCode) || undefined;
  const areaUnit = (formData.get("defaultAreaUnit") as AreaUnit) || undefined;
  const country = (formData.get("defaultCountry") as string) || undefined;

  const mappings = suggestMappings(sheet.headers);
  const sampleRows = sheet.rows.slice(0, 20).map((cells) => {
    const row = extractRow(cells, mappings, {
      defaultCurrency: currency, defaultAreaUnit: areaUnit, defaultCountry: country,
    });
    return {
      cells,
      values: Object.fromEntries(Object.entries(row.values).map(([k, v]) => [
        k, { value: v!.value, confidence: v!.confidence, notes: v!.notes },
      ])),
      issues: row.issues,
      identityKey: row.identityKey,
    };
  });

  return {
    fileName: file.name,
    sheetName: sheet.name,
    headers: sheet.headers,
    mappings,
    summary: summariseMappings(mappings),
    sampleRows,
    totalRows: sheet.rows.length,
    skippedLeadingRows: sheet.skippedLeadingRows,
    warnings: parsed.warnings,
    headerSignature: headerSignature(sheet.headers),
    grid: [sheet.headers, ...sheet.rows],
  };
}

// ---- Step 2: confirm the mapping and stage the rows -------------------------
export interface ConfirmImportInput {
  orgId: string;
  fileName: string;
  label?: string | null;
  /** header -> field key, or null to keep the column unmapped. */
  mappings: Record<string, string | null>;
  grid: unknown[][];
  defaultCurrency?: string | null;
  defaultCountry?: string | null;
  defaultAreaUnit?: "sqft" | "sqm" | null;
  saveTemplateName?: string | null;
}

export async function confirmImportAction(
  input: ConfirmImportInput,
): Promise<{ batchId: string; staged: number; needingReview: number }> {
  const auth = await writeSession();
  const session = toDbSession(auth);
  if (!input.orgId) throw new Error("An organisation is required.");
  if (!Array.isArray(input.grid) || input.grid.length < 2) {
    throw new Error("There are no rows to import.");
  }

  const [headerRow, ...dataRows] = input.grid;
  const headers = (headerRow as unknown[]).map((h) => String(h ?? ""));

  // Rebuild the mapping from the user's confirmed choices. Anything unknown is
  // treated as unmapped rather than guessed at a second time.
  const confirmed: Record<string, FieldKey | null> = {};
  for (const header of headers) {
    const chosen = input.mappings[header];
    confirmed[header] = chosen && isFieldKey(chosen) ? chosen : null;
  }
  const mappings = suggestMappings(headers, { template: confirmed });

  const rowOptions = {
    defaultCurrency: (input.defaultCurrency as CurrencyCode) ?? undefined,
    defaultAreaUnit: (input.defaultAreaUnit as AreaUnit) ?? undefined,
    defaultCountry: input.defaultCountry ?? undefined,
  };
  const rows = dataRows.map((cells) => extractRow(cells as unknown[], mappings, rowOptions));

  const result = await withSession(session, async (tx) => {
    const batchId = await createBatch(tx, {
      orgId: input.orgId,
      channel: "upload",
      kind: "spreadsheet",
      label: input.label ?? input.fileName,
      sourceFileName: input.fileName,
      defaultCurrency: input.defaultCurrency ?? null,
      defaultCountry: input.defaultCountry ?? null,
      defaultAreaUnit: input.defaultAreaUnit ?? null,
      columnMappings: confirmed,
      createdBy: auth.userId,
    });

    await setBatchStatus(tx, batchId, "parsing");
    const itemIds = await insertRows(tx, input.orgId, batchId, rows);

    // Score each staged item against what is already held, so the inbox shows
    // duplicates before anyone approves anything.
    const { rows: staged } = await tx.query<{ item_id: string; extracted: Record<string, unknown> }>(
      "select item_id, extracted from ingestion_items where batch_id = $1", [batchId]);
    for (const item of staged) {
      await refreshCandidates(tx, input.orgId, { itemId: item.item_id, extracted: item.extracted });
    }

    if (input.saveTemplateName?.trim()) {
      await tx.query(
        `insert into import_mapping_templates(org_id, name, source_hint, header_signature,
           mappings, defaults, created_by, use_count, last_used_at)
         values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,1,now())
         on conflict (org_id, name) do update
           set mappings = excluded.mappings, defaults = excluded.defaults,
               header_signature = excluded.header_signature,
               use_count = import_mapping_templates.use_count + 1,
               last_used_at = now()`,
        [input.orgId, input.saveTemplateName.trim(), input.fileName,
         headerSignature(headers), JSON.stringify(confirmed),
         JSON.stringify({
           currency: input.defaultCurrency, country: input.defaultCountry,
           areaUnit: input.defaultAreaUnit,
         }), auth.userId]);
    }

    await setBatchStatus(tx, batchId, "ready_for_review");
    await refreshBatchCounts(tx, batchId);

    const { rows: counts } = await tx.query<{ n: string }>(
      "select count(*) as n from ingestion_items where batch_id = $1 and review_status = 'needs_review'",
      [batchId]);

    return { batchId, staged: itemIds.length, needingReview: Number(counts[0].n) };
  });

  revalidatePath("/inbox");
  return result;
}

// ---- Review actions ---------------------------------------------------------
export async function promoteItemAction(
  itemId: string,
  options: { attachToOpportunityId?: string | null; attachToPropertyId?: string | null;
             overrides?: Record<string, string | number | null>; note?: string | null } = {},
): Promise<{ opportunityId: string }> {
  const auth = await writeSession();
  const overrides: Partial<Record<FieldKey, string | number | null>> = {};
  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    if (isFieldKey(key)) overrides[key] = value;
  }
  const result = await promoteItem(toDbSession(auth), itemId, {
    attachToOpportunityId: options.attachToOpportunityId ?? null,
    attachToPropertyId: options.attachToPropertyId ?? null,
    overrides,
    note: options.note ?? null,
    userId: auth.userId,
  });
  revalidatePath("/inbox");
  revalidatePath("/pipeline");
  return { opportunityId: result.opportunityId };
}

export async function setReviewStatusAction(
  itemIds: string[], status: ReviewStatus,
): Promise<{ updated: number }> {
  const auth = await writeSession();
  const updated = await setReviewStatus(toDbSession(auth), itemIds, status, auth.userId);
  revalidatePath("/inbox");
  return { updated };
}

export async function promoteManyAction(
  itemIds: string[],
): Promise<{ promoted: number; failed: { itemId: string; error: string }[] }> {
  const auth = await writeSession();
  const result = await promoteMany(toDbSession(auth), itemIds, auth.userId);
  revalidatePath("/inbox");
  revalidatePath("/pipeline");
  return { promoted: result.promoted.length, failed: result.failed };
}

// ---- Quick entry ------------------------------------------------------------
/**
 * The 20-second capture path for a deal heard on the phone. Everything except a
 * name is optional, and the record lands at the inbox stage like any other.
 */
export async function quickOpportunityAction(formData: FormData): Promise<{ opportunityId: string }> {
  const auth = await writeSession();
  const session = toDbSession(auth);

  const orgId = String(formData.get("orgId") || "");
  const name = String(formData.get("name") || "").trim();
  if (!orgId) throw new Error("An organisation is required.");
  if (!name) throw new Error("A property or opportunity name is required.");

  const numeric = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim();
    if (!raw) return null;
    const cleaned = raw.replace(/[£€$¥,\s%]/g, "");
    const multiplier = /m$/i.test(raw) ? 1_000_000 : /k$/i.test(raw) ? 1_000 : 1;
    const n = Number(cleaned.replace(/[mk]$/i, ""));
    return Number.isFinite(n) ? n * multiplier : null;
  };
  const text = (key: string): string | null => String(formData.get(key) ?? "").trim() || null;

  const opportunityId = await createOpportunity(session, {
    orgId,
    name,
    address: text("address"),
    postcode: text("postcode"),
    city: text("city"),
    market: text("city"),
    currency: text("currency") ?? "GBP",
    targetPrice: numeric("price"),
    niy: numeric("yield"),
    brokerName: text("broker"),
    source: text("source") ?? "Quick entry",
    summary: text("note"),
    ownerUserId: auth.userId,
  });

  // Passing income is not a createOpportunity input; set it directly so the
  // quick path does not silently drop a figure the user typed.
  const income = numeric("income");
  if (income != null) {
    await withSession(session, (tx) =>
      tx.query("update opportunities set passing_rent = $2 where opportunity_id = $1",
        [opportunityId, income]));
  }

  revalidatePath("/pipeline");
  revalidatePath("/inbox");
  return { opportunityId };
}

export async function getBatchAction(batchId: string) {
  const auth = await requireAuth();
  return getBatch(toDbSession(auth), batchId);
}
