// ============================================================================
// Representative test data - built BEFORE anything touches the real dataset.
// ----------------------------------------------------------------------------
// Deliberately messy, in the ways real broker spreadsheets are messy: a title
// block above the headers, blank spacer rows, mixed currencies, European
// decimal separators, hedged prices, "POA", a totals row, junk columns nothing
// maps to, and a near-duplicate of a property already in the database.
//
// Run: npx tsx tests/fixtures/make-fixtures.ts
// ============================================================================
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const MESSY_GRID: unknown[][] = [
  ["Knight Frank - Central London Investment List", null, null, null, null, null, null, null],
  ["Week commencing 14 September 2026", null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  ["Property", "Address", "Guide Price", "Passing Rent", "Cap Rate", "Broker", "EPC Band", "Vendor Solicitor"],
  ["16 Conduit Street", "16 Conduit St, Mayfair, London W1S 2XJ", "£12,500,000", "£540,000", "4.12%", "Knight Frank", "C", "Slaughter & May"],
  // Same building, different spelling and a different agent - must MATCH, not duplicate.
  ["16 Conduit Street", "16 Conduit Street, London", "c. £12.4m", "£540,000", "4.1%", "CBRE", "C", null],
  // Different building on the same street - must NOT match the above.
  ["22 Conduit Street", "22 Conduit Street, London W1S 2XJ", "£18,500,000", "£815,000", "4.4%", "CBRE", "B", null],
  [null, null, null, null, null, null, null, null],
  // European formatting and a second currency.
  ["Magna Plaza", "Nieuwezijds Voorburgwal 182, 1012 SJ Amsterdam", "€85.000.000", "€3.400.000", "4,0%", "CBRE", "A", null],
  // Price withheld - must be absent, never zero.
  ["Herengracht 124", "Herengracht 124, 1015 BT Amsterdam", "POA", "N/A", "-", "Savills", null, null],
  // No address at all - cannot be keyed, must go to review.
  ["Mayfair Asset", null, "£8,000,000", null, "3.9%", "Savills", null, null],
  // A totals row: not a property.
  ["TOTAL", null, "£136,400,000", "£5,295,000", null, null, null, null],
];

async function main() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Investment List");
  for (const row of MESSY_GRID) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  writeFileSync(join(HERE, "messy-broker-list.xlsx"), Buffer.from(buffer));

  const csv = MESSY_GRID
    .map((row) => row.map((c) => {
      const s = c === null || c === undefined ? "" : String(c);
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\n");
  writeFileSync(join(HERE, "messy-broker-list.csv"), csv, "utf8");

  console.log("wrote messy-broker-list.xlsx and messy-broker-list.csv");
}

if (process.argv[1] && process.argv[1].endsWith("make-fixtures.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
