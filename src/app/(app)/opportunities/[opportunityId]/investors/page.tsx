import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listDealInvestors } from "@/lib/data/deal-investors";
import { listInvestorOrganizations } from "@/lib/data/investor-portal";
import { InvestorTrackerSection } from "@/components/workspace/investor-tracker-section";

export const dynamic = "force-dynamic";

export default async function InvestorsPage({
  params,
}: {
  params: { opportunityId: string };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);

  const [investors, investorOrgs] = await Promise.all([
    listDealInvestors(session, params.opportunityId),
    listInvestorOrganizations(session),
  ]);

  return (
    <InvestorTrackerSection
      opportunityId={params.opportunityId}
      investors={investors}
      investorOrgs={investorOrgs.map((o) => ({ investorOrgId: o.investorOrgId, name: o.name }))}
      canWrite={auth.role !== "investor_viewer"}
    />
  );
}
