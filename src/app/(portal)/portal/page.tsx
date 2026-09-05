import { requirePortalSession } from "@/lib/auth/portal-session";
import { loadPortalFeed, loadSavedIds } from "@/lib/data/portal-feed";
import { PortalShell } from "@/components/portal/portal-shell";
import {
  FeaturedOpportunity, OpportunityCard, PortalEmptyState,
} from "@/components/portal/opportunity-cards";

export const dynamic = "force-dynamic";

/**
 * The investor's home. Everything on it comes from investor_feed under the
 * investor's own RLS, so the page has no way to render an opportunity they are
 * not currently entitled to: there is no filtering decision in this file.
 */
export default async function PortalHomePage() {
  const investor = await requirePortalSession();
  const [feed, savedIds] = await Promise.all([
    loadPortalFeed(investor.authUserId),
    loadSavedIds(investor.authUserId),
  ]);
  const isSaved = (id: string) => savedIds.includes(id);
  const nothing = !feed.featured && feed.secondary.length === 0;

  return (
    <PortalShell investor={investor}>
      <header className="mb-8 border-b border-line pb-5">
        <div className="eyebrow mb-1.5">Prepared for {investor.investorOrgName}</div>
        <h1 className="font-serif text-2xl leading-tight text-ink">
          Reiwa Capital Investment Portal
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          A curated selection of opportunities released to {investor.investorOrgName} by Reiwa
          Capital. Each is presented from the approved investment publication.
        </p>
      </header>

      {nothing ? (
        <PortalEmptyState
          title="No opportunities are currently released to you"
          body={`Reiwa Capital has not yet released an opportunity to ${investor.investorOrgName}. When one is made available it will appear here, and your Reiwa contact will let you know.`}
        />
      ) : (
        <div className="space-y-12">
          {feed.featured ? (
            <FeaturedOpportunity
              opportunity={feed.featured}
              saved={isSaved(feed.featured.publicationId)}
            />
          ) : (
            <section>
              <SectionHeading title="Selected for your review" />
              <PortalEmptyState
                title="No featured opportunity at present"
                body="Reiwa Capital is not currently highlighting a single opportunity for your organisation. Those released to you appear below."
              />
            </section>
          )}

          {feed.secondary.length > 0 && (
            <section>
              <SectionHeading
                title="Also available"
                note={`${feed.secondary.length} ${feed.secondary.length === 1 ? "opportunity" : "opportunities"}`}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                {feed.secondary.map((o) => (
                  <OpportunityCard
                    key={o.publicationId}
                    opportunity={o}
                    saved={isSaved(o.publicationId)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </PortalShell>
  );
}

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-5 flex items-baseline justify-between gap-4 border-b border-line pb-2.5">
      <h2 className="font-serif text-lg text-ink">{title}</h2>
      {note && <span className="text-2xs uppercase tracking-label text-ink-faint">{note}</span>}
    </div>
  );
}
