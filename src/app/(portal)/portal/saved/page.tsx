import Link from "next/link";
import { requirePortalSession } from "@/lib/auth/portal-session";
import { loadSavedOpportunities } from "@/lib/data/portal-feed";
import { PortalShell, PortalPageHeader } from "@/components/portal/portal-shell";
import { OpportunityCard, PortalEmptyState } from "@/components/portal/opportunity-cards";

export const dynamic = "force-dynamic";

/**
 * This contact's own saved opportunities — personal, not shared with colleagues
 * at the same organisation.
 *
 * The list is a join against investor_feed, so an opportunity whose entitlement
 * is later hidden or revoked, or whose publication is withdrawn, disappears
 * from here even though the saved row survives. Nothing needs to be cleaned up
 * when access changes.
 */
export default async function PortalSavedPage() {
  const investor = await requirePortalSession();
  const saved = await loadSavedOpportunities(investor.authUserId);

  return (
    <PortalShell investor={investor}>
      <PortalPageHeader
        eyebrow={`Prepared for ${investor.investorOrgName}`}
        title="Saved"
        lede="Opportunities you have set aside. This list is yours alone — colleagues at your organisation keep their own."
      />

      {saved.length === 0 ? (
        <PortalEmptyState
          title="You have not saved anything yet"
          body="Use Save on an opportunity to keep it here for easy return. Saved opportunities remain available for as long as they are released to your organisation."
          action={
            <Link
              href="/portal"
              className="rounded bg-purple px-5 py-2.5 text-xs font-medium text-surface transition-colors hover:bg-purple-70"
            >
              Browse opportunities
            </Link>
          }
        />
      ) : (
        <div>
          {saved.map((o) => (
            <OpportunityCard key={o.publicationId} opportunity={o} saved />
          ))}
        </div>
      )}
    </PortalShell>
  );
}
