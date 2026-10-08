"use client";

import { useState, useTransition } from "react";
import { useFormState } from "react-dom";
import { ChevronRight } from "lucide-react";
import type { DealDocumentRow } from "@/lib/data/deal-documents";
import type { ReadinessSummaryRow } from "@/lib/data/deal-gates";
import { updateDealDocumentAction, transitionDocumentStageAction } from "@/app/actions/deal-gates";
import { ACTION_IDLE, type ActionResult } from "@/lib/actions/result";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Section, TableWrap, Th, Td, Empty, ActionError } from "@/components/workspace/primitives";
import { DOCUMENT_STAGE_LABEL } from "@/lib/workspace/labels";
import { formatDate } from "@/lib/format";

const STATUS_ORDER = [
  "not_started", "requested", "instructed", "draft", "in_review", "final", "signed", "superseded", "not_applicable",
] as const;

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started", requested: "Requested", instructed: "Instructed", draft: "Draft",
  in_review: "In review", final: "Final", signed: "Signed", superseded: "Superseded", not_applicable: "N/A",
};

function statusTone(status: string): "positive" | "accent" | "muted" | "caution" | "negative" | "neutral" {
  if (status === "final" || status === "signed") return "positive";
  if (status === "not_applicable" || status === "superseded") return "muted";
  if (status === "not_started") return "neutral";
  return "accent";
}

/**
 * Deal readiness (docs/24): the catalogue-driven checklist, the stage
 * readiness summary, and the transition/override control — all reading the
 * SAME document_stage the workspace header's status strip shows, so the two
 * never disagree about what stage the deal is actually at.
 */
export function DealReadinessSection({
  opportunityId, documents, readiness, documentStage, canWrite, canOverride,
}: {
  opportunityId: string;
  documents: DealDocumentRow[];
  readiness: ReadinessSummaryRow[];
  documentStage: 0 | 1 | 2 | 3 | 4;
  canWrite: boolean;
  canOverride: boolean;
}) {
  const byStage = new Map<number, DealDocumentRow[]>();
  for (const d of documents) {
    const list = byStage.get(d.stage) ?? [];
    list.push(d);
    byStage.set(d.stage, list);
  }

  const current = readiness.find((r) => r.stage === documentStage);

  return (
    <>
      <Section eyebrow="Deal readiness" title={`Stage ${documentStage} — ${DOCUMENT_STAGE_LABEL[documentStage]}`}>
        {current && (
          <p className="mb-3 text-sm text-ink-muted">
            {current.gateDocCleared} of {current.gateDocTotal} gate document{current.gateDocTotal === 1 ? "" : "s"} Final/Signed
            {current.investorRequirement.applicable && (
              <> · {current.investorRequirement.satisfied ? "investor requirement met" : current.investorRequirement.detail}</>
            )}
          </p>
        )}
        {canWrite && <StageTransitionForm opportunityId={opportunityId} canOverride={canOverride} />}
      </Section>

      <Section eyebrow="Readiness by stage" title="Summary">
        <TableWrap>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Stage</Th>
                <Th align="right">Gate documents</Th>
                <Th>Investor requirement</Th>
                <Th align="right">Status</Th>
              </tr>
            </thead>
            <tbody>
              {readiness.map((r) => (
                <tr key={r.stage}>
                  <Td>{r.stage} — {DOCUMENT_STAGE_LABEL[r.stage]}</Td>
                  <Td align="right">{r.gateDocCleared} of {r.gateDocTotal}</Td>
                  <Td>{r.investorRequirement.applicable ? (r.investorRequirement.satisfied ? "Met" : r.investorRequirement.detail) : "—"}</Td>
                  <Td align="right">
                    <Badge tone={r.satisfied ? "positive" : "caution"} dot>{r.satisfied ? "Clear" : "Open"}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      {[0, 1, 2, 3, 4].map((stage) => {
        const rows = byStage.get(stage) ?? [];
        if (rows.length === 0) return null;
        return (
          <Section key={stage} eyebrow={`Stage ${stage}`} title={DOCUMENT_STAGE_LABEL[stage as 0 | 1 | 2 | 3 | 4]}>
            <ul className="divide-y divide-line">
              {rows.map((doc) => (
                <DocumentRow key={doc.dealDocumentId} opportunityId={opportunityId} doc={doc} canWrite={canWrite} />
              ))}
            </ul>
          </Section>
        );
      })}

      {documents.length === 0 && (
        <Section eyebrow="Deal readiness" title="No catalogue documents yet">
          <Empty title="Nothing has been created for this opportunity yet." />
        </Section>
      )}
    </>
  );
}

function StageTransitionForm({ opportunityId, canOverride }: { opportunityId: string; canOverride: boolean }) {
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [state, formAction] = useFormState(
    transitionDocumentStageAction.bind(null, opportunityId, direction), ACTION_IDLE);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
      <label className="block">
        <span className="eyebrow">Direction</span>
        <select value={direction} onChange={(e) => setDirection(e.target.value as "forward" | "backward")}
          className="mt-1 h-8 rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none">
          <option value="forward">Advance to next stage</option>
          <option value="backward">Move back a stage</option>
        </select>
      </label>
      <label className="block">
        <span className="eyebrow">Override reason {canOverride ? "(if gates are not yet clear)" : "(admin/IC member only)"}</span>
        <input name="overrideReason" type="text" disabled={!canOverride} placeholder="Required only when gates are not satisfied"
          className="mt-1 h-8 w-80 rounded border border-line bg-surface-card px-2 text-xs text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none disabled:bg-surface-sunken disabled:text-ink-faint" />
      </label>
      <button type="submit"
        className="h-8 rounded bg-purple px-3 text-2xs font-semibold text-surface hover:bg-purple-70">
        Apply
      </button>
      <ActionError message={state.error} />
    </form>
  );
}

function DocumentRow({
  opportunityId, doc, canWrite,
}: {
  opportunityId: string;
  doc: DealDocumentRow;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(
    updateDealDocumentAction.bind(null, opportunityId, doc.dealDocumentId), ACTION_IDLE);

  return (
    <li className="py-1">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className={cn(
          "group -mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-left transition-colors",
          "hover:bg-surface-sunken/60 focus-visible:bg-surface-sunken/60",
          open && "bg-surface-sunken/40",
        )}>
        <ChevronRight aria-hidden="true" strokeWidth={2}
          className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-150 group-hover:text-ink", open && "rotate-90 text-ink")} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">{doc.nameEn}</span>
          <span className="mt-0.5 flex flex-wrap gap-2 text-2xs text-ink-faint">
            <span>{doc.origin}</span>
            {doc.gateKind !== "none" && <span>· {doc.gateKind} gate</span>}
            {doc.investorOrgName && <span>· {doc.investorOrgName}</span>}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {doc.dueDate && <span className="text-2xs text-ink-faint">{formatDate(doc.dueDate)}</span>}
          {doc.ownerName && <span className="text-2xs text-ink-faint">{doc.ownerName}</span>}
          <Badge tone={statusTone(doc.status)}>{STATUS_LABEL[doc.status] ?? doc.status}</Badge>
          <span className="w-12 text-right text-2xs font-medium text-ink-faint group-hover:text-ink">
            {open ? "Close" : canWrite ? "Update" : "View"}
          </span>
        </span>
      </button>

      {open && (
        <div className="mt-2 ml-1.5 border-l-2 border-line pl-4">
          {canWrite ? (
            <form action={formAction} className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="eyebrow">Status</span>
                  <select name="status" defaultValue={doc.status}
                    className="mt-1 h-8 rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none">
                    {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="eyebrow">Due</span>
                  <input name="dueDate" type="date" defaultValue={doc.dueDate ?? ""}
                    className="mt-1 h-8 rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none" />
                </label>
                <label className="block">
                  <span className="eyebrow">Provider</span>
                  <input name="provider" type="text" defaultValue={doc.provider ?? ""} placeholder="Commissioned from"
                    className="mt-1 h-8 w-48 rounded border border-line bg-surface-card px-2 text-xs text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
                </label>
              </div>
              <label className="block">
                <span className="eyebrow">Notes</span>
                <textarea name="notes" rows={2} defaultValue={doc.notes ?? ""}
                  className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
              </label>
              <div className="flex items-center gap-2">
                <button type="submit" className="rounded bg-purple px-3 py-1.5 text-2xs font-semibold text-surface hover:bg-purple-70">
                  Save
                </button>
              </div>
              <ActionError message={state.error} />
            </form>
          ) : (
            <p className="text-xs text-ink-muted">{doc.notes ?? "No notes recorded."}</p>
          )}
        </div>
      )}
    </li>
  );
}
