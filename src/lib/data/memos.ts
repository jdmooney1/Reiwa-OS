// ============================================================================
// Memos - the data layer over `memos` (migration 0023) and the rows a memo is
// composed from.
// ----------------------------------------------------------------------------
// Every call runs under withSession, so RLS enforces organisation scope and write
// permission. The immutability of a final memo is NOT enforced here: the database
// refuses it (app.guard_memo), so nothing in this file can be the reason a final
// memo changed.
//
// loadMemoSource() is the ONLY place rows become a MemoSource, and it copies a
// whitelist of fields. The opportunity's address, coordinates, geocode, broker,
// vendor, source contact and triage note are never read into it (see the header
// of src/lib/memo/compose.ts for why).
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { staffNamesOn, nameOf } from "@/lib/data/directory";
import { AppError } from "@/lib/errors";
import { todayUtc } from "@/lib/data/fx-rates";
import { getOpportunity } from "@/lib/data/opportunities";
import { approvedVersion, currentVersion } from "@/lib/data/underwriting";
import { listRisks } from "@/lib/data/opportunity-risks";
import { listDdItems } from "@/lib/data/due-diligence";
import { listDecisions, effectiveDecision } from "@/lib/data/ic-decisions";
import {
  composeMemo, normaliseContent, isOverrideKey, MAX_OVERRIDE_CHARS,
  type ComposedMemo, type MemoSource, type MemoCase, type MemoOverrides, type OverrideKey,
} from "@/lib/memo/compose";
import type { UnderwritingVersion } from "@/lib/data/underwriting-types";

function toMemoCase(c: UnderwritingVersion): MemoCase {
  return {
    caseId: c.caseId, version: c.version, status: c.status, strategy: c.strategy, thesis: c.thesis,
    businessPlanAssumptions: c.businessPlanAssumptions,
    acquisitionPrice: c.acquisitionPrice, acquisitionCosts: c.acquisitionCosts, capex: c.capex,
    totalCost: c.totalCost, equity: c.equity, grossRentalIncome: c.grossRentalIncome, noi: c.noi,
    erv: c.erv, occupancyPct: c.occupancyPct, debt: c.debt, ltvPct: c.ltvPct, debtCostPct: c.debtCostPct,
    valuation: c.valuation, exitValue: c.exitValue, entryYieldPct: c.entryYieldPct,
    exitYieldPct: c.exitYieldPct, holdPeriodYears: c.holdPeriodYears, targetIrr: c.targetIrr,
    targetEquityMultiple: c.targetEquityMultiple,
  };
}

/**
 * The rows a memo is composed from, or null when this caller cannot see the
 * opportunity. The basis is the APPROVED underwriting version, else the CURRENT
 * one (flagged by the composer as unapproved), else none: an opportunity early in
 * its life still gets a memo, just a thin one.
 */
export async function loadMemoSource(session: Session, opportunityId: string): Promise<MemoSource | null> {
  const opp = await getOpportunity(session, opportunityId);
  if (!opp) return null;

  const [approved, working, risks, ddItems, decisions, fxRow] = await Promise.all([
    approvedVersion(session, opportunityId),
    currentVersion(session, opportunityId),
    listRisks(session, opportunityId),
    listDdItems(session, opportunityId),
    listDecisions(session, opportunityId),
    withSession(session, async (tx: Queryable) => {
      const { rows } = await tx.query<{ currency: string; rate_to_gbp: unknown; as_of_date: string; source: string }>(
        "select currency, rate_to_gbp, as_of_date::text, source from fx_rates where currency = $1", [opp.currency]);
      return rows[0] ?? null;
    }),
  ]);

  const basisCase = approved ?? working;
  const kind = approved ? "approved" : working ? "working" : "none";

  // The latest decision, with any amendments applied.
  let decision: MemoSource["decision"] = null;
  if (decisions[0]) {
    const eff = await effectiveDecision(session, decisions[0].decisionId);
    if (eff) {
      decision = {
        decisionDate: eff.original.decisionDate, outcome: eff.original.outcome,
        recommendation: eff.original.recommendation, conditions: eff.effectiveConditions,
        rationale: eff.effectiveRationale,
      };
    }
  }

  return {
    opportunity: {
      name: opp.name, market: opp.market, submarket: opp.submarket, city: opp.city, country: opp.country,
      assetType: opp.assetType, strategy: opp.strategy, currency: opp.currency,
      sizeSqft: opp.sizeSqft, sizeSqm: opp.sizeSqm, summary: opp.summary,
    },
    basis: { kind, case: basisCase ? toMemoCase(basisCase) : null },
    risks: risks.map((r) => ({
      riskId: r.riskId, title: r.title, category: r.category, description: r.description,
      severity: r.severity, financialImpact: r.financialImpact, mitigation: r.mitigation,
      status: r.status, sourceDdItemId: r.sourceDdItemId,
    })),
    ddItems: ddItems.map((d) => ({
      ddItemId: d.ddItemId, section: d.section, item: d.item, question: d.question, status: d.status,
      priority: d.priority, finding: d.finding, resolution: d.resolution,
    })),
    decision,
    today: todayUtc(),
    fx: fxRow ? { currency: fxRow.currency, rateToGbp: Number(fxRow.rate_to_gbp), asOf: fxRow.as_of_date, source: fxRow.source } : null,
  };
}

// ---- Stored memos ---------------------------------------------------------------

export interface StoredMemo {
  memoId: string;
  opportunityId: string;
  version: number;
  status: "draft" | "final";
  /** The composed snapshot. A copy: it does not change when the underwriting does. */
  content: ComposedMemo;
  composedAt: string;
  /** What people wrote. Kept apart from `content` so composed and typed text stay distinguishable. */
  overrides: MemoOverrides;
  createdByName: string | null;
  createdAt: string;
  finalizedByName: string | null;
  finalizedAt: string | null;
}

async function mapMemos(tx: Queryable, rows: Record<string, any>[]): Promise<StoredMemo[]> {
  const directory = await staffNamesOn(tx, rows.flatMap((r) => [r.created_by, r.finalized_by]));
  const out: StoredMemo[] = [];
  for (const r of rows) {
    const content = normaliseContent(r.content);
    if (!content) throw new Error(`memo ${r.memo_id} has content that is not a composed memo`);
    out.push({
      memoId: r.memo_id, opportunityId: r.opportunity_id, version: Number(r.version), status: r.status,
      content, composedAt: new Date(r.composed_at).toISOString(),
      overrides: (r.overrides ?? {}) as MemoOverrides,
      createdByName: nameOf(directory, r.created_by ?? null), createdAt: new Date(r.created_at).toISOString(),
      finalizedByName: nameOf(directory, r.finalized_by ?? null),
      finalizedAt: r.finalized_at ? new Date(r.finalized_at).toISOString() : null,
    });
  }
  return out;
}

/** Every version, newest first. */
export async function listMemos(session: Session, opportunityId: string): Promise<StoredMemo[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      "select * from memos where opportunity_id = $1 order by version desc", [opportunityId]);
    return mapMemos(tx, rows);
  });
}

/** The memo being worked on or last finalised: the highest version. */
export async function latestMemo(session: Session, opportunityId: string): Promise<StoredMemo | null> {
  return (await listMemos(session, opportunityId))[0] ?? null;
}

export async function getMemo(session: Session, memoId: string): Promise<StoredMemo | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>("select * from memos where memo_id = $1", [memoId]);
    return rows[0] ? (await mapMemos(tx, rows))[0] : null;
  });
}

/**
 * Start a new draft: version 1, or the next version after a final one, which
 * carries the previous memo's overrides forward (the human text is the part that
 * costs effort; the composed part is simply recomposed from today's rows).
 * `memos_single_draft` refuses a second draft.
 */
export async function createMemoDraft(
  session: Session, opportunityId: string, content: ComposedMemo,
): Promise<string> {
  return withSession(session, async (tx) => {
    const opp = await tx.query<{ org_id: string }>(
      "select org_id from opportunities where opportunity_id = $1", [opportunityId]);
    if (!opp.rows[0]) throw new AppError("That opportunity could not be found.");
    const last = await tx.query<{ version: number; status: string; overrides: unknown }>(
      "select version, status, overrides from memos where opportunity_id = $1 order by version desc limit 1", [opportunityId]);
    if (last.rows[0]?.status === "draft") throw new AppError("This opportunity already has a draft memo.");
    const version = (last.rows[0] ? Number(last.rows[0].version) : 0) + 1;
    const carried = last.rows[0] ? last.rows[0].overrides : {};
    const ins = await tx.query<{ memo_id: string }>(
      `insert into memos (org_id, opportunity_id, version, status, content, overrides, created_by)
       values ($1, $2, $3, 'draft', $4::jsonb, $5::jsonb, $6) returning memo_id`,
      [opp.rows[0].org_id, opportunityId, version, JSON.stringify(content), JSON.stringify(carried ?? {}), session.userId]);
    return ins.rows[0].memo_id;
  });
}

/** Replace a draft's composed content with a fresh composition. Overrides are untouched. */
export async function recomposeDraft(session: Session, memoId: string, content: ComposedMemo): Promise<void> {
  await withSession(session, async (tx) => {
    const { rows } = await tx.query(
      "update memos set content = $2::jsonb, composed_at = now() where memo_id = $1 and status = 'draft' returning memo_id",
      [memoId, JSON.stringify(content)]);
    if (rows.length === 0) throw new AppError("Only a draft memo can be recomposed.");
  });
}

/** Set or clear (empty text) one section's override on a draft. */
export async function setOverride(
  session: Session, memoId: string, key: OverrideKey, text: string,
): Promise<void> {
  if (!isOverrideKey(key)) throw new AppError("That is not a section of the memo.");
  if (text.length > MAX_OVERRIDE_CHARS) throw new AppError(`That text is longer than ${MAX_OVERRIDE_CHARS.toLocaleString("en-GB")} characters.`);
  const clean = text.replace(/\r\n/g, "\n").trim();
  await withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `update memos
          set overrides = case when $2 = '' then overrides - $3::text
                               else jsonb_set(overrides, array[$3::text], to_jsonb($2::text), true) end
        where memo_id = $1 and status = 'draft' returning memo_id`,
      [memoId, clean, key]);
    if (rows.length === 0) throw new AppError("Only a draft memo can be edited. A final memo is permanent: create a new version.");
  });
}

/** Draft to final, once. The database then freezes the row. */
export async function finalizeMemo(session: Session, memoId: string): Promise<void> {
  await withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `update memos set status = 'final', finalized_by = $2, finalized_at = now()
        where memo_id = $1 and status = 'draft' returning memo_id`, [memoId, session.userId]);
    if (rows.length === 0) throw new AppError("Only a draft memo can be finalised.");
  });
}

/** Compose the memo as it would read today, without saving anything. */
export async function composeLive(session: Session, opportunityId: string): Promise<ComposedMemo | null> {
  const src = await loadMemoSource(session, opportunityId);
  return src ? composeMemo(src) : null;
}
