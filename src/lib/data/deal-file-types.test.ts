import { describe, expect, it } from "vitest";
import {
  computeProgress, criticalOpenItems, isDdCleared, isDdIssue, isDdOpen,
  DD_STATUS_ORDER, type DdItem, type DdStatus,
} from "@/lib/data/deal-file-types";

function item(over: Partial<DdItem> = {}): DdItem {
  return {
    itemId: Math.random().toString(36).slice(2),
    opportunityId: "opp",
    section: "Tenure and Ownership",
    item: "Title",
    question: null,
    jurisdiction: "UK",
    priority: "medium",
    status: "not_started",
    riskLevel: null,
    owner: null,
    dueDate: null,
    notes: null,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("due diligence status predicates", () => {
  it("classifies every status as exactly one of cleared, open or not applicable", () => {
    for (const status of DD_STATUS_ORDER) {
      const states = [isDdCleared(status), isDdOpen(status), status === "not_applicable"];
      expect(states.filter(Boolean), `status: ${status}`).toHaveLength(1);
    }
  });

  it("treats only an identified issue as an issue", () => {
    const issues = DD_STATUS_ORDER.filter(isDdIssue);
    expect(issues).toEqual(["issue_identified"]);
  });

  it("counts an identified issue as still open", () => {
    expect(isDdOpen("issue_identified")).toBe(true);
    expect(isDdCleared("issue_identified")).toBe(false);
  });
});

describe("computeProgress", () => {
  it("excludes not applicable items from the denominator", () => {
    const p = computeProgress([
      { status: "reviewed" }, { status: "not_started" }, { status: "not_applicable" },
    ]);
    expect(p.total).toBe(3);
    expect(p.inScope).toBe(2);
    expect(p.cleared).toBe(1);
    expect(p.pct).toBe(50);
  });

  it("reports 100 per cent when nothing is in scope, rather than dividing by zero", () => {
    expect(computeProgress([]).pct).toBe(100);
    expect(computeProgress([{ status: "not_applicable" }]).pct).toBe(100);
  });

  it("counts resolved and reviewed as cleared, and nothing else", () => {
    const statuses: DdStatus[] = [...DD_STATUS_ORDER];
    const p = computeProgress(statuses.map((status) => ({ status })));
    expect(p.cleared).toBe(2);
    expect(p.issues).toBe(1);
  });

  it("tallies each status exactly once", () => {
    const p = computeProgress([
      { status: "requested" }, { status: "requested" }, { status: "resolved" },
    ]);
    expect(p.byStatus.requested).toBe(2);
    expect(p.byStatus.resolved).toBe(1);
    expect(p.byStatus.not_started).toBe(0);
  });
});

describe("criticalOpenItems", () => {
  it("omits cleared work, however severe it was", () => {
    const items = [
      item({ status: "resolved", priority: "critical" }),
      item({ status: "reviewed", priority: "critical" }),
    ];
    expect(criticalOpenItems(items)).toHaveLength(0);
  });

  it("omits open work that is neither an issue nor high priority", () => {
    expect(criticalOpenItems([item({ status: "requested", priority: "low" })])).toHaveLength(0);
  });

  it("puts identified issues ahead of merely high-priority work", () => {
    const issue = item({ status: "issue_identified", priority: "medium", item: "Issue" });
    const high = item({ status: "requested", priority: "critical", item: "High" });
    const ranked = criticalOpenItems([high, issue]).map((i) => i.item);
    expect(ranked).toEqual(["Issue", "High"]);
  });

  it("ranks critical above high, and high risk above low, within a tier", () => {
    const critical = item({ status: "requested", priority: "critical", item: "Critical" });
    const highRisk = item({ status: "requested", priority: "high", riskLevel: "high", item: "High risk" });
    const highLow = item({ status: "requested", priority: "high", riskLevel: "low", item: "High low" });
    const ranked = criticalOpenItems([highLow, highRisk, critical]).map((i) => i.item);
    expect(ranked).toEqual(["Critical", "High risk", "High low"]);
  });
});
