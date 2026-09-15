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

/** An attributed correction to a decision. The original is never rewritten. */
export interface IcDecisionAmendment {
  amendmentId: string;
  decisionId: string;
  amendedConditions: string | null;
  amendedRationale: string | null;
  amendedFollowUp: string | null;
  reason: string;
  amendedBy: string | null;
  createdAt: string;
}

function mapAmendment(r: Record<string, any>): IcDecisionAmendment {
  return {
    amendmentId: r.amendment_id, decisionId: r.decision_id,
    amendedConditions: str(r.amended_conditions),
    amendedRationale: str(r.amended_rationale),
    amendedFollowUp: str(r.amended_follow_up),
    reason: r.reason, amendedBy: r.amended_by ?? null, createdAt: r.created_at,
  };
}

/**
 * Correct a minute, on the record.
 *
 * The decision row is immutable — a trigger refuses every update and every
 * delete — so a correction is a new, attributed row saying what changed, who
 * changed it, when and why. What the committee originally approved therefore
 * stays readable forever, next to every subsequent amendment, instead of being
 * quietly replaced by whoever last had write access.
 *
 * `reason` is required. An amendment with no stated reason is indistinguishable
 * from the silent rewrite this design exists to prevent.
 */
export async function amendDecision(
  session: Session,
  decisionId: string,
  input: {
    reason: string;
    conditions?: string | null;
    rationale?: string | null;
    followUp?: string | null;
  },
): Promise<string> {
  if (!input.reason?.trim()) {
    throw new Error("State why the decision record is being amended.");
  }
  if (input.conditions === undefined && input.rationale === undefined && input.followUp === undefined) {
    throw new Error("An amendment must change something.");
  }
  return withSession(session, async (tx) => {
    const d = await tx.query<{ org_id: string }>(
      "select org_id from ic_decisions where decision_id = $1", [decisionId]);
    if (!d.rows[0]) throw new Error("Decision not found or not permitted");
    const res = await tx.query<{ amendment_id: string }>(
      `insert into ic_decision_amendments
         (org_id, decision_id, amended_conditions, amended_rationale, amended_follow_up, reason, amended_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning amendment_id`,
      [d.rows[0].org_id, decisionId, input.conditions ?? null, input.rationale ?? null,
       input.followUp ?? null, input.reason.trim(), session.userId ?? null]);
    return res.rows[0].amendment_id;
  });
}

export async function listAmendments(
  session: Session, decisionId: string,
): Promise<IcDecisionAmendment[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(
      "select * from ic_decision_amendments where decision_id = $1 order by created_at", [decisionId]);
    return rows.map(mapAmendment);
  });
}

/** The original decision, its amendments, and what currently stands. */
export interface EffectiveDecision {
  original: IcDecision;
  amendments: IcDecisionAmendment[];
  /** Latest non-null amended value, else the original. */
  effectiveConditions: string | null;
  effectiveRationale: string | null;
  effectiveFollowUp: string | null;
}

export async function effectiveDecision(
  session: Session, decisionId: string,
): Promise<EffectiveDecision | null> {
  return withSession(session, async (tx) => {
    const d = await tx.query("select * from ic_decisions where decision_id = $1", [decisionId]);
    if (!d.rows[0]) return null;
    const original = mapDecision(d.rows[0]);
    const a = await tx.query(
      "select * from ic_decision_amendments where decision_id = $1 order by created_at", [decisionId]);
    const amendments = a.rows.map(mapAmendment);

    // Latest non-null wins per field: an amendment that only restates the
    // conditions must not blank a rationale it never mentioned.
    const latest = (pick: (x: IcDecisionAmendment) => string | null, fallback: string | null) => {
      for (let i = amendments.length - 1; i >= 0; i--) {
        const v = pick(amendments[i]);
        if (v !== null) return v;
      }
      return fallback;
    };

    return {
      original,
      amendments,
      effectiveConditions: latest((x) => x.amendedConditions, original.conditions),
      effectiveRationale: latest((x) => x.amendedRationale, original.rationale),
      effectiveFollowUp: latest((x) => x.amendedFollowUp, original.followUp),
    };
  });
}
