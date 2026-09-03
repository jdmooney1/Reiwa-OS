import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getOpportunity } from "@/lib/data/opportunities";
import { getPublicationForOpportunity } from "@/lib/data/admin-portal";
import { isPortalAdmin } from "@/lib/auth/admin";
import { OpportunityDetail } from "@/components/opportunities/opportunity-detail";

export const dynamic = "force-dynamic";

export default async function OpportunityPage({ params }: { params: { id: string } }) {
  const auth = await requireAuth();
  const session = toDbSession(auth);
  const opp = await getOpportunity(session, params.id);
  if (!opp) notFound();

  // Only Reiwa admins run the Investment Portal; for them, surface whether this
  // opportunity already has an investor publication.
  const portalAdmin = isPortalAdmin(auth);
  const publicationId = portalAdmin
    ? await getPublicationForOpportunity(session, opp.opportunityId)
    : null;

  return (
    <OpportunityDetail
      opp={opp}
      canWrite={auth.role !== "investor_viewer"}
      portalAdmin={portalAdmin}
      publicationId={publicationId}
    />
  );
}
