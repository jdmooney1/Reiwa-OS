import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getOpportunity } from "@/lib/data/opportunities";
import { listRisks } from "@/lib/data/opportunity-risks";
import { RisksSection } from "@/components/workspace/risks-section";
import type { Currency } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function RisksPage({
  params,
}: {
  params: { opportunityId: string };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);
  const opp = await getOpportunity(session, params.opportunityId);
  if (!opp) notFound();

  return (
    <RisksSection
      opportunityId={params.opportunityId}
      risks={await listRisks(session, params.opportunityId)}
      canWrite={auth.role !== "investor_viewer"}
      currency={opp.currency as Currency}
    />
  );
}
