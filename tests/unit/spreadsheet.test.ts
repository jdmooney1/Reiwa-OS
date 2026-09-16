import { describe, it, expect } from "vitest";
// gridToSheet / detectHeaderRow / parseCsv are pure; parseExcel needs Node and
// is exercised in the fixture test below via a real generated workbook.
import { gridToSheet, detectHeaderRow, kindForFile } from "@/lib/ingestion/spreadsheet";

describe("detectHeaderRow - real broker spreadsheets are messy", () => {
  it("finds the header row under a title and a blank row", () => {
    const grid = [
      ["Knight Frank - Central London Investment List", "", "", ""],
      ["Week commencing 14 September 2026", "", "", ""],
      ["", "", "", ""],
      ["Property", "Address", "Guide Price", "Passing Rent"],
      ["16 Conduit Street", "16 Conduit St, W1S 2XJ", "£12,500,000", "£540,000"],
    ];
    expect(detectHeaderRow(grid)).toBe(3);
  });

  it("uses row 1 when the file is already tidy", () => {
    const grid = [
      ["Property", "Address", "Guide Price"],
      ["16 Conduit Street", "16 Conduit St", "£12,500,000"],
    ];
    expect(detectHeaderRow(grid)).toBe(0);
  });

  it("prefers a textual distinct row over a numeric one", () => {
    const grid = [
      ["1", "2", "3", "4"],
      ["Property", "Address", "Guide Price", "Yield"],
      ["16 Conduit Street", "W1S 2XJ", "12500000", "4.12"],
    ];
    expect(detectHeaderRow(grid)).toBe(1);
  });

  it("does not mistake a repeated header further down for the real one", () => {
    const grid = [
      ["Property", "Price"],
      ["16 Conduit Street", "£12.5m"],
      ["Property", "Price"],
      ["22 Grosvenor Street", "£18.5m"],
    ];
    expect(detectHeaderRow(grid)).toBe(0);
  });
});

describe("gridToSheet", () => {
  const grid = [
    ["Savills Investment List", "", "", "", ""],
    ["", "", "", "", ""],
    ["Property", "Guide", "", "EPC", ""],
    ["16 Conduit Street", "£12,500,000", "note", "C", ""],
    ["", "", "", "", ""],
    ["22 Grosvenor Street", "£18,500,000", "", "B", ""],
  ];
  const sheet = gridToSheet("Sheet1", grid);

  it("skips the leading title rows and reports how many", () => {
    expect(sheet.headerRowIndex).toBe(2);
    expect(sheet.skippedLeadingRows).toBe(2);
  });

  it("names a blank header rather than dropping its column", () => {
    expect(sheet.headers).toEqual(["Property", "Guide", "Column 3", "EPC"]);
  });

  it("trims trailing empty columns but keeps interior ones", () => {
    expect(sheet.headers).toHaveLength(4);
    expect(sheet.rows[0]).toHaveLength(4);
    expect(sheet.rows[0][2]).toBe("note");
  });

  it("drops fully blank spacer rows", () => {
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[1][0]).toBe("22 Grosvenor Street");
  });

  it("handles an empty grid without throwing", () => {
    const empty = gridToSheet("Empty", []);
    expect(empty.headers).toEqual([]);
    expect(empty.rows).toEqual([]);
  });
});

describe("kindForFile", () => {
  it("recognises the formats it supports", () => {
    expect(kindForFile("list.xlsx")).toBe("excel");
    expect(kindForFile("list.XLSM")).toBe("excel");
    expect(kindForFile("list.csv")).toBe("csv");
    expect(kindForFile("list.tsv")).toBe("csv");
  });
  it("refuses legacy .xls rather than half-supporting it", () => {
    expect(kindForFile("old.xls")).toBeNull();
  });
  it("falls back to the mime type", () => {
    expect(kindForFile("download", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
      .toBe("excel");
    expect(kindForFile("download", "text/csv")).toBe("csv");
  });
  it("returns null for an unsupported type", () => {
    expect(kindForFile("brochure.pdf")).toBeNull();
  });
});
