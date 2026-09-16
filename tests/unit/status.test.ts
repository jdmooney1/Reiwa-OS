import { describe, it, expect } from "vitest";
import {
  displayStatus, canPublish, marketStatusEvent, STAGE_LABEL,
  type StatusInput,
} from "@/lib/ingestion/status";

const base: StatusInput = { stage: "screening", status: "active" };

describe("displayStatus - renders one flat label from three axes", () => {
  it("shows the Reiwa stage when nothing more decisive applies", () => {
    expect(displayStatus(base).label).toBe("Screening");
    expect(displayStatus({ ...base, stage: "inbox" }).label).toBe("New");
    expect(displayStatus({ ...base, stage: "investor_ready" }).label).toBe("Investor Ready");
  });

  it("distinguishes Reiwa passing from the vendor withdrawing", () => {
    const passed = displayStatus({ ...base, status: "rejected" });
    const pulled = displayStatus({ ...base, marketStatus: "withdrawn" });
    expect(passed.label).toBe("Pass");
    expect(pulled.label).toBe("Withdrawn");
    expect(passed.detail).not.toBe(pulled.detail);
    expect(pulled.detail).toMatch(/vendor/i);
  });

  it("distinguishes Reiwa being under offer from a third party being under offer", () => {
    const ours = displayStatus({ ...base, reiwaPosition: "under_offer" });
    const theirs = displayStatus({ ...base, marketStatus: "under_offer" });
    expect(ours.label).toBe("Reiwa under offer");
    expect(theirs.label).toMatch(/third party/i);
    expect(ours.tone).not.toBe(theirs.tone);
  });

  it("prefers Reiwa's own position over the market's", () => {
    const d = displayStatus({ ...base, marketStatus: "under_offer", reiwaPosition: "bid_submitted" });
    expect(d.label).toBe("Bid submitted");
    expect(d.axis).toBe("position");
  });

  it("keeps a sold asset visible as market intelligence", () => {
    const d = displayStatus({ ...base, marketStatus: "sold" });
    expect(d.label).toBe("Sold");
    expect(d.detail).toMatch(/market intelligence/i);
  });

  it("shows Published for a live publication", () => {
    expect(displayStatus({ ...base, isPublished: true }).label).toBe("Published");
  });

  it("shows Acquired once converted", () => {
    expect(displayStatus({ ...base, status: "converted" }).label).toBe("Acquired");
    expect(displayStatus({ ...base, stage: "acquired" }).label).toBe("Acquired");
  });

  it("archives override the stage, but keep why", () => {
    const d = displayStatus({ ...base, status: "rejected", archivedAt: "2026-09-16T00:00:00Z" });
    expect(d.label).toBe("Pass");
    expect(d.tone).toBe("muted");
  });

  it("still labels rows written before the stage extension", () => {
    expect(STAGE_LABEL.new).toBe("New");
    expect(displayStatus({ stage: "new", status: "active" }).label).toBe("New");
  });

  it("always returns a detail explaining which axis produced the label", () => {
    for (const input of [
      base,
      { ...base, status: "watchlist" as const },
      { ...base, marketStatus: "sold" as const },
      { ...base, reiwaPosition: "legals" as const },
    ]) {
      const d = displayStatus(input);
      expect(d.detail.length).toBeGreaterThan(0);
      expect(d.label.length).toBeGreaterThan(0);
    }
  });
});

describe("canPublish - the investor-ready gate", () => {
  it("blocks anything before investor ready, with a reason", () => {
    const r = canPublish({ stage: "screening", status: "active" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Investor Ready/i);
  });

  it("allows investor ready and beyond", () => {
    for (const stage of ["investor_ready", "approved", "acquired"] as const) {
      expect(canPublish({ stage, status: "active" }).allowed, stage).toBe(true);
    }
  });

  it("blocks a passed, watchlisted or archived opportunity whatever its stage", () => {
    expect(canPublish({ stage: "investor_ready", status: "rejected" }).allowed).toBe(false);
    expect(canPublish({ stage: "investor_ready", status: "watchlist" }).allowed).toBe(false);
    expect(canPublish({ stage: "investor_ready", status: "active", archivedAt: "2026-01-01" }).allowed).toBe(false);
  });
});

describe("marketStatusEvent", () => {
  it("records a relaunch when an asset returns after being withdrawn", () => {
    expect(marketStatusEvent("withdrawn", "available")).toBe("relaunched");
  });
  it("records sale and withdrawal as their own events", () => {
    expect(marketStatusEvent("available", "sold")).toBe("sold");
    expect(marketStatusEvent("available", "withdrawn")).toBe("withdrawn");
  });
  it("records nothing when the status has not moved", () => {
    expect(marketStatusEvent("available", "available")).toBeNull();
  });
});
