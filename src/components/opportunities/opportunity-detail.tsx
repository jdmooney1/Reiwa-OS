"use client";

import Link from "next/link";
import { useTransition } from "react";
import { ChevronLeft, ArrowRight, Check, Loader2, Landmark } from "lucide-react";
import type { Opportunity, OppStage } from "@/lib/data/opportunity-types";
import { OPP_STAGES } from "@/lib/data/opportunity-types";
import {
  setStageAction, setOutcomeAction, reactivateAction, convertToAssetAction, updateOpportunityAction,
} from "@/app/actions/opportunities";
import { preparePublicationAction } from "@/app/actions/admin-portal";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { formatMoneyCompact, formatPct, formatDate } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AssetType, Strategy, Currency } from "@/types/database";

const STAGE_LABEL: Record<OppStage, string> = {
  new: "New", screening: "Screening", underwriting: "Underwriting", ic: "IC", approved: "Approved", acquired: "Acquired",
};

export function OpportunityDetail({
  opp, canWrite, portalAdmin = false, publicationId = null,
}: {
  opp: Opportunity;
  canWrite: boolean;
  /** Reiwa admin — may prepare this opportunity for the Investment Portal. */
  portalAdmin?: boolean;
  /** The existing investor publication for this opportunity, if any. */
  publicationId?: string | null;
}) {
  const [pending, start] = useTransition();
  const id = opp.opportunityId;
  const cur = opp.currency as Currency;
  const isActive = opp.status === "active";
  const converted = opp.status === "converted" || !!opp.assetId;
  const stageIdx = OPP_STAGES.indexOf(opp.stage);

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-line bg-surface-card px-8 py-5">
        <Link href="/pipeline" className="mb-2 inline-flex items-center gap-1 text-2xs text-ink-faint hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Pipeline
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-serif text-2xl text-ink">{opp.name}</h1>
              <Badge tone="neutral">{STAGE_LABEL[opp.stage]}</Badge>
              {converted
                ? <Badge tone="gold" dot>Converted</Badge>
                : isActive ? <Badge tone="positive" dot>Active</Badge> : <Badge tone="negative" dot>{opp.status}</Badge>}
            </div>
            <div className="mt-1 text-sm text-ink-muted">
              {opp.city ?? "—"} · {ASSET_TYPE_LABEL[opp.assetType as AssetType] ?? opp.assetType}
              {opp.strategy ? ` · ${STRATEGY_LABEL[opp.strategy as Strategy] ?? opp.strategy}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {portalAdmin && (
              publicationId ? (
                <Link href={`/admin/publications/${publicationId}`}
                  className="flex items-center gap-1.5 rounded border border-gold/40 bg-gold/10 px-3.5 py-2 text-xs font-semibold text-gold-deep hover:bg-gold/20">
                  <Landmark className="h-3.5 w-3.5" /> View Investor Publication
                </Link>
              ) : (
                <button onClick={() => start(() => preparePublicationAction(id))} disabled={pending}
                  title="Creates a draft investor publication from the approved field whitelist"
                  className="flex items-center gap-1.5 rounded border border-line px-3.5 py-2 text-xs font-semibold text-ink-muted hover:border-gold/40 hover:text-ink disabled:opacity-60">
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Landmark className="h-3.5 w-3.5" />}
                  Prepare for Investors
                </button>
              )
            )}
            {converted && opp.assetId && (
              <Link href={`/assets/${opp.assetId}`} className="flex items-center gap-1.5 rounded bg-gold px-3.5 py-2 text-xs font-semibold text-navy hover:bg-gold-soft">
                View Asset <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-3">
        {/* Lifecycle controls */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader eyebrow="Lifecycle" title="Investment Stage" />
            <CardBody>
              <div className="flex flex-wrap items-center gap-1.5">
                {OPP_STAGES.map((s, i) => {
                  const done = i < stageIdx;
                  const current = i === stageIdx;
                  return (
                    <button
                      key={s}
                      disabled={!canWrite || !isActive || pending}
                      onClick={() => start(() => setStageAction(id, s))}
                      className={cn(
                        "flex items-center gap-1 rounded border px-2.5 py-1.5 text-2xs font-medium transition-colors disabled:opacity-60",
                        current ? "border-navy bg-navy text-surface"
                          : done ? "border-gold/40 bg-gold/10 text-gold-deep"
                          : "border-line bg-surface-card text-ink-muted hover:border-gold/40",
                      )}
                    >
                      {done && <Check className="h-3 w-3" />} {STAGE_LABEL[s]}
                    </button>
                  );
                })}
              </div>

              {/* Actions */}
              {canWrite && (
                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  {!converted && (opp.stage === "approved" || opp.stage === "acquired") && isActive && (
                    <button onClick={() => start(() => convertToAssetAction(id))} disabled={pending}
                      className="flex items-center gap-1.5 rounded bg-gold px-3.5 py-2 text-xs font-semibold text-navy hover:bg-gold-soft disabled:opacity-60">
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                      Convert to Asset
                    </button>
                  )}
                  {isActive && !converted && (
                    <>
                      <OutcomeBtn label="Reject" onClick={() => start(() => setOutcomeAction(id, "rejected"))} pending={pending} />
                      <OutcomeBtn label="Withdraw" onClick={() => start(() => setOutcomeAction(id, "withdrawn"))} pending={pending} />
                      <OutcomeBtn label="Mark Lost" onClick={() => start(() => setOutcomeAction(id, "lost"))} pending={pending} />
                    </>
                  )}
                  {!isActive && !converted && (
                    <button onClick={() => start(() => reactivateAction(id))} disabled={pending}
                      className="rounded border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink">
                      Reactivate
                    </button>
                  )}
                  {!converted && opp.stage !== "approved" && opp.stage !== "acquired" && isActive && (
                    <span className="text-2xs text-ink-faint">Advance to <span className="font-medium">Approved</span> to enable conversion.</span>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Edit */}
          {canWrite && !converted && (
            <Card>
              <CardHeader eyebrow="Underwriting" title="Edit Opportunity" />
              <CardBody>
                <form action={updateOpportunityAction.bind(null, id)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Edit label="Name" name="name" defaultValue={opp.name} />
                    <Edit label="Strategy" name="strategy" defaultValue={opp.strategy ?? ""} />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <Edit label="Target price" name="targetPrice" type="number" defaultValue={opp.targetPrice ?? ""} />
                    <Edit label="NIY %" name="niy" type="number" step="0.01" defaultValue={opp.niy ?? ""} />
                    <Edit label="Target IRR %" name="targetIrr" type="number" step="0.1" defaultValue={opp.targetIrr ?? ""} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Edit label="Capex budget" name="capexBudget" type="number" defaultValue={opp.capexBudget ?? ""} />
                    <Edit label="Probability %" name="probability" type="number" defaultValue={opp.probability ?? ""} />
                  </div>
                  <label className="block">
                    <span className="eyebrow">Thesis / summary</span>
                    <textarea name="summary" rows={3} defaultValue={opp.summary ?? ""}
                      className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30" />
                  </label>
                  <div className="flex justify-end">
                    <button type="submit" className="rounded bg-navy px-4 py-2 text-xs font-semibold text-surface hover:bg-navy-50">Save changes</button>
                  </div>
                </form>
              </CardBody>
            </Card>
          )}
        </div>

        {/* Read summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader eyebrow="Snapshot" title="Key Figures" />
            <CardBody className="p-0">
              <dl className="divide-y divide-line">
                <Row k="Guide price" v={formatMoneyCompact(opp.targetPrice, cur)} />
                <Row k="NIY" v={formatPct(opp.niy, 1)} />
                <Row k="Target IRR" v={formatPct(opp.targetIrr, 1)} />
                <Row k="Capex budget" v={formatMoneyCompact(opp.capexBudget, cur)} />
                <Row k="Probability" v={opp.probability != null ? `${opp.probability}%` : "—"} />
                <Row k="Source" v={opp.source ?? "—"} />
                <Row k="Created" v={formatDate(opp.createdAt)} />
                <Row k="Updated" v={formatDate(opp.updatedAt)} />
              </dl>
            </CardBody>
          </Card>
          {opp.summary && (
            <Card>
              <CardHeader eyebrow="Thesis" title="Summary" />
              <CardBody><p className="text-sm leading-relaxed text-ink/90">{opp.summary}</p></CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function OutcomeBtn({ label, onClick, pending }: { label: string; onClick: () => void; pending: boolean }) {
  return (
    <button onClick={onClick} disabled={pending}
      className="rounded border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-negative/40 hover:text-negative disabled:opacity-60">
      {label}
    </button>
  );
}

function Edit({ label, name, type = "text", defaultValue, step }: {
  label: string; name: string; type?: string; defaultValue?: string | number; step?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input name={name} type={type} step={step} defaultValue={defaultValue}
        className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30" />
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2.5">
      <dt className="text-2xs uppercase tracking-label text-ink-faint">{k}</dt>
      <dd className="tabular text-right text-sm text-ink">{v}</dd>
    </div>
  );
}
