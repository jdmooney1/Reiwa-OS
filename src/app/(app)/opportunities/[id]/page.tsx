import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getOpportunity } from "@/lib/data/opportunities";
import { OpportunityDetail } from "@/components/opportunities/opportunity-detail";

export const dynamic = "force-dynamic";

export default async function OpportunityPage({ params }: { params: { id: string } }) {
  const auth = await requireAuth();
  const opp = await getOpportunity(toDbSession(auth), params.id);
  if (!opp) notFound();

  return <OpportunityDetail opp={opp} canWrite={auth.canWrite} />;
}
