import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePortalSession } from "@/lib/auth/portal-session";
import {
  loadPortalOpportunity, loadPortalDocuments, loadSavedIds,
  loadRequestsForPublication, recordPortalEvent,
} from "@/lib/data/portal-feed";
import { PortalShell } from "@/components/portal/portal-shell";
import { PortalEmptyState, InvestorNote } from "@/components/portal/opportunity-cards";
import { SaveButton, CompareButton } from "@/components/portal/portal-actions";
import { DocumentList } from "@/components/portal/document-list";
import { RequestForm } from "@/components/portal/request-form";
import {
  opportunityMetrics, locationLabel, assetTypeLabel, strategyLabel,
} from "@/lib/portal/metrics";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * One opportunity, built entirely from the active published version.
 *
 * Access is not decided here. `loadPortalOpportunity` reads investor_feed under
 * the investor's own RLS, so an unentitled, hidden, withdrawn or simply unknown
 * publication id returns null and lands on the unavailable state below — a
 * direct URL is not a way in, and a superseded version can never be reached
 * because the policy resolves the active pointer alone.
 */
export default async function PortalOpportunityPage({
  params,
}: {
  params: { publicationId: string };
}) {
  const investor = await requirePortalSession();
  const opportunity = await loadPortalOpportunity(investor.authUserId, params.publicationId);

  if (!opportunity) {
    return (
      <PortalShell investor={investor}>
        <PortalEmptyState
          title="This opportunity is not available"
          body="It may have been withdrawn, or it may not be part of the selection released to your organisation. Your Reiwa Capital contact can help if you were expecting to see it."
          action={<BackLink />}
        />
      </PortalShell>
    );
  }

  const [documents, savedIds, requests] = await Promise.all([
    loadPortalDocuments(investor.authUserId, opportunity.versionId),
    loadSavedIds(investor.authUserId),
    loadRequestsForPublication(investor.authUserId, opportunity.publicationId),
  ]);

  // A factual P1 event. Never blocks the render (see recordPortalEvent).
  await recordPortalEvent(investor.authUserId, "opportunity_viewed", {
    publicationId: opportunity.publicationId,
    versionId: opportunity.versionId,
  });

  const metrics = opportunityMetrics(opportunity);
  const o = opportunity;

  return (
    <PortalShell investor={investor}>
      <BackLink />

      <header className="mt-6 border-b border-line-strong pb-8">
        <div className="eyebrow">Prepared for</div>
        <div className="mt-1.5 text-sm font-medium text-ink">{investor.investorOrgName}</div>
        <h1 className="mt-6 max-w-3xl text-4xl leading-[1.1] tracking-[-0.025em] text-ink">
          {o.title}
        </h1>
        <p className="mt-3 text-sm text-ink-muted">
          {locationLabel(o)}
          <span className="px-2 text-line-strong">|</span>
          {assetTypeLabel(o.assetType)}
          <span className="px-2 text-line-strong">·</span>
          {strategyLabel(o.strategy)}
        </p>
        {o.headline && (
          <p className="mt-6 max-w-measure text-lg leading-relaxed text-ink">{o.headline}</p>
        )}
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <SaveButton
            publicationId={o.publicationId}
            saved={savedIds.includes(o.publicationId)}
            size="lg"
          />
          <CompareButton publicationId={o.publicationId} size="lg" />
        </div>
      </header>

      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-16">
        <div className="space-y-section-tight">
          {o.overview && (
            <Section title="Overview">
              <p className="max-w-measure whitespace-pre-line text-sm leading-relaxed text-ink">
                {o.overview}
              </p>
            </Section>
          )}

          {o.highlights.length > 0 && (
            <Section title="Investment rationale">
              <ul className="space-y-3">
                {o.highlights.map((h) => (
                  <li key={h} className="flex gap-3 text-sm leading-relaxed text-ink">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-line-strong" />
                    {h}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Documents">
            <DocumentList documents={documents} tier={o.documentAccessLevel} />
          </Section>

          <Section title="Request information">
            <RequestForm publicationId={o.publicationId} submittedCount={requests.length} />
          </Section>
        </div>

        <aside className="space-y-10 lg:sticky lg:top-10 lg:self-start">
          <section>
            <h2 className="section-rule text-2xs font-medium uppercase tracking-eyebrow text-ink">
              Investment snapshot
            </h2>
            <dl className="border-t border-line">
              {metrics.map((m) => (
                <div key={m.key} className="flex items-baseline justify-between gap-6 border-b border-line py-3">
                  <dt className="text-2xs uppercase tracking-label text-ink-faint">{m.label}</dt>
                  <dd className="figure text-base text-ink">{m.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-2xs leading-relaxed text-ink-faint">
              Targets are estimates prepared by Reiwa Capital on the assumptions set out in the
              investment materials. They are not forecasts or guarantees, and capital is at risk.
            </p>
          </section>

          {o.investorNote && <InvestorNote note={o.investorNote} />}

          {o.publishedAt && (
            <p className="text-2xs text-ink-faint">
              Published {formatDate(o.publishedAt)}.
            </p>
          )}
        </aside>
      </div>
    </PortalShell>
  );
}

function BackLink() {
  return (
    <Link
      href="/portal"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
      All opportunities
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="section-rule text-2xs font-medium uppercase tracking-eyebrow text-ink">{title}</h2>
      {children}
    </section>
  );
}
