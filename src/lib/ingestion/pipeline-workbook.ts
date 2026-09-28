// ============================================================================
// The pipeline staging workbook — reader and interpreter.
// ----------------------------------------------------------------------------
// Turns the Pipeline tab into typed rows. Interpretation lives here so the
// loader can stay a transaction script, and so the rules below are unit-
// testable without a database or a file.
//
// Two rules govern everything in this module:
//
//   NEVER STORE JPY. The workbook's "Price (JPY m)" is a display formula over
//   two FX cells on the Reference tab. Reading it would freeze a rate into the
//   data and reproduce the staleness that made the spreadsheet untrustworthy.
//   Base currency and base amount only; JPY is a read-time conversion.
//
//   MISSING STAYS MISSING. 38 rows have no income. A null income is not zero
//   and does not license an imputed yield. A formula cell that evaluated to an
//   error, or to nothing, is absent — not a value.
//
// Server-side only: exceljs is a Node dependency and must never reach a client
// bundle. Deliberately NOT guarded with `server-only`, which throws outside a
// React Server Component bundle and would break the loader script — a Node CLI
// is a legitimate consumer of this module. The guard would be protecting the
// wrong boundary.
// ============================================================================
import ExcelJS from "exceljs";

export type TriageStatus = "untriaged" | "live" | "dead" | "reference";

export interface PipelineRow {
  /** LON-001 / AMS-014. The load's idempotency key. */
  ref: string;
  market: string | null;
  name: string;
  address: string | null;
  submarket: string | null;
  assetType: string | null;
  strategy: string | null;
  broker: string | null;
  offMarket: boolean | null;
  imHeld: boolean | null;
  dateReceived: string | null;
  currency: string | null;
  /** In `currency`. Never JPY. */
  priceBase: number | null;
  sizeSqm: number | null;
  /** Annual, in `currency`. Null means unknown, never zero. */
  incomeBase: number | null;
  comments: string | null;
  gmailThreadId: string | null;
  gmailConfidence: "high" | "review" | null;
  triageStatus: TriageStatus;
  triagePriority: "P1" | "P2" | "P3" | null;
  triageNote: string | null;
  /** The source row verbatim, every column, for deal_load_rows.raw_row. */
  raw: Record<string, unknown>;
}

export interface WorkbookIssue {
  ref: string;
  field: string;
  message: string;
}

export interface PipelineWorkbook {
  rows: PipelineRow[];
  issues: WorkbookIssue[];
  /** Threads named on the Mail Map tab as firm-level, admin or unmatched. */
  unassignedThreads: { category: string; market: string | null; threadId: string; subject: string | null }[];
  fx: { pair: string; rate: number }[];
}

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    const rich = v as { richText?: { text: string }[]; text?: string; result?: unknown; error?: string };
    if (rich.error) return null;
    if (Array.isArray(rich.richText)) return text(rich.richText.map((r) => r.text).join(""));
    if (typeof rich.text === "string") return text(rich.text);
    if (rich.result !== undefined) return text(rich.result);
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  // A formula that reached us unevaluated carries no value.
  if (s.startsWith("=")) return null;
  return s;
};

const number = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = text(v);
  if (s === null) return null;
  const n = Number(s.replace(/[,\s£€$¥]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** "Yes"/"No" as the workbook writes them. Anything else is unknown. */
const yesNo = (v: unknown): boolean | null => {
  const s = text(v)?.toLowerCase();
  if (s === "yes" || s === "y" || s === "true") return true;
  if (s === "no" || s === "n" || s === "false") return false;
  return null;
};

const isoDate = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  const s = text(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
};

const triage = (v: unknown): TriageStatus => {
  const s = text(v)?.toLowerCase();
  if (s === "live" || s === "dead" || s === "reference") return s;
  // Anything else - blank, or a value nobody defined - is untriaged. It is
  // never assumed live: an unreviewed spreadsheet row must not enter the
  // pipeline looking like a deal somebody has actually looked at.
  return "untriaged";
};

const priority = (v: unknown): "P1" | "P2" | "P3" | null => {
  const s = text(v)?.toUpperCase();
  return s === "P1" || s === "P2" || s === "P3" ? s : null;
};

const confidence = (v: unknown): "high" | "review" | null => {
  const s = text(v)?.toLowerCase();
  if (s === "high") return "high";
  if (s === "review") return "review";
  return null;   // "None" and blanks alike
};

export async function readPipelineWorkbook(buffer: Buffer): Promise<PipelineWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet = wb.getWorksheet("Pipeline");
  if (!sheet) throw new Error('The workbook has no "Pipeline" tab.');

  const header = (sheet.getRow(1).values as unknown[]).slice(1).map((h) => String(h ?? "").trim());
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`The Pipeline tab has no "${name}" column. Found: ${header.join(", ")}`);
    return i + 1;
  };

  const rows: PipelineRow[] = [];
  const issues: WorkbookIssue[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const ref = text(row.getCell(col("Ref")).value);
    // Rows with no Ref are the TOTAL line and the footnote beneath it.
    if (!ref) return;

    const raw: Record<string, unknown> = {};
    header.forEach((h, i) => {
      if (!h) return;
      const cell = row.getCell(i + 1).value;
      // Formula cells are stored as their formula, not a frozen result: the
      // raw row is evidence of what the sheet said, and what it said is "this
      // is derived".
      raw[h] = typeof cell === "object" && cell !== null && "formula" in (cell as object)
        ? `=${(cell as { formula: string }).formula}`
        : (cell instanceof Date ? cell.toISOString() : cell ?? null);
    });

    const currency = text(row.getCell(col("Ccy")).value);
    const priceBase = number(row.getCell(col("Price (base)")).value);
    const incomeBase = number(row.getCell(col("Income (base pa)")).value);

    if (priceBase !== null && !currency) {
      issues.push({ ref, field: "Ccy", message: "A price with no currency cannot be interpreted." });
    }

    rows.push({
      ref,
      market: text(row.getCell(col("Market")).value),
      name: text(row.getCell(col("Name")).value) ?? ref,
      address: text(row.getCell(col("Address")).value),
      submarket: text(row.getCell(col("Submarket")).value),
      assetType: text(row.getCell(col("Asset Type")).value),
      strategy: text(row.getCell(col("Strategy")).value),
      broker: text(row.getCell(col("Broker")).value),
      offMarket: yesNo(row.getCell(col("Off Market")).value),
      imHeld: yesNo(row.getCell(col("IM Held")).value),
      dateReceived: isoDate(row.getCell(col("Date Received")).value),
      currency,
      priceBase,
      sizeSqm: number(row.getCell(col("Size (sqm)")).value),
      incomeBase,
      comments: text(row.getCell(col("Comments")).value),
      gmailThreadId: text(row.getCell(col("Gmail Thread")).value),
      gmailConfidence: confidence(row.getCell(col("Mail Confidence")).value),
      triageStatus: triage(row.getCell(col("Status")).value),
      triagePriority: priority(row.getCell(col("Priority")).value),
      triageNote: text(row.getCell(col("Triage Note")).value),
      raw,
    });
  });

  // ---- Mail Map: threads that deliberately belong to no single deal --------
  const unassignedThreads: PipelineWorkbook["unassignedThreads"] = [];
  const mailMap = wb.getWorksheet("Mail Map");
  if (mailMap) {
    const mh = (mailMap.getRow(1).values as unknown[]).slice(1).map((h) => String(h ?? "").trim());
    const idx = (n: string) => mh.indexOf(n) + 1;
    mailMap.eachRow((row, n) => {
      if (n === 1) return;
      const threadId = text(row.getCell(idx("Thread ID")).value);
      if (!threadId) return;
      unassignedThreads.push({
        category: text(row.getCell(idx("Category")).value) ?? "unknown",
        market: text(row.getCell(idx("Market")).value),
        threadId,
        subject: text(row.getCell(idx("Subject")).value),
      });
    });
  }

  // ---- Reference: FX, read for the report only, never stored --------------
  const fx: { pair: string; rate: number }[] = [];
  const ref = wb.getWorksheet("Reference");
  if (ref) {
    ref.eachRow((row) => {
      const label = text(row.getCell(1).value);
      const rate = number(row.getCell(2).value);
      if (label && rate !== null && /\//.test(label)) fx.push({ pair: label, rate });
    });
  }

  return { rows, issues, unassignedThreads, fx };
}

// ---- Interpretation rules the loader applies -------------------------------
/**
 * References that name something which is not a single building and must never
 * be forced into property identity.
 *
 * A portfolio has no street address and never will; letting it fall into the
 * unkeyable bucket would file it next to "York House" as if the address were
 * merely missing, when the truth is that the question does not apply.
 */
export const NOT_A_BUILDING: Record<string, string> = {
  "LON-109": "Portfolio, not a single building - it has no one street address.",
};

export function isNotABuilding(ref: string): string | null {
  return NOT_A_BUILDING[ref] ?? null;
}

/**
 * The entry yield for underwriting version 1, or null.
 *
 * Computed ONLY when both figures are present. 38 rows have no income, and a
 * yield invented for them would be indistinguishable from one the broker
 * quoted. This is a derivation from two values recorded in the same immutable
 * case version, not a stored copy of something that moves - unlike JPY, which
 * is why JPY is never stored at all.
 */
export function entryYieldPct(price: number | null, income: number | null): number | null {
  if (price === null || income === null) return null;
  if (price <= 0) return null;
  return Number(((income / price) * 100).toFixed(4));
}
