// ============================================================================
// --user: a profile id or an email, and nothing else.
// No database: the classification is a property of the string.
// ============================================================================
import { describe, it, expect } from "vitest";
import { parseUserRef } from "@/lib/ingestion/user-ref";

describe("parseUserRef", () => {
  it("reads a uuid as a profile id, lower-cased", () => {
    expect(parseUserRef("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toEqual({
      kind: "id", value: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });
  });

  it("reads an address as an email, lower-cased and trimmed", () => {
    expect(parseUserRef("  JD.Mooney@Reiwa-Capital.com ")).toEqual({
      kind: "email", value: "jd.mooney@reiwa-capital.com",
    });
  });

  it("refuses a truncated uuid rather than searching for it as an email", () => {
    expect(() => parseUserRef("3f2504e0-4f89-41d3-9a0c")).toThrow(/profile id.*or an email/);
  });

  it("refuses a bare name and an empty value", () => {
    expect(() => parseUserRef("JD")).toThrow();
    expect(() => parseUserRef("")).toThrow();
  });
});
