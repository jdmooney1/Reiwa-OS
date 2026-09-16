"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import type { IcDecision, IcDecisionAmendment } from "@/lib/data/ic-decisions";
import type { UnderwritingVersion } from "@/lib/data/underwriting-types";
import { recordDecisionAction, amendDecisionAction } from "@/app/actions/workspace";
import { ACTION_IDLE } from "@/lib/actions/result";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Section, FactList, Empty, Provenance, ActionError } from "@/components/workspace/primitives";
import { IC_OUTCOME_LABEL, IC_OUTCOME_TONE } from "@/lib/workspace/labels";

export interface DecisionRecord {
  decision: IcDecision;
  amendments: IcDecisionAmendment[];
  version: UnderwritingVersion | null;
}

/**
 * The investment committee record.
 *
 * Permanent and singular: what was decided, on which underwriting version, by
 * whom, and why. The original is rendered as written and never overwritten —
 * amendments appear beneath it as their own attributed entries, so "what IC
 * approved" and "what we later corrected" are always two separate readings.
 *
 * With no decision recorded, the section says the opportunity has not been to
 * committee. It does not manufacture a pending or in-progress state: an IC
 * that has not sat has no position, and inventing one is how a file comes to
 * look further along than it is.
 */
export function DecisionSection({
  opportunityId, records, versions, canWrite,
}: {
  opportunityId: string;
  records: DecisionRecord[];
  versions: UnderwritingVersion[];
  canWrite: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [recordState, recordAction] = useFormState(
    recordDecisionAction.bind(null, opportunityId), ACTION_IDLE);
  const eligible = versions.filter((v) => v.status !== "superseded");

  return (
    <div>
      {records.length === 0 ? (
        <Section eyebrow="Committee" title="Not yet decided">
          <Empty
            title="This opportunity has not been to investment committee."
            hint={eligible.length === 0
              ? "An underwriting version is needed before a decision can be recorded against one."
              : "Recording a decision is what approves an underwriting version."}
          />
        </Section>
      ) : (
        records.map(({ decision, amendments, version }) => (
          <Section
            key={decision.decisionId}
            eyebrow={`Decision · ${formatDate(decision.decisionDate)}`}
            title={IC_OUTCOME_LABEL[decision.outcome]}
            action={<Badge tone={IC_OUTCOME_TONE[decision.outcome]}>{IC_OUTCOME_LABEL[decision.outcome]}</Badge>}
          >
            <FactList items={[
              { k: "Underwriting considered", v: version
                  ? `Version ${version.version}${version.status === "approved" ? " (approved)" : ` (${version.status})`}`
                  : "—" },
              { k: "Decision makers", v: decision.decisionMakers.length > 0
                  ? decision.decisionMakers.join(", ")
                  : "—" },
              { k: "Recorded by", v: decision.recordedByName ?? "—" },
              { k: "Recorded", v: formatDate(decision.createdAt) },
            ]} />

            <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
              <Prose label="Rationale" text={decision.rationale} />
              <Prose label="Conditions" text={decision.conditions} />
              <Prose label="Follow-up required" text={decision.followUp} />
            </div>

            {amendments.length > 0 && (
              <div className="mt-6 border-t border-line pt-4">
                <div className="eyebrow mb-3">Amendments to this record</div>
                <ul className="space-y-4">
                  {amendments.map((a) => (
                    <li key={a.amendmentId} className="border-l-2 border-caution/40 pl-4">
                      <div className="text-2xs text-ink-faint">
                        {formatDate(a.createdAt)}
                        {a.amendedByName ? ` · ${a.amendedByName}` : ""}
                      </div>
                      <p className="mt-0.5 text-xs font-medium text-ink">{a.reason}</p>
                      <div className="mt-2 space-y-2">
                        {a.amendedRationale && <Amended label="Rationale" text={a.amendedRationale} />}
                        {a.amendedConditions && <Amended label="Conditions" text={a.amendedConditions} />}
                        {a.amendedFollowUp && <Amended label="Follow-up" text={a.amendedFollowUp} />}
                      </div>
                    </li>
                  ))}
                </ul>
                <Provenance>
                  The decision above is shown as originally recorded. Amendments never rewrite it.
                </Provenance>
              </div>
            )}

            {canWrite && (
              <AmendForm opportunityId={opportunityId} decisionId={decision.decisionId} />
            )}
          </Section>
        ))
      )}

      {canWrite && eligible.length > 0 && (
        <Section
          eyebrow="Record"
          title="Record a committee decision"
          action={!recording && (
            <button type="button" onClick={() => setRecording(true)}
              className="rounded border border-line px-3 py-1.5 text-2xs font-medium text-ink-muted hover:text-ink">
              Record decision
            </button>
          )}
        >
          {recording ? (
            <form action={recordAction} className="max-w-3xl space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="eyebrow">Outcome</span>
                  <select name="outcome" defaultValue="deferred"
                    className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-2 text-sm text-ink focus:border-line-strong focus:outline-none">
                    {(["approved", "approved_with_conditions", "deferred", "rejected"] as const).map((o) => (
                      <option key={o} value={o}>{IC_OUTCOME_LABEL[o]}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="eyebrow">Underwriting version</span>
                  <select name="investmentCaseId" required
                    defaultValue={eligible.find((v) => v.status === "current")?.caseId ?? eligible[0]?.caseId}
                    className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-2 text-sm text-ink focus:border-line-strong focus:outline-none">
                    {eligible.map((v) => (
                      <option key={v.caseId} value={v.caseId}>v{v.version} ({v.status})</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="eyebrow">Decision date</span>
                  <input name="decisionDate" type="date"
                    className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink focus:border-line-strong focus:outline-none" />
                </label>
              </div>
              <label className="block">
                <span className="eyebrow">Decision makers</span>
                <input name="decisionMakers" placeholder="Comma separated"
                  className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
              </label>
              <label className="block">
                <span className="eyebrow">Rationale</span>
                <textarea name="rationale" rows={3}
                  className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none" />
              </label>
              <label className="block">
                <span className="eyebrow">Conditions</span>
                <textarea name="conditions" rows={2}
                  placeholder="Required when approving with conditions"
                  className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
              </label>
              <label className="block">
                <span className="eyebrow">Follow-up required</span>
                <textarea name="followUp" rows={2}
                  className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none" />
              </label>
              <div className="flex items-center gap-2 border-t border-line pt-4">
                <button type="submit"
                  className="rounded bg-purple px-4 py-2 text-xs font-semibold text-surface hover:bg-purple-70">
                  Record decision
                </button>
                <button type="button" onClick={() => setRecording(false)}
                  className="rounded border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink">
                  Cancel
                </button>
                <span className="text-2xs text-ink-faint">
                  This record is permanent. Corrections are recorded as amendments.
                </span>
              </div>
              <ActionError message={recordState.error} />
            </form>
          ) : (
            <p className="max-w-2xl text-xs leading-relaxed text-ink-muted">
              An approval here is what approves the underwriting version it names. A
              deferral or rejection changes nothing about the underwriting.
            </p>
          )}
        </Section>
      )}
    </div>
  );
}

function Prose({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-ink/90">{text}</p>
    </div>
  );
}

function Amended({ label, text }: { label: string; text: string }) {
  return (
    <div className="text-xs">
      <span className="eyebrow">{label} now reads</span>
      <p className="mt-0.5 whitespace-pre-line leading-relaxed text-ink-muted">{text}</p>
    </div>
  );
}

function AmendForm({ opportunityId, decisionId }: { opportunityId: string; decisionId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(
    amendDecisionAction.bind(null, opportunityId, decisionId), ACTION_IDLE);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-5 text-2xs font-medium text-ink-muted underline decoration-line underline-offset-2 hover:text-ink">
        Amend this record
      </button>
    );
  }
  return (
    <form action={formAction}
      className="mt-5 max-w-2xl space-y-3 border-t border-line pt-4">
      <label className="block">
        <span className="eyebrow">Why this record is being amended</span>
        <input name="reason" required placeholder="e.g. condition mis-transcribed from the minutes"
          className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
      </label>
      <p className="text-2xs text-ink-faint">
        Leave a field blank to leave it unamended. The original stays visible above.
      </p>
      <label className="block">
        <span className="eyebrow">Amended rationale</span>
        <textarea name="rationale" rows={2}
          className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none" />
      </label>
      <label className="block">
        <span className="eyebrow">Amended conditions</span>
        <textarea name="conditions" rows={2}
          className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none" />
      </label>
      <div className="flex gap-2">
        <button type="submit"
          className="rounded bg-purple px-3.5 py-2 text-xs font-semibold text-surface hover:bg-purple-70">
          Record amendment
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="rounded border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink">
          Cancel
        </button>
      </div>
      <ActionError message={state.error} />
    </form>
  );
}
