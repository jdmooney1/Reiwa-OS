import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listDdItems, appliedTemplates } from "@/lib/data/due-diligence";
import { listRisks } from "@/lib/data/opportunity-risks";
import { computeProgress, criticalOpenItems } from "@/lib/dd/progress";
import { DiligenceSection } from "@/components/workspace/diligence-section";

export const dynamic = "force-dynamic";

export default async function DiligencePage({
  params,
}: {
  params: { opportunityId: string };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);

  const items = await listDdItems(session, params.opportunityId);
  const templates = await appliedTemplates(session, params.opportunityId);
  const risks = await listRisks(session, params.opportunityId);

  // Which findings already have a risk, so the screen offers "raise risk" only
  // where it would succeed rather than where it would be refused.
  const promoted = risks
    .map((r) => r.sourceDdItemId)
    .filter((id): id is string => id !== null);

  return (
    <DiligenceSection
      opportunityId={params.opportunityId}
      items={items}
      progress={computeProgress(items)}
      critical={criticalOpenItems(items) as typeof items}
      appliedTemplates={templates}
      promotedItemIds={promoted}
      canWrite={auth.role !== "investor_viewer"}
    />
  );
}
