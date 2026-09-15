// ============================================================================
// Investment committee decisions.
// ----------------------------------------------------------------------------
// The record that answers, years later, "why did we approve this investment,
// and on what numbers?".
//
// Recording a decision is the ONLY way an underwriting version becomes
// approved. That is enforced by a trigger (migration 0008), not by this file:
//
//   * approved / approved_with_conditions — the referenced version becomes
//     `approved`, stamped with who recorded it, and any earlier approval for
//     the same opportunity is superseded in the same statement.
//   * deferred / rejected — NOTHING changes. An IC that sends work back must
//     not leave anything looking signed off.
//
// The composite foreign key (investment_case_id, opportunity_id) means the
// schema itself refuses a decision that approves one opportunity's underwriting
// on another's file.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { str } from "@/lib/data/coerce";
import type { Recommendation } from "@/types/database";

export type IcOutcome = "approved" | "approved_with_conditions" | "deferred" | "rejected";

export const IC_OUTCOMES: IcOutcome[] = [
  "approved", "approved_with_conditions", "deferred", "rejected",
];

/** Outcomes that constitute committee approval of the referenced underwriting. */
export const APPROVING_OUTCOMES: IcOutcome[] = ["approved", "approved_with_conditions"];

export function isApproval(outcome: IcOutcome): boolean {
  return APPROVING_OUTCOMES.includes(outcome);
}

export interface IcDecision {
  decisionId: string;
  orgId: string;
  opportunityId: string;
  investmentCaseId: string;
  decisionDate: string;
  recommendation: Recommendation | null;
  outcome: IcOutcome;
  conditions: string | null;
  rationale: string | null;
  followUp: string | null;
  decisionMakers: string[];
  recordedBy: string | null;
  createdAt: string;
}

function mapDecision(r: Record<string, any>): IcDecision {
  return {
    decisionId: r.decision_id, orgId: r.org_id, opportunityId: r.opportunity_id,
    investmentCaseId: r.investment_case_id, decisionDate: r.decision_date,
    recommendation: (r.recommendation ?? null) as Recommendation | null,
    outcome: r.outcome, conditions: str(r.conditions), rationale: str(r.rationale),
    followUp: str(r.follow_up), decisionMakers: r.decision_makers ?? [],
    recordedBy: r.recorded_by ?? null, createdAt: r.created_at,
  };
}

export interface NewIcDecision {
  investmentCaseId: string;
  outcome: IcOutcome;
  decisionDate?: string;
  recommendation?: Recommendation | null;
  conditions?: string | null;
  rationale?: string | null;
  followUp?: string | null;
  decisionMakers?: string[];
}

export async function listDecisions(session: Session, opportunityId: string): Promise<IcDecision[]> {
  return withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query(
      "select * from ic_decisions where opportunity_id = $1 order by decision_date desc, created_at desc",
      [opportunityId]);
    return rows.map(mapDecision);
  });
}

/** The decision that approved the live underwriting, if there is one. */
export async function approvingDecision(
  session: Session, opportunityId: string,
): Promise<IcDecision | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `select d.* from ic_decisions d
         join investment_cases c on c.case_id = d.investment_case_id
        where d.opportunity_id = $1
          and c.status = 'approved'
          and d.outcome in ('approved', 'approved_with_conditions')
        order by d.decision_date desc, d.created_at desc
        limit 1`, [opportunityId]);
    return rows[0] ? mapDecision(rows[0]) : null;
  });
}

/**
 * Record a committee decision.
 *
 * `conditions` is required for `approved_with_conditions`. An approval whose
 * conditions were never written down is indistinguishable from an unconditional
 * one the moment everybody in the room has forgotten the meeting.
 */
export async function recordDecision(
  session: Session, opportunityId: string, input: NewIcDecision,
): Promise<string> {
  if (input.outcome === "approved_with_conditions" && !input.conditions?.trim()) {
    throw new Error("State the conditions when approving with conditions.");
  }
  return withSession(session, async (tx) => {
    const opp = await tx.query<{ org_id: string }>(
      "select org_id from opportunities where opportunity_id = $1", [opportunityId]);
    if (!opp.rows[0]) throw new Error("Opportunity not found or not permitted");

    const res = await tx.query<{ decision_id: string }>(
      `insert into ic_decisions
         (org_id, opportunity_id, investment_case_id, decision_date, recommendation,
          outcome, conditions, rationale, follow_up, decision_makers, recorded_by)
       values ($1,$2,$3,coalesce($4::date, current_date),$5,$6,$7,$8,$9,coalesce($10::text[], '{}'::text[]),$11)
       returning decision_id`,
      [opp.rows[0].org_id, opportunityId, input.investmentCaseId, input.decisionDate ?? null,
       input.recommendation ?? null, input.outcome, input.conditions ?? null,
       input.rationale ?? null, input.followUp ?? null, input.decisionMakers ?? null,
       session.userId ?? null]);
    return res.rows[0].decision_id;
  });
}

/**
 * Amend the written-up parts of a minute.
 *
 * What was decided, on what underwriting, and when are not here — a trigger
 * refuses those, and deletion outright. A committee that changed its mind
 * records a new decision; it does not edit the old one.
 */
export async function amendDecision(
  session: Session,
  decisionId: string,
  patch: { conditions?: string | null; rationale?: string | null;
           followUp?: string | null; decisionMakers?: string[] },
): Promise<void> {
  const cols: Record<string, string> = {
    conditions: "conditions", rationale: "rationale",
    followUp: "follow_up", decisionMakers: "decision_makers",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(cols)) {
    if (key in patch) {
      params.push((patch as Record<string, unknown>)[key]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length === 0) return;
  params.push(decisionId);
  await withSession(session, (tx) =>
    tx.query(`update ic_decisions set ${sets.join(", ")} where decision_id = $${params.length}`, params));
}
