// ============================================================================
// Which Gmail threads may be linked to a deal, and which must never be.
// ============================================================================
import { describe, it, expect } from "vitest";
import { classifyThread } from "@/lib/ingestion/pipeline-workbook";
import { gmailThreadUrl } from "@/lib/data/email-threads";

describe("classifyThread", () => {
  it("marks junk and owned assets as never linkable", () => {
    // Both are real entries on the Mail Map tab. The second matters most: the
    // matcher originally paired 16 Conduit Street with 9 Conduit Street
    // (LON-052) on a shared street name, and that match was withdrawn.
    expect(classifyThread("Multi / admin", "JUNK - Google security alert, mislabelled Amsterdam"))
      .toBe("not_a_deal");
    expect(classifyThread("Multi / admin", "16 Conduit Street - Meiji-owned asset, not a pipeline deal"))
      .toBe("not_a_deal");
  });

  it("separates correspondence that is not a deal from firm-level threads", () => {
    expect(classifyThread("Multi / admin", "Market report, not a deal")).toBe("market_report");
    expect(classifyThread("Multi / admin", "Intro call admin, not a deal")).toBe("admin");
    expect(classifyThread("Multi / admin", "Firm-level or multi-deal thread - assign by hand"))
      .toBe("firm_level");
  });

  it("keeps a real property that is not among the loaded deals", () => {
    // Kept rather than deleted: an unmatched thread names a deal the sheet is
    // missing, which is worth knowing. It is not auto-created either.
    expect(classifyThread("Unmatched", "Property not found in the 132")).toBe("unmatched");
  });

  it("defaults an unannotated multi/admin thread to firm-level, never to a deal", () => {
    expect(classifyThread("Multi / admin", null)).toBe("firm_level");
  });
});

describe("gmailThreadUrl", () => {
  it("deep-links through #all so an archived thread still resolves", () => {
    // Most of a year-old broker corpus has been archived; #inbox would 404.
    expect(gmailThreadUrl("19e4398e1c3d4bf1"))
      .toBe("https://mail.google.com/mail/u/0/#all/19e4398e1c3d4bf1");
  });

  it("escapes the id rather than trusting it into a URL", () => {
    expect(gmailThreadUrl("a b/c")).toBe("https://mail.google.com/mail/u/0/#all/a%20b%2Fc");
  });
});
