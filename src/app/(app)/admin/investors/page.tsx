import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import { listInvestorOrgSummaries } from "@/lib/data/admin-portal";
import { PageHeader } from "@/components/layout/page-header";
import { InvestorOrgDirectory } from "@/components/admin/investor-org-directory";

export const dynamic = "force-dynamic";

export default async function AdminInvestorsPage() {
  const auth = await requireAdminAuth();
  const orgs = await listInvestorOrgSummaries(toDbSession(auth));

  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow="Investment Portal"
        title="Investor Organisations"
        description="The organisations invited into the Reiwa Capital investment portal, their contacts and what each can see."
      />
      <InvestorOrgDirectory orgs={orgs} />
    </div>
  );
}
