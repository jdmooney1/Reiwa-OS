"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import type { DealInvestorRow } from "@/lib/data/deal-investors";
import { createDealInvestorAction, updateDealInvestorStatusAction } from "@/app/actions/deal-gates";
import { ACTION_IDLE, type ActionResult } from "@/lib/actions/result";
import { Badge } from "@/components/ui/badge";
import { Section, TableWrap, Th, Td, Empty, ActionError } from "@/components/workspace/primitives";
import { DEAL_INVESTOR_STATUS_LABEL } from "@/lib/workspace/labels";
import { formatDate } from "@/lib/format";

const STATUS_ORDER = [
  "matched", "teaser_sent", "nda_signed", "pack_released", "ioi_received",
  "soft_circled", "committed", "completed", "declined",
] as const;

function statusTone(status: string): "positive" | "accent" | "muted" | "caution" | "negative" | "neutral" {
  if (status === "declined") return "negative";
  if (status === "completed" || status === "committed") return "positive";
  if (status === "matched") return "neutral";
  return "accent";
}

/** A quiet progress read-out: filled dots for cleared gated documents, with
 * the non-gated count shown as a secondary, less prominent figure — per the
 * agreed wireframe, the gated count is what a reader should see first. */
function Progress({ gatedCleared, gatedTotal, nonGatedCleared, nonGatedTotal }: {
  gatedCleared: number; gatedTotal: number; nonGatedCleared: number; nonGatedTotal: number;
}) {
  if (gatedTotal === 0 && nonGatedTotal === 0) return <span className="text-2xs text-ink-faint">No documents yet</span>;
  return (
    <span className="text-xs text-ink">
      <span className="tabular font-medium">{gatedCleared}/{gatedTotal}</span>
      <span className="text-ink-faint"> gated Final</span>
      {nonGatedTotal > 0 && (
        <span className="ml-2 text-2xs text-ink-faint">({nonGatedCleared}/{nonGatedTotal} other)</span>
      )}
    </span>
  );
}

export function InvestorTrackerSection({
  opportunityId, investors, investorOrgs, canWrite,
}: {
  opportunityId: string;
  investors: DealInvestorRow[];
  investorOrgs: { investorOrgId: string; name: string }[];
  canWrite: boolean;
}) {
  const soft = investors.filter((i) => ["soft_circled", "committed", "completed"].includes(i.status)).length;
  const declined = investors.filter((i) => i.status === "declined").length;

  return (
    <>
      <Section eyebrow="Investor tracker" title="Readiness"
        action={canWrite && <AddInvestorForm opportunityId={opportunityId} investorOrgs={investorOrgs} />}>
        <p className="text-sm text-ink-muted">
          {soft} of {investors.length} investor{investors.length === 1 ? "" : "s"} soft-circled or later
          {declined > 0 && <> · {declined} declined</>}
        </p>
      </Section>

      <Section eyebrow="Investors" title="Tracker">
        {investors.length === 0 ? (
          <Empty title="No investors on this deal yet." hint="Add one from the control above." />
        ) : (
          <TableWrap>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Investor</Th>
                  <Th>Status</Th>
                  <Th>Introduced</Th>
                  <Th>Introduced via</Th>
                  <Th>Document progress</Th>
                </tr>
              </thead>
              <tbody>
                {investors.map((inv) => (
                  <InvestorRow key={inv.dealInvestorId} opportunityId={opportunityId} investor={inv} canWrite={canWrite} />
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </>
  );
}

function InvestorRow({
  opportunityId, investor, canWrite,
}: {
  opportunityId: string;
  investor: DealInvestorRow;
  canWrite: boolean;
}) {
  const [state, formAction] = useFormState(
    updateDealInvestorStatusAction.bind(null, opportunityId, investor.dealInvestorId), ACTION_IDLE);

  return (
    <tr>
      <Td>
        <span className="block text-sm text-ink">{investor.investorOrgName}</span>
        {investor.investorType && <span className="text-2xs text-ink-faint">{investor.investorType}</span>}
      </Td>
      <Td>
        {canWrite ? (
          <form action={formAction}>
            <select name="status" defaultValue={investor.status}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="h-7 rounded border border-line bg-surface-card px-1.5 text-2xs text-ink focus:border-line-strong focus:outline-none">
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{DEAL_INVESTOR_STATUS_LABEL[s]}</option>)}
            </select>
            <ActionError message={state.error} />
          </form>
        ) : (
          <Badge tone={statusTone(investor.status)}>{DEAL_INVESTOR_STATUS_LABEL[investor.status]}</Badge>
        )}
      </Td>
      <Td>{formatDate(investor.firstIntroducedAt)}</Td>
      <Td>{investor.introducedVia === "prospect_link" ? "Prospect link" : "Direct"}</Td>
      <Td>
        <Progress
          gatedCleared={investor.gatedCleared} gatedTotal={investor.gatedTotal}
          nonGatedCleared={investor.nonGatedCleared} nonGatedTotal={investor.nonGatedTotal}
        />
      </Td>
    </tr>
  );
}

function AddInvestorForm({
  opportunityId, investorOrgs,
}: {
  opportunityId: string;
  investorOrgs: { investorOrgId: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(createDealInvestorAction.bind(null, opportunityId), ACTION_IDLE);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded border border-line px-3 py-1.5 text-2xs font-semibold text-ink-muted hover:text-ink">
        Add investor
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <select name="investorOrgId" defaultValue=""
        className="h-8 rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none">
        <option value="" disabled>Choose an investor organisation</option>
        {investorOrgs.map((o) => <option key={o.investorOrgId} value={o.investorOrgId}>{o.name}</option>)}
      </select>
      <select name="investorType" defaultValue=""
        className="h-8 rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none">
        <option value="">Investor type —</option>
        <option value="individual">Individual</option>
        <option value="corporate">Corporate</option>
        <option value="family_office">Family office</option>
        <option value="institutional">Institutional</option>
        <option value="other">Other</option>
      </select>
      <button type="submit" className="h-8 rounded bg-purple px-3 text-2xs font-semibold text-surface hover:bg-purple-70">
        Add
      </button>
      <ActionError message={state.error} />
    </form>
  );
}
