// ============================================================================
// A diligence workstream row must say that it can be opened.
// ----------------------------------------------------------------------------
// The status, due date, finding and resolution editor was always there, behind a
// bare button around the item text with no cursor, hover or marker, so reviewers
// did not find it. This renders the real component and holds the affordances in
// place. (The click behaviour itself was exercised in a real browser; this repo
// has no DOM test harness, so this checks what the server renders.)
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/app/actions/workspace", () => ({
  applyDdTemplateAction: async () => ({}), updateDdItemAction: async () => ({}), promoteFindingAction: async () => ({}),
}));
// react-dom@18 has no useFormState (Next ships a canary that does); a stub is enough to render.
vi.mock("react-dom", async (orig) => ({ ...(await orig<Record<string, unknown>>()), useFormState: (_a: unknown, init: unknown) => [init, () => {}] }));

import { DiligenceSection } from "@/components/workspace/diligence-section";

const item = {
  ddItemId: "a", section: "Legal", item: "Title and tenure", question: "Is title good?", status: "in_progress",
  due_date: "2026-09-15", finding: "Covenant on rear yard", resolution: null, ownerId: null, ownerName: null,
} as never;
const progress = { total: 1, inScope: 1, cleared: 0, open: 1, issues: 0, overdue: 0, pct: 0, byStatus: {} } as never;

const html = (canWrite: boolean) => renderToStaticMarkup(
  React.createElement(DiligenceSection, {
    opportunityId: "o1", items: [item], progress, critical: [], appliedTemplates: ["london"], promotedItemIds: [], canWrite,
  }));

describe("a workstream row invites a click", () => {
  const out = html(true);
  const rowButton = out.slice(out.indexOf("<button"), out.indexOf("</button>", out.indexOf("aria-expanded")));

  it("is one button that is collapsed to begin with", () => {
    expect(out).toContain('aria-expanded="false"');
    expect(rowButton).toContain("Title and tenure");
  });

  it("shows the pointer cursor and a hover state", () => {
    expect(rowButton).toContain("cursor-pointer");
    expect(rowButton).toMatch(/hover:bg-surface-sunken/);
  });

  it("carries a chevron that is set up to rotate when open", () => {
    expect(rowButton).toMatch(/<svg[^>]*lucide-chevron-right/);
    expect(rowButton).toMatch(/<svg[^>]*transition-transform/);
    // The rotation is applied only while open, so it is absent from this closed render.
    expect(rowButton).not.toContain("rotate-90");
    const source = readFileSync(join(process.cwd(), "src/components/workspace/diligence-section.tsx"), "utf8");
    expect(source).toMatch(/open && "rotate-90/);
  });

  it("says what it does: Update for an editor, View for a reader", () => {
    expect(html(true)).toMatch(/>Update</);
    expect(html(false)).toMatch(/>View</);
    expect(html(false)).not.toMatch(/>Update</);
  });

  it("still shows the status badge, the due date and the finding when closed", () => {
    expect(rowButton).toContain("In progress");
    expect(rowButton).toContain("15 Sept 2026");
    expect(rowButton).toContain("Covenant on rear yard");
  });

  it("does not render the editor until opened", () => {
    expect(out).not.toContain('name="status"');
  });
});
