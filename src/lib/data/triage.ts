// ============================================================================
// Triage - recording a decision on an untriaged deal, and taking it back.
// ----------------------------------------------------------------------------
// Runs under the caller's session, so row level security decides who may write: the
// update policy on opportunities needs the caller's organisation and write scope.
//
// A decision is written ONLY to a deal that is still untriaged. If somebody else triaged
// it a moment ago, this refuses (it does not overwrite their decision with yours), and the
// person is told. Undo reverses only a decision the same person made.
//
// Status, priority and note are written together and stay inside what the database's own
// CHECKs allow (a priority exists only on a live deal). The mapping from Pursue / Watch /
// Pass is in lib/pipeline/triage.ts, in one place.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { triageFields, isTriageDecision, type TriageDecision } from "@/lib/pipeline/triage";
import type { TriageStatus, TriagePriority } from "@/lib/data/opportunity-types";

export interface TriageResult {
  triageStatus: TriageStatus;
  triagePriority: TriagePriority | null;
  triageNote: string | null;
}

export async function recordTriage(
  session: Session, opportunityId: string, decision: unknown, reason: unknown,
): Promise<TriageResult> {
  if (!isTriageDecision(decision)) throw new AppError("That is not a triage decision.");
  const f = triageFields(decision as TriageDecision, reason);
  return withSession(session, async (tx) => {
    const done = await tx.query<{ triage_status: TriageStatus; triage_priority: TriagePriority | null; triage_note: string | null }>(
      `update opportunities
          set triage_status = $2, triage_priority = $3, triage_note = $4,
              triaged_at = now(), triaged_by = $5
        where opportunity_id = $1 and triage_status = 'untriaged'
        returning triage_status, triage_priority, triage_note`,
      [opportunityId, f.status, f.priority, f.note, session.userId]);
    if (done.rows[0]) {
      const r = done.rows[0];
      return { triageStatus: r.triage_status, triagePriority: r.triage_priority, triageNote: r.triage_note };
    }
    // Nothing updated: either it is not visible/writable to this person, or it is already triaged.
    const seen = await tx.query<{ triage_status: string }>(
      "select triage_status from opportunities where opportunity_id = $1", [opportunityId]);
    if (seen.rows[0] && seen.rows[0].triage_status !== "untriaged") {
      throw new AppError("Someone has already triaged this deal. Skip to the next one.");
    }
    throw new AppError("That deal could not be found, or you cannot triage it.");
  });
}

/** Put a deal this person triaged back to untriaged. Refuses anything they did not triage themselves. */
export async function undoTriage(session: Session, opportunityId: string): Promise<void> {
  await withSession(session, async (tx) => {
    const done = await tx.query(
      `update opportunities
          set triage_status = 'untriaged', triage_priority = null, triage_note = null,
              triaged_at = null, triaged_by = null
        where opportunity_id = $1 and triage_status <> 'untriaged' and triaged_by = $2
        returning opportunity_id`,
      [opportunityId, session.userId]);
    if (done.rows.length === 0) throw new AppError("That decision cannot be undone: it was not made by you, or it has already changed.");
  });
}
