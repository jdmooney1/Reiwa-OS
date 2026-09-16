// ============================================================================
// Spreadsheet parsing — xlsx / xlsm / csv / tsv to headers and rows.
// ----------------------------------------------------------------------------
// Real broker spreadsheets are messy: a title row above the headers, a blank
// row or two, merged cells, a totals row at the bottom, trailing junk columns.
// This module finds the header row rather than assuming row 1, and hands back
// positional rows that mapping.ts and rows.ts can work with.
//
// SERVER ONLY — exceljs is a Node dependency. Never import from a client
// component.
//
// exceljs is used in preference to the `xlsx` package: at the time of writing
// the npm build of `xlsx` carries two unfixed high-severity advisories
// (prototype pollution, ReDoS) that apply directly to parsing untrusted input,
// which is exactly what this module does.
// ============================================================================
import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";

export interface Sheet {
  name: string;
  /** The chosen header row, in column order. */
  headers: string[];
  /** Data rows below the header, positionally aligned to headers. */
  rows: unknown[][];
  /** Zero-based index of the header row within the raw grid. */
  headerRowIndex: number;
  /** Rows above the header that were skipped (titles, notes, blanks). */
  skippedLeadingRows: number;
  totalRows: number;
}

export interface ParsedWorkbook {
  sheets: Sheet[];
  /** Warnings worth showing the user; never silently swallowed. */
  warnings: string[];
}

/** Guard against a decompression bomb or an accidental 200MB upload. */
export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 200;

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const rich = value as { richText?: { text: string }[]; text?: string; result?: unknown; error?: string };
    if (Array.isArray(rich.richText)) return rich.richText.map((r) => r.text).join("");
    if (typeof rich.text === "string") return rich.text;
    // A formula cell carries its computed result; the formula itself is not data.
    if (rich.result !== undefined) return cellText(rich.result);
    if (rich.error) return "";
  }
  return String(value);
};

/**
 * Score a row's plausibility as the header row.
 *
 * Headers are short, mostly textual, mostly distinct, and rarely numeric. A
 * data row scores badly on all four, which is what separates "Property | Price"
 * from "16 Conduit Street | 12500000".
 */
function headerScore(row: unknown[]): number {
  const cells = row.map(cellText).map((c) => c.trim());
  const filled = cells.filter(Boolean);
  if (filled.length < 2) return 0;

  const numericCount = filled.filter((c) => /^[\d.,%£€$\s-]+$/.test(c)).length;
  const longCount = filled.filter((c) => c.length > 60).length;
  const distinct = new Set(filled.map((c) => c.toLowerCase())).size;

  const density = filled.length / Math.max(cells.length, 1);
  const textRatio = 1 - numericCount / filled.length;
  const distinctRatio = distinct / filled.length;
  const brevity = 1 - Math.min(longCount / filled.length, 1);

  return density * 0.2 + textRatio * 0.45 + distinctRatio * 0.25 + brevity * 0.1;
}

/** Find the most plausible header row within the first `window` rows. */
export function detectHeaderRow(grid: readonly unknown[][], window = 15): number {
  let bestIndex = 0;
  let bestScore = -1;
  const limit = Math.min(grid.length, window);
  for (let i = 0; i < limit; i++) {
    const score = headerScore(grid[i]);
    // Strictly greater keeps the FIRST of equally plausible rows, which is
    // almost always the real header rather than a repeated one further down.
    if (score > bestScore) { bestScore = score; bestIndex = i; }
  }
  return bestScore <= 0 ? 0 : bestIndex;
}

/** Turn a raw grid into a Sheet, trimming padding and naming blank headers. */
export function gridToSheet(name: string, grid: readonly unknown[][]): Sheet {
  if (grid.length === 0) {
    return { name, headers: [], rows: [], headerRowIndex: 0, skippedLeadingRows: 0, totalRows: 0 };
  }

  const headerRowIndex = detectHeaderRow(grid);
  const rawHeaders = grid[headerRowIndex] ?? [];

  // Trim trailing empty columns, but keep interior blanks so positions hold.
  let width = rawHeaders.length;
  while (width > 0 && !cellText(rawHeaders[width - 1]).trim()) width--;

  const headers: string[] = [];
  for (let i = 0; i < width; i++) {
    const text = cellText(rawHeaders[i]).trim().replace(/\s+/g, " ");
    // A blank header is named rather than dropped: its column still carries
    // data that must survive into raw_payload.
    headers.push(text || `Column ${i + 1}`);
  }

  const rows: unknown[][] = [];
  for (let r = headerRowIndex + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const sliced = Array.from({ length: width }, (_, i) => row[i] ?? null);
    // Drop fully blank rows: they are spacing, not data.
    if (sliced.every((c) => !cellText(c).trim())) continue;
    rows.push(sliced);
  }

  return {
    name, headers, rows, headerRowIndex,
    skippedLeadingRows: headerRowIndex,
    totalRows: grid.length,
  };
}

// ---- Excel -----------------------------------------------------------------
export async function parseExcel(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: Sheet[] = [];
  const warnings: string[] = [];

  workbook.eachSheet((worksheet) => {
    const grid: unknown[][] = [];
    let truncated = false;

    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (grid.length >= MAX_ROWS) { truncated = true; return; }
      const values: unknown[] = [];
      // exceljs row.values is 1-based with a leading hole.
      const raw = row.values as unknown[];
      for (let c = 1; c <= Math.min(worksheet.columnCount, MAX_COLUMNS); c++) {
        values.push(raw?.[c] ?? null);
      }
      grid[rowNumber - 1] = values;
    });

    // eachRow skips gaps; fill them so indices stay truthful.
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];

    if (truncated) {
      warnings.push(`Sheet "${worksheet.name}" exceeds ${MAX_ROWS} rows and was truncated.`);
    }
    if (worksheet.columnCount > MAX_COLUMNS) {
      warnings.push(`Sheet "${worksheet.name}" has more than ${MAX_COLUMNS} columns; the rest were ignored.`);
    }

    const sheet = gridToSheet(worksheet.name, grid);
    if (sheet.headers.length > 0) sheets.push(sheet);
  });

  if (sheets.length === 0) warnings.push("No sheet in this workbook had a readable header row.");
  return { sheets, warnings };
}

// ---- CSV / TSV -------------------------------------------------------------
export function parseCsv(text: string, fileName = "CSV"): ParsedWorkbook {
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
    // Let Papa sniff the delimiter: broker exports are comma, semicolon and tab
    // in roughly equal measure, and European exports favour semicolons.
    delimiter: "",
  });

  const warnings: string[] = [];
  for (const error of result.errors.slice(0, 5)) {
    warnings.push(`Row ${(error.row ?? 0) + 1}: ${error.message}`);
  }
  if (result.errors.length > 5) {
    warnings.push(`...and ${result.errors.length - 5} further parse warnings.`);
  }

  const grid = result.data.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLUMNS));
  if (result.data.length > MAX_ROWS) {
    warnings.push(`File exceeds ${MAX_ROWS} rows and was truncated.`);
  }

  const sheet = gridToSheet(fileName, grid);
  return { sheets: sheet.headers.length ? [sheet] : [], warnings };
}

// ---- Entry point -----------------------------------------------------------
export type SpreadsheetKind = "excel" | "csv";

export function kindForFile(fileName: string, mimeType?: string | null): SpreadsheetKind | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (["xlsx", "xlsm", "xltx"].includes(ext)) return "excel";
  if (["csv", "tsv", "txt"].includes(ext)) return "csv";
  if (mimeType?.includes("spreadsheetml")) return "excel";
  if (mimeType === "text/csv" || mimeType === "text/tab-separated-values") return "csv";
  // .xls (the old binary format) is deliberately unsupported rather than
  // half-supported: exceljs cannot read it, and a silent empty import is worse
  // than a clear refusal.
  return null;
}

export async function parseSpreadsheet(
  buffer: Buffer, fileName: string, mimeType?: string | null,
): Promise<ParsedWorkbook> {
  const kind = kindForFile(fileName, mimeType);
  if (kind === "excel") return parseExcel(buffer);
  if (kind === "csv") return parseCsv(buffer.toString("utf8"), fileName);
  throw new Error(
    `Unsupported file type: ${fileName}. Upload .xlsx, .xlsm, .csv or .tsv. ` +
    `The legacy .xls format must be re-saved as .xlsx first.`);
}
