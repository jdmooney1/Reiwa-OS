import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listDocuments } from "@/lib/data/opportunity-documents";
import { listDdItems } from "@/lib/data/due-diligence";
import { DocumentsSection } from "@/components/workspace/documents-section";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  params,
}: {
  params: { opportunityId: string };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);
  return (
    <DocumentsSection
      opportunityId={params.opportunityId}
      documents={await listDocuments(session, params.opportunityId)}
      ddItems={await listDdItems(session, params.opportunityId)}
      canWrite={auth.role !== "investor_viewer"}
    />
  );
}
