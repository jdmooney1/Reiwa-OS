import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listDealDocuments } from "@/lib/data/deal-documents";
import { readinessSummary } from "@/lib/data/deal-gates";
import { getOpportunity } from "@/lib/data/opportunities";
import { DealReadinessSection } from "@/components/workspace/deal-readiness-section";

export const dynamic = "force-dynamic";

export default async function ReadinessPage({
  params,
}: {
  params: { opportunityId: string };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);

  const [documents, readiness, opportunity] = await Promise.all([
    listDealDocuments(session, params.opportunityId),
    readinessSummary(session, params.opportunityId),
    getOpportunity(session, params.opportunityId),
  ]);

  return (
    <DealReadinessSection
      opportunityId={params.opportunityId}
      documents={documents}
      readiness={readiness}
      documentStage={opportunity?.documentStage ?? 0}
      canWrite={auth.role !== "investor_viewer"}
      canOverride={auth.role === "reiwa_admin" || auth.role === "ic_member"}
    />
  );
}
