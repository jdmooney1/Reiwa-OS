"use client";

import { useState } from "react";
import Link from "next/link";
import type { OpportunityRisk } from "@/lib/data/opportunity-risks";
import { createRiskAction, updateRiskAction } from "@/app/actions/workspace";
import { formatMoneyCompact, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Section, TableWrap, Th, Td, Empty, Provenance } from "@/components/workspace/primitives";
import {
  SEVERITY_LABEL, SEVERITY_TONE, RISK_STATUS_LABEL, RISK_STATUS_TONE,
} from "@/lib/workspace/labels";
import type { Currency } from "@/types/database";

/**
 * The risk register.
 *
 * One list, open first. A risk promoted from a diligence finding keeps a link
 * back to it, and the register is the only place a risk lives — there is no
 * second, screen-only copy that can drift from the record and no "risk" derived
 * on the fly from a DD status.
 *
 * A closed risk stays visible rather than disappearing: what was raised and
 * then accepted is part of the case for the investment, and is exactly what
 * somebody asks about afterwards.
 */
export function RisksSection({
  opportunityId, risks, canWrite, currency,
}: {
  opportunityId: string;
  risks: OpportunityRisk[];
  canWrite: boolean;
  currency: Currency;
}) {
  const [adding, setAdding] = useState(false);
  const open = risks.filter((r) => r.status === "open");
  const settled = risks.filter((r) => r.status !== "open");

  return (
    <div>
      <Section
        eyebrow="Register"
        title={`Open risks (${open.length})`}
        action={canWrite && !adding && (
          <button type="button" onClick={() => setAdding(true)}
            className="rounded border border-line px-3 py-1.5 text-2xs font-medium text-ink-muted hover:text-ink">
            Raise a risk
          </button>
        )}
      >
        {adding && canWrite && (
          <form action={createRiskAction.bind(null, opportunityId)}
            className="mb-5 max-w-3xl space-y-3 border border-line p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-2">
                <span className="eyebrow">Title</span>
                <input name="title" required
                  className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink focus:border-line-strong focus:outline-none" />
              </label>
              <label className="block">
                <span className="eyebrow">Severity</span>
                <select name="severity" defaultValue="medium"
                  className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-2 text-sm text-ink focus:border-line-strong focus:outline-none">
                  {["low", "medium", "high", "critical"].map((s) => (
                    <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="eyebrow">Category</span>
                <input name="category" placeholder="e.g. Planning and Heritage"
                  className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
              </label>
              <label className="block">
                <span className="eyebrow">Financial impact</span>
                <input name="financialImpact" type="number"
                  className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink focus:border-line-strong focus:outline-none" />
              </label>
            </div>
            <label className="block">
              <span className="eyebrow">Description</span>
              <textarea name="description" rows={2}
                className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none" />
            </label>
            <label className="block">
              <span className="eyebrow">Mitigation</span>
              <textarea name="mitigation" rows={2}
                className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none" />
            </label>
            <div className="flex gap-2">
              <button type="submit"
                className="rounded bg-purple px-3.5 py-2 text-xs font-semibold text-surface hover:bg-purple-70">
                Raise risk
              </button>
              <button type="button" onClick={() => setAdding(false)}
                className="rounded border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink">
                Cancel
              </button>
            </div>
          </form>
        )}

        {open.length === 0 ? (
          <Empty
            title="No open risks."
            hint="Risks are raised here directly, or promoted from a diligence finding."
          />
        ) : (
          <RiskTable
            opportunityId={opportunityId}
            risks={open}
            canWrite={canWrite}
            currency={currency}
          />
        )}
      </Section>

      {settled.length > 0 && (
        <Section eyebrow="Closed out" title={`Mitigated, accepted and closed (${settled.length})`}>
          <RiskTable
            opportunityId={opportunityId}
            risks={settled}
            canWrite={canWrite}
            currency={currency}
            muted
          />
          <Provenance>
            Risks are never deleted. What was raised and then accepted is part of the case.
          </Provenance>
        </Section>
      )}
    </div>
  );
}

function RiskTable({
  opportunityId, risks, canWrite, currency, muted = false,
}: {
  opportunityId: string;
  risks: OpportunityRisk[];
  canWrite: boolean;
  currency: Currency;
  muted?: boolean;
}) {
  return (
    <TableWrap>
      <table className={cn("w-full border-collapse", muted && "text-ink-muted")}>
        <thead>
          <tr>
            <Th>Risk</Th>
            <Th>Category</Th>
            <Th>Severity</Th>
            <Th>Status</Th>
            <Th>Owner</Th>
            <Th align="right">Impact</Th>
            <Th>Raised</Th>
            {canWrite && <Th />}
          </tr>
        </thead>
        <tbody>
          {risks.map((r) => (
            <tr key={r.riskId}>
              <Td>
                <div className={muted ? "text-ink-muted" : "text-ink"}>{r.title}</div>
                {r.description && (
                  <div className="max-w-md text-2xs leading-relaxed text-ink-faint">{r.description}</div>
                )}
                {r.mitigation && (
                  <div className="mt-0.5 max-w-md text-2xs text-ink-muted">
                    <span className="text-ink-faint">Mitigation: </span>{r.mitigation}
                  </div>
                )}
              </Td>
              <Td className="text-xs text-ink-muted">{r.category}</Td>
              <Td><Badge tone={SEVERITY_TONE[r.severity]}>{SEVERITY_LABEL[r.severity]}</Badge></Td>
              <Td><Badge tone={RISK_STATUS_TONE[r.status]}>{RISK_STATUS_LABEL[r.status]}</Badge></Td>
              <Td className="text-xs text-ink-muted">{ownerLabel(r)}</Td>
              <Td align="right">{r.financialImpact != null ? formatMoneyCompact(r.financialImpact, currency) : "—"}</Td>
              <Td className="text-2xs text-ink-faint">
                {formatDate(r.createdAt)}
                {r.sourceDdItemId && (
                  <>
                    {" · "}
                    <Link href={`/opportunities/${opportunityId}/diligence`}
                      className="underline decoration-line underline-offset-2 hover:text-ink">
                      from diligence
                    </Link>
                  </>
                )}
              </Td>
              {canWrite && (
                <Td align="right">
                  <form action={updateRiskAction.bind(null, opportunityId, r.riskId)}
                    className="flex items-center justify-end gap-1.5">
                    <input type="hidden" name="severity" value={r.severity} />
                    <input type="hidden" name="mitigation" value={r.mitigation ?? ""} />
                    <select name="status" defaultValue={r.status}
                      className="h-7 rounded border border-line bg-surface-card px-1.5 text-2xs text-ink focus:border-line-strong focus:outline-none">
                      {["open", "mitigated", "accepted", "closed"].map((s) => (
                        <option key={s} value={s}>{RISK_STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                    <button type="submit"
                      className="rounded border border-line px-2 py-1 text-2xs font-medium text-ink-muted hover:text-ink">
                      Set
                    </button>
                  </form>
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

/**
 * Who owns this risk, without claiming more than the reader can be told.
 *
 * Three states, not two. `profiles_self` lets a non-admin read only their own
 * profile row, so a risk owned by a colleague arrives with an owner id and no
 * name. Rendering that as "Unassigned" would be a lie with operational
 * consequences — somebody would pick it up twice, or not at all.
 */
function ownerLabel(risk: OpportunityRisk): string {
  if (risk.ownerName) return risk.ownerName;
  return risk.ownerUserId ? "Assigned" : "Unassigned";
}
