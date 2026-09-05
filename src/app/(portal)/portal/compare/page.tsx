import Link from "next/link";
import { requirePortalSession } from "@/lib/auth/portal-session";
import { loadComparison, recordPortalEvent, COMPARE_LIMIT } from "@/lib/data/portal-feed";
import { PortalShell, PortalPageHeader } from "@/components/portal/portal-shell";
import { PortalEmptyState } from "@/components/portal/opportunity-cards";
import {
  CompareHydrator, RemoveFromCompare, ClearCompare, CompareReconciler,
} from "@/components/portal/compare-client";
import { comparisonRows } from "@/lib/portal/metrics";
import type { PortalOpportunity } from "@/lib/data/portal-feed";

export const dynamic = "force-dynamic";

/**
 * Side-by-side comparison of up to three opportunities.
 *
 * The ids arrive from the browser's selection, and are treated as a request
 * only: `loadComparison` de-duplicates them, caps the list at COMPARE_LIMIT and
 * resolves each through investor_feed under the investor's own RLS. An id that
 * is stale, revoked, withdrawn or invented resolves to nothing and simply does
 * not appear — so the cap and the entitlement are both enforced server-side,
 * whatever the client sends.
 */
export default async function PortalComparePage({
  searchParams,
}: {
  searchParams: { ids?: string };
}) {
  const investor = await requirePortalSession();

  // No ids in the URL at all: the selection is still only in the browser.
  if (searchParams.ids === undefined) {
    return (
      <PortalShell investor={investor}>
        <PortalPageHeader title="Compare" />
        <CompareHydrator />
      </PortalShell>
    );
  }

  const requested = searchParams.ids.split(",").map((s) => s.trim()).filter(Boolean);
  const opportunities = await loadComparison(investor.authUserId, requested);

  if (opportunities.length > 0) {
    await recordPortalEvent(investor.authUserId, "compared", {
      context: { publication_ids: opportunities.map((o) => o.publicationId) },
    });
  }

  return (
    <PortalShell investor={investor}>
      <CompareReconciler resolvedIds={opportunities.map((o) => o.publicationId)} />
      <PortalPageHeader
        eyebrow={`Prepared for ${investor.investorOrgName}`}
        title="Compare"
        lede={`Up to ${COMPARE_LIMIT} opportunities, side by side, on the figures approved for release to your organisation.`}
        aside={opportunities.length > 0 ? <ClearCompare /> : undefined}
      />

      {opportunities.length === 0 ? (
        <PortalEmptyState
          title="Nothing selected to compare"
          body={`Choose up to ${COMPARE_LIMIT} opportunities using Compare, and they will be set side by side here.`}
          action={
            <Link
              href="/portal"
              className="rounded bg-navy px-5 py-2.5 text-xs font-semibold text-surface hover:bg-navy-50"
            >
              Browse opportunities
            </Link>
          }
        />
      ) : (
        <ComparisonTable opportunities={opportunities} />
      )}
    </PortalShell>
  );
}

function ComparisonTable({ opportunities }: { opportunities: PortalOpportunity[] }) {
  const rows = comparisonRows(opportunities[0]).map((r) => r.key);
  const labels = new Map(comparisonRows(opportunities[0]).map((r) => [r.key, r.label]));
  const byOpportunity = opportunities.map((o) => ({
    o, values: new Map(comparisonRows(o).map((r) => [r.key, r])),
  }));

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">
            Approved investment metrics for the selected opportunities
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-48 border-b border-line px-4 py-3 text-left align-bottom">
                <span className="eyebrow">Metric</span>
              </th>
              {byOpportunity.map(({ o }) => (
                <th key={o.publicationId} scope="col"
                  className="border-b border-line px-4 py-3 text-left align-bottom">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/portal/opportunities/${o.publicationId}`}
                      className="font-serif text-base font-normal leading-snug text-ink hover:text-gold-deep"
                    >
                      {o.title}
                    </Link>
                    <RemoveFromCompare publicationId={o.publicationId} title={o.title} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((key) => (
              <tr key={key} className="border-b border-line last:border-b-0 even:bg-surface-sunken/40">
                <th scope="row" className="px-4 py-2.5 text-left text-2xs font-medium uppercase tracking-label text-ink-faint">
                  {labels.get(key)}
                </th>
                {byOpportunity.map(({ o, values }) => {
                  const m = values.get(key);
                  return (
                    <td key={o.publicationId}
                      className={`px-4 py-2.5 tabular-nums ${m?.present ? "text-ink" : "text-ink-faint"}`}>
                      {m?.value ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-10">
        <h2 className="mb-4 border-b border-line pb-2 font-serif text-lg text-ink">
          Investment rationale
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {opportunities.map((o) => (
            <div key={o.publicationId}>
              <h3 className="font-serif text-base text-ink">{o.title}</h3>
              {o.highlights.length > 0 ? (
                <ul className="mt-2.5 space-y-2">
                  {o.highlights.map((h) => (
                    <li key={h} className="flex gap-2.5 text-sm leading-relaxed text-ink-muted">
                      <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-gold" />
                      {h}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2.5 text-sm text-ink-faint">
                  No investment rationale has been released for this opportunity.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <p className="mt-8 max-w-prose text-2xs leading-relaxed text-ink-faint">
        A dash indicates a figure Reiwa Capital has not released for that opportunity. Figures are
        not adjusted or estimated to make this comparison complete, and opportunities may be
        prepared on differing assumptions.
      </p>
    </>
  );
}
