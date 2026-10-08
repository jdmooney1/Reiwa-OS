import { requireAuth, toDbSession } from "@/lib/auth/session";
import { isPortalAdmin } from "@/lib/auth/admin";
import { getPublicationForOpportunity, listEntitlementsForPublication } from "@/lib/data/admin-portal";
import {
  getPublication, listPublicationVersions, getVersionProvenance, publicationSourceDrift,
} from "@/lib/data/investor-portal";
import { getOpportunity } from "@/lib/data/opportunities";
import { PublicationSection, type PublicationView } from "@/components/workspace/publication-section";
import { matchingInvestorsForOpportunity } from "@/lib/data/investor-mandates";
import { MatchingInvestorsCard } from "@/components/admin/mandate-matches";

export const dynamic = "force-dynamic";

/**
 * Publication is administered by Reiwa administrators only, so a non-admin sees
 * the boundary rather than the contents. That is an application-level courtesy:
 * the enforcement is in the portal tables' own policies, which require
 * app.is_admin() regardless of what this page does.
 */
export default async function PublicationPage({
  params,
}: {
  params: { opportunityId: string };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);
  const portalAdmin = isPortalAdmin(auth);

  if (!portalAdmin) {
    return (
      <PublicationSection
        opportunityId={params.opportunityId}
        publication={null}
        portalAdmin={false}
      />
    );
  }

  const [opportunity, publicationId] = await Promise.all([
    getOpportunity(session, params.opportunityId),
    getPublicationForOpportunity(session, params.opportunityId),
  ]);
  let view: PublicationView | null = null;

  if (publicationId) {
    const [publication, versions, entitlements] = await Promise.all([
      getPublication(session, publicationId),
      listPublicationVersions(session, publicationId),
      listEntitlementsForPublication(session, publicationId),
    ]);
    // The version an investor currently sees, else the most recent draft.
    const active = versions.find((v) => v.status === "published") ?? versions[0] ?? null;
    const provenance = active ? await getVersionProvenance(session, active.versionId) : null;
    const drift = active ? await publicationSourceDrift(session, active.versionId) : null;

    view = {
      publicationId,
      // Never `?? "draft"`. A publication that could not be read is not a
      // draft publication; the section says so rather than inventing a state.
      status: publication?.status ?? null,
      activeVersionNumber: active ? active.versionNumber : null,
      activeVersionTitle: active ? active.title : null,
      activeVersionStatus: active ? active.status : null,
      publishedAt: active?.publishedAt ?? null,
      provenance,
      entitlements,
      sourceChanged: drift?.changed ?? false,
    };
  }

  // Staff only (this branch is the portal-admin one). Hidden until 0050 is applied.
  const investorMatches = await matchingInvestorsForOpportunity(session, params.opportunityId);

  return (
    <>
      <PublicationSection
        opportunityId={params.opportunityId}
        publication={view}
        portalAdmin
        investorOverview={opportunity?.investorOverview ?? null}
        internalSummary={opportunity?.summary ?? null}
      />
      {investorMatches.available && (
        <div className="px-8 pb-8">
          <MatchingInvestorsCard mandateCount={investorMatches.mandateCount} investors={investorMatches.investors} />
        </div>
      )}
    </>
  );
}
