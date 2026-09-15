import Link from "next/link";
import type { OpportunityFile } from "@/lib/data/opportunity-file";
import type { UnderwritingVersion } from "@/lib/data/underwriting-types";
import type { OpportunityRisk } from "@/lib/data/opportunity-risks";
import { formatMoneyCompact, formatPct, formatMultiple, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Section, MetricRule, FactList, Empty, Provenance,
} from "@/components/workspace/primitives";
import {
  SOURCE_TYPE_LABEL, CASE_STATUS_LABEL, CASE_STATUS_TONE,
  SEVERITY_LABEL, SEVERITY_TONE,
} from "@/lib/workspace/labels";
import type { Currency } from "@/types/database";

/**
 * The front page of an investment file.
 *
 * Two questions, in order: what is this and where did it come from, then what
 * are we underwriting. The metrics come from the investment case — never from
 * the opportunity's projected headline columns — and the file says which
 * version they are, because a figure whose basis is unstated is a figure
 * somebody will quote in a meeting without knowing whether IC has seen it.
 *
 * Metrics that do not exist for this case are omitted rather than shown as a
 * dash. A core acquisition has no development contingency, and a row of "—" is
 * a worse answer than a shorter list.
 */
export function SummarySection({
  file, openRisks, workingAhead,
}: {
  file: OpportunityFile;
  openRisks: OpportunityRisk[];
  /** A newer working version exists alongside the approved one it differs from. */
  workingAhead: { version: number } | null;
}) {
  const o = file.opportunity;
  const uw = file.authoritative;
  const cur = o.currency as Currency;

  return (
    <div>
      <Section eyebrow="Underwriting" title={basisTitle(file)} action={
        uw && (
          <Link href={`/opportunities/${o.opportunityId}/underwriting`}
            className="text-2xs font-medium text-ink-muted hover:text-ink">
            {file.versionCount} version{file.versionCount === 1 ? "" : "s"} →
          </Link>
        )
      }>
        {uw ? (
          <>
            <MetricRule items={metricsFor(uw, cur)} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={CASE_STATUS_TONE[uw.status]}>{CASE_STATUS_LABEL[uw.status]}</Badge>
              <Provenance>
                Version {uw.version}
                {uw.approvedAt ? ` · approved ${formatDate(uw.approvedAt)}` : ` · drafted ${formatDate(uw.createdAt)}`}
                {uw.strategy ? ` · ${uw.strategy.replace(/_/g, " ")}` : ""}
              </Provenance>
            </div>
            {workingAhead && (
              <p className="mt-2 border-l-2 border-caution pl-3 text-xs leading-relaxed text-ink-muted">
                Version {workingAhead.version} is being worked on and differs from the approved
                figures above. These remain the numbers the committee approved.
              </p>
            )}
          </>
        ) : (
          <Empty
            title="Not yet underwritten."
            hint="Create the first underwriting version to give this opportunity figures."
          />
        )}
      </Section>

      {uw?.thesis && (
        <Section eyebrow="Thesis" title="Investment case">
          <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-ink/90">
            {uw.thesis}
          </p>
        </Section>
      )}

      <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-2">
        <Section eyebrow="Identity" title="Asset and origination">
          <FactList items={[
            { k: "Asset", v: o.name },
            { k: "Location", v: [o.address, o.city, o.country].filter(Boolean).join(", ") || "—" },
            { k: "Market", v: o.submarket ? `${o.market ?? "—"} · ${o.submarket}` : o.market ?? "—" },
            { k: "Currency", v: o.currency },
            { k: "Source", v: SOURCE_TYPE_LABEL[o.sourceType] ?? o.sourceType },
            { k: "Detail", v: o.source ?? "—" },
            { k: "Broker", v: o.brokerName ?? "—" },
            { k: "Vendor", v: o.vendorName ?? "—" },
            { k: "Contact", v: contactOf(o.sourceContactName, o.sourceContactEmail) },
            { k: "Sourced", v: formatDate(o.sourcedAt) },
          ]} />
          {o.referralNote && (
            <p className="mt-3 text-xs leading-relaxed text-ink-muted">{o.referralNote}</p>
          )}
        </Section>

        <Section eyebrow="Process" title="Where this stands" className="lg:border-t">
          <FactList items={[
            { k: "Owner", v: o.ownerName ?? "Unassigned" },
            { k: "Next milestone", v: o.nextMilestone
                ? `${o.nextMilestone}${o.nextMilestoneDate ? ` · ${formatDate(o.nextMilestoneDate)}` : ""}`
                : "—" },
            { k: "Last material update", v: formatDate(o.lastMaterialUpdateAt) },
            { k: "Diligence", v: file.counts.ddTotal === 0
                ? "Not started"
                : `${file.counts.ddTotal - file.counts.ddOpen} of ${file.counts.ddTotal} cleared` },
            { k: "Open issues", v: file.counts.ddIssues > 0
                ? <span className="font-medium text-negative">{file.counts.ddIssues}</span>
                : "None" },
            { k: "Overdue", v: file.counts.ddOverdue > 0
                ? <span className="font-medium text-negative">
                    {file.counts.ddOverdue} workstream{file.counts.ddOverdue === 1 ? "" : "s"}
                  </span>
                : "None" },
            { k: "Committee", v: file.counts.decisions === 0
                ? "Not yet decided"
                : `${file.counts.decisions} decision${file.counts.decisions === 1 ? "" : "s"} recorded` },
            { k: "Logged", v: formatDate(o.createdAt) },
          ]} />
        </Section>
      </div>

      <Section eyebrow="Exposure" title="Open risks" action={
        <Link href={`/opportunities/${o.opportunityId}/risks`}
          className="text-2xs font-medium text-ink-muted hover:text-ink">All risks →</Link>
      }>
        {openRisks.length === 0 ? (
          <Empty title="No open risks recorded." hint="Risks are raised directly or promoted from a diligence finding." />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {openRisks.slice(0, 5).map((r) => (
              <li key={r.riskId} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm text-ink">{r.title}</div>
                  <div className="text-2xs text-ink-faint">
                    {r.category}
                    {r.sourceDdItemId ? " · from a diligence finding" : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.financialImpact != null && (
                    <span className="tabular text-2xs text-ink-muted">
                      {formatMoneyCompact(r.financialImpact, cur)}
                    </span>
                  )}
                  <Badge tone={SEVERITY_TONE[r.severity]}>{SEVERITY_LABEL[r.severity]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function basisTitle(file: OpportunityFile): string {
  if (file.basis === "approved") return "Approved underwriting";
  if (file.basis === "working") return "Current working underwriting";
  return "Underwriting";
}

function contactOf(name: string | null, email: string | null): string {
  if (name && email) return `${name} · ${email}`;
  return name ?? email ?? "—";
}

/**
 * Only the metrics this case actually carries.
 *
 * A null is an absence, and an absence rendered as "—" in a row of figures is
 * read as a zero often enough to matter.
 */
function metricsFor(uw: UnderwritingVersion, cur: Currency) {
  const out: { label: string; value: string; sub?: string }[] = [];
  const money = (label: string, v: number | null, sub?: string) => {
    if (v != null) out.push({ label, value: formatMoneyCompact(v, cur), sub });
  };
  const pct = (label: string, v: number | null, dp = 2) => {
    if (v != null) out.push({ label, value: formatPct(v, dp) });
  };

  money("Acquisition", uw.acquisitionPrice);
  money("Total cost", uw.totalCost, uw.acquisitionCosts != null || uw.capex != null ? "incl. costs & capex" : undefined);
  money("Equity", uw.equity);
  money("Debt", uw.debt);
  pct("Leverage", uw.ltvPct, 1);
  pct("Entry yield", uw.entryYieldPct);
  pct("Target IRR", uw.targetIrr, 1);
  if (uw.targetEquityMultiple != null) {
    out.push({ label: "Equity multiple", value: formatMultiple(uw.targetEquityMultiple) });
  }
  money("Exit value", uw.exitValue);
  // Exit yield sits beside exit value deliberately: the pair is how an exit is
  // argued, and a stabilised value quoted without the yield it was struck at is
  // the half of the sentence that cannot be checked.
  pct("Exit yield", uw.exitYieldPct);
  if (uw.holdPeriodYears != null) {
    out.push({ label: "Hold", value: `${uw.holdPeriodYears} yrs` });
  }
  return out;
}
