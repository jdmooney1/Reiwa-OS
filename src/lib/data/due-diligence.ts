// ============================================================================
// Due diligence — the data layer over `opportunity_dd_items`.
// ----------------------------------------------------------------------------
// Diligence belongs to the OPPORTUNITY. It happens before acquisition, on the
// canonical pre-acquisition object; the mock version keyed it to a `deal` that
// no longer exists.
//
// The frameworks themselves are not here. They are firm IP and live in
// src/lib/dd/templates.ts (21 sections, London and Amsterdam, branched by legal
// regime); the completion maths lives in src/lib/dd/progress.ts. This file only
// persists and reads what those produce, so re-weighting the framework never
// means touching the database layer.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { str } from "@/lib/data/coerce";
import { AppError } from "@/lib/errors";
import { staffNamesOn, nameOf } from "@/lib/data/directory";
import type { DueDiligenceItem, DdStatus } from "@/types/database";
import {
  applyTemplate, defaultTemplateId, templateItemKey, type DdTemplate,
} from "@/lib/dd/templates";

/** A persisted workstream: the framework line plus what diligence found. */
export interface DdItemRecord extends DueDiligenceItem {
  ddItemId: string;
  orgId: string;
  finding: string | null;
  resolution: string | null;
  sourceDocumentId: string | null;
  ownerUserId: string | null;
  /**
   * The owner's display name, resolved through the staff directory.
   *
   * Since migration 0011 a colleague in the same organisation resolves normally.
   * Null now means only that no name is recorded against that user, which is
   * still not the same as unowned — the screen keeps the two apart.
   */
  ownerName: string | null;
  completedAt: string | null;
  templateId: string | null;
  /** Stable identity of a templated line; null for hand-added items. */
  templateItemKey: string | null;
}

function mapItem(r: Record<string, any>): DdItemRecord {
  return {
    ddItemId: r.dd_item_id, orgId: r.org_id,
    item_id: r.dd_item_id, opportunity_id: r.opportunity_id,
    section: r.section, item: r.item, question: str(r.question),
    jurisdiction: r.jurisdiction, priority: r.priority, status: r.status,
    owner: null, ownerUserId: r.owner_user_id ?? null,
    // Supplied by the caller from the staff directory, not by a column.
    ownerName: null,
    due_date: str(r.due_date), risk_level: r.risk_level ?? null,
    notes: str(r.notes), linked_documents: r.source_document_id ? [r.source_document_id] : [],
    finding: str(r.finding), resolution: str(r.resolution),
    sourceDocumentId: r.source_document_id ?? null, templateId: str(r.template_id),
    templateItemKey: str(r.template_item_key),
    completedAt: r.completed_at ?? null,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

export async function listDdItems(session: Session, opportunityId: string): Promise<DdItemRecord[]> {
  return withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query<Record<string, any>>(
      "select * from opportunity_dd_items where opportunity_id = $1 order by section, item",
      [opportunityId]);
    const directory = await staffNamesOn(tx, rows.map((r) => r.owner_user_id));
    return rows.map((r) => ({
      ...mapItem(r),
      ownerName: nameOf(directory, r.owner_user_id ?? null),
    }));
  });
}

/**
 * Instantiate a standing framework onto an opportunity.
 *
 * Applying the SAME framework twice is refused: it would double every line and
 * halve the reported completion, and a tracker that says 40% when the work is
 * 80% done is worse than one that refuses the second click.
 *
 * Applying a DIFFERENT framework is allowed and additive — a cross-border tax
 * or ESG pack is a normal thing to bring in mid-diligence. Each instantiated
 * line carries a stable `template_item_key`, unique per opportunity, so the two
 * cases are distinguished by the data rather than by a blanket ban on a second
 * application. `on conflict do nothing` makes a partially-overlapping
 * supplemental framework land cleanly instead of failing whole.
 *
 * Returns how many lines were added.
 */
export async function applyDdTemplate(
  session: Session,
  opportunityId: string,
  templateId?: DdTemplate["id"],
): Promise<number> {
  return withSession(session, async (tx) => {
    const opp = await tx.query<{ org_id: string; market: string | null }>(
      "select org_id, market from opportunities where opportunity_id = $1", [opportunityId]);
    if (!opp.rows[0]) throw new Error("Opportunity not found or not permitted");

    const chosen = templateId ?? defaultTemplateId((opp.rows[0].market ?? null) as never);

    const already = await tx.query<{ n: number }>(
      "select count(*)::int as n from opportunity_dd_items where opportunity_id = $1 and template_id = $2",
      [opportunityId, chosen]);
    if (Number(already.rows[0].n) > 0) {
      throw new AppError(`The ${chosen} due diligence framework has already been applied to this opportunity.`);
    }

    const items = applyTemplate(chosen, opportunityId);
    let added = 0;
    for (const it of items) {
      const res = await tx.query<{ dd_item_id: string }>(
        `insert into opportunity_dd_items
           (org_id, opportunity_id, section, item, question, jurisdiction, priority, status,
            risk_level, template_id, template_item_key, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (opportunity_id, template_item_key) where template_item_key is not null
           do nothing
         returning dd_item_id`,
        [opp.rows[0].org_id, opportunityId, it.section, it.item, it.question, it.jurisdiction,
         it.priority, it.status, it.risk_level, chosen,
         templateItemKey(chosen, it.section, it.item), session.userId ?? null]);
      // No row returned means this exact line already exists from an earlier
      // framework — the supplemental pack shares it rather than duplicating it.
      if (res.rows.length > 0) added += 1;
    }
    return added;
  });
}

/** Which standing frameworks have been instantiated on this opportunity. */
export async function appliedTemplates(
  session: Session, opportunityId: string,
): Promise<string[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ template_id: string }>(
      `select distinct template_id from opportunity_dd_items
        where opportunity_id = $1 and template_id is not null order by template_id`,
      [opportunityId]);
    return rows.map((r) => r.template_id);
  });
}

export interface DdItemPatch {
  status?: DdStatus;
  ownerUserId?: string | null;
  dueDate?: string | null;
  finding?: string | null;
  resolution?: string | null;
  notes?: string | null;
  riskLevel?: "low" | "medium" | "high" | null;
  priority?: "low" | "medium" | "high" | "critical";
  sourceDocumentId?: string | null;
}

const ITEM_COLUMNS: Record<keyof DdItemPatch, string> = {
  status: "status", ownerUserId: "owner_user_id", dueDate: "due_date",
  finding: "finding", resolution: "resolution", notes: "notes",
  riskLevel: "risk_level", priority: "priority", sourceDocumentId: "source_document_id",
};

/** `completed_at` is not settable: a trigger stamps it from the status. */
export async function updateDdItem(
  session: Session, ddItemId: string, patch: DdItemPatch,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(ITEM_COLUMNS) as [keyof DdItemPatch, string][]) {
    if (key in patch) { params.push(patch[key]); sets.push(`${col} = $${params.length}`); }
  }
  if (sets.length === 0) return;
  params.push(ddItemId);
  await withSession(session, (tx) =>
    tx.query(`update opportunity_dd_items set ${sets.join(", ")} where dd_item_id = $${params.length}`, params));
}

export async function addDdItem(
  session: Session,
  opportunityId: string,
  input: { section: string; item: string; question?: string | null;
           jurisdiction?: string; priority?: string; riskLevel?: string | null },
): Promise<string> {
  return withSession(session, async (tx) => {
    const opp = await tx.query<{ org_id: string }>(
      "select org_id from opportunities where opportunity_id = $1", [opportunityId]);
    if (!opp.rows[0]) throw new Error("Opportunity not found or not permitted");
    const res = await tx.query<{ dd_item_id: string }>(
      `insert into opportunity_dd_items
         (org_id, opportunity_id, section, item, question, jurisdiction, priority, risk_level, created_by)
       values ($1,$2,$3,$4,$5,coalesce($6,'UK'),coalesce($7,'medium'),$8,$9) returning dd_item_id`,
      [opp.rows[0].org_id, opportunityId, input.section, input.item, input.question ?? null,
       input.jurisdiction ?? null, input.priority ?? null, input.riskLevel ?? null, session.userId ?? null]);
    return res.rows[0].dd_item_id;
  });
}
