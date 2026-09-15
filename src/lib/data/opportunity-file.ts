// ============================================================================
// The opportunity file — what the workspace header and summary need, in one read.
// ----------------------------------------------------------------------------
// Assembles the opportunity with its AUTHORITATIVE underwriting version, which
// is the approved one if there is one and otherwise the current working one.
// That is the same rule the projection trigger uses (migration 0009), so the
// figures here and the figures on the pipeline can never disagree.
//
// The summary reads its metrics from the case, not from the opportunity's
// projected columns. Those columns exist only because the investor publication
// boundary reads them; nothing in this workspace should treat them as a source.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num } from "@/lib/data/coerce";
import type { Opportunity } from "@/lib/data/opportunity-types";
import type { UnderwritingVersion } from "@/lib/data/underwriting-types";
import { getOpportunity } from "@/lib/data/opportunities";
import { listVersions } from "@/lib/data/underwriting";

export interface OpportunityFile {
  opportunity: Opportunity;
  /** Approved if one exists, else the current working version, else null. */
  authoritative: UnderwritingVersion | null;
  /** Which of the two it is — the summary must say so out loud. */
  basis: "approved" | "working" | "none";
  versionCount: number;
  /** Counts used by the section nav, so a user sees where the work is. */
  counts: {
    ddOpen: number;
    ddIssues: number;
    /** Open workstreams whose due date has passed — a blocker, not a decoration. */
    ddOverdue: number;
    ddTotal: number;
    risksOpen: number;
    decisions: number;
    documents: number;
  };
}

export async function getOpportunityFile(
  session: Session, opportunityId: string,
): Promise<OpportunityFile | null> {
  const opportunity = await getOpportunity(session, opportunityId);
  if (!opportunity) return null;

  const versions = await listVersions(session, opportunityId);
  const approved = versions.find((v) => v.status === "approved") ?? null;
  const working = versions.find((v) => v.status === "current") ?? null;
  const authoritative = approved ?? working;

  const counts = await withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query<Record<string, string>>(
      `select
         (select count(*) from opportunity_dd_items
           where opportunity_id = $1
             and status not in ('reviewed','resolved','not_applicable'))       as dd_open,
         (select count(*) from opportunity_dd_items
           where opportunity_id = $1 and status = 'issue_identified')          as dd_issues,
         (select count(*) from opportunity_dd_items
           where opportunity_id = $1
             and due_date < current_date
             and status not in ('reviewed','resolved','not_applicable'))       as dd_overdue,
         (select count(*) from opportunity_dd_items where opportunity_id = $1) as dd_total,
         (select count(*) from opportunity_risks
           where opportunity_id = $1 and status = 'open')                      as risks_open,
         (select count(*) from ic_decisions where opportunity_id = $1)         as decisions,
         (select count(*) from opportunity_documents where opportunity_id = $1) as documents`,
      [opportunityId]);
    const r = rows[0];
    return {
      ddOpen: Number(r.dd_open), ddIssues: Number(r.dd_issues),
      ddOverdue: Number(r.dd_overdue), ddTotal: Number(r.dd_total),
      risksOpen: Number(r.risks_open), decisions: Number(r.decisions),
      documents: Number(r.documents),
    };
  });

  return {
    opportunity,
    authoritative,
    basis: approved ? "approved" : working ? "working" : "none",
    versionCount: versions.length,
    counts,
  };
}

// ---------------------------------------------------------------------------
/** A pipeline row: the opportunity plus the figures from its own case. */
export interface PipelineRow extends Opportunity {
  caseBasis: "approved" | "working" | "none";
  caseVersion: number | null;
  caseAcquisitionPrice: number | null;
  caseTotalCost: number | null;
  caseEntryYieldPct: number | null;
  caseTargetIrr: number | null;
  caseEquityMultiple: number | null;
}

/**
 * The pipeline, with each row's figures read from its authoritative investment
 * case rather than the opportunity's projected headline columns.
 *
 * The projection keeps those columns correct, so this is not a correctness fix
 * — it is a provenance one. A number on a pipeline card should come from the
 * record that owns it, so that when the two ever diverge the card is wrong in
 * an obvious way rather than a plausible one.
 */
export async function listPipeline(session: Session): Promise<PipelineRow[]> {
  const { listOpportunities } = await import("@/lib/data/opportunities");
  const opportunities = await listOpportunities(session);
  if (opportunities.length === 0) return [];

  const cases = await withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      `select distinct on (opportunity_id)
              opportunity_id, version, status, acquisition_price, total_cost,
              entry_yield_pct, target_irr, target_equity_multiple
         from investment_cases
        where status in ('approved', 'current')
        order by opportunity_id, (status = 'approved') desc, version desc`);
    return new Map(rows.map((r) => [r.opportunity_id as string, r]));
  });

  return opportunities.map((o) => {
    const c = cases.get(o.opportunityId);
    return {
      ...o,
      caseBasis: c ? (c.status === "approved" ? "approved" : "working") : "none",
      caseVersion: c ? Number(c.version) : null,
      caseAcquisitionPrice: c ? num(c.acquisition_price) : null,
      caseTotalCost: c ? num(c.total_cost) : null,
      caseEntryYieldPct: c ? num(c.entry_yield_pct) : null,
      caseTargetIrr: c ? num(c.target_irr) : null,
      caseEquityMultiple: c ? num(c.target_equity_multiple) : null,
    };
  });
}
