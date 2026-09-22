import { describe, expect, it } from "vitest";
import { DD_TEMPLATES, defaultTemplateId } from "@/lib/dd/templates";
import { DD_SECTIONS } from "@/lib/data/deal-file-types";

const templates = Object.values(DD_TEMPLATES);

describe("due diligence frameworks", () => {
  it("offers a framework for each market Reiwa currently invests in", () => {
    expect(Object.keys(DD_TEMPLATES).sort()).toEqual(["amsterdam", "london"]);
  });

  it.each(templates)("$name is complete and well formed", (t) => {
    expect(t.items.length).toBeGreaterThan(0);
    for (const line of t.items) {
      expect(line.item.trim(), JSON.stringify(line)).not.toBe("");
      expect(line.question.trim(), line.item).not.toBe("");
      // A workstream nobody can place in the memo is a workstream nobody does.
      expect(DD_SECTIONS, line.item).toContain(line.section);
    }
  });

  it.each(templates)("$name carries no duplicate workstreams", (t) => {
    const keys = t.items.map((i) => `${i.section}::${i.item}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("routes local-law questions to the local jurisdiction", () => {
    const localOf = (id: "london" | "amsterdam") =>
      DD_TEMPLATES[id].items.filter((i) => i.section === "Tenure and Ownership");
    expect(localOf("london").every((i) => i.jurisdiction === "UK")).toBe(true);
    expect(localOf("amsterdam").every((i) => i.jurisdiction === "Netherlands")).toBe(true);
  });

  it("keeps the Japan and cross-border sections in both frameworks", () => {
    for (const t of templates) {
      const sections = new Set(t.items.map((i) => i.section));
      expect(sections, t.name).toContain("Japan Rationale");
      expect(sections, t.name).toContain("Cross Border Tax and Holding Structure");
    }
  });
});

describe("defaultTemplateId", () => {
  it("picks Amsterdam only for Amsterdam", () => {
    expect(defaultTemplateId("Amsterdam")).toBe("amsterdam");
  });

  it("falls back to the London framework for anything else, including an unknown market", () => {
    expect(defaultTemplateId("London")).toBe("london");
    expect(defaultTemplateId("Brighton")).toBe("london");
    expect(defaultTemplateId(null)).toBe("london");
  });
});
