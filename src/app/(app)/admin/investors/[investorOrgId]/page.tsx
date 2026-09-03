import { notFound } from "next/navigation";
import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import { listInvestorContacts, listPublicationsForInvestorOrg } from "@/lib/data/investor-portal";
import { getInvestorOrganization, listPublicationOptions } from "@/lib/data/admin-portal";
import { InvestorOrgDetail } from "@/components/admin/investor-org-detail";

export const dynamic = "force-dynamic";

export default async function AdminInvestorDetailPage({
  params,
}: {
  params: { investorOrgId: string };
}) {
  const auth = await requireAdminAuth();
  const db = toDbSession(auth);

  const org = await getInvestorOrganization(db, params.investorOrgId).catch(() => null);
  if (!org) notFound();

  const [contacts, assignments, options] = await Promise.all([
    listInvestorContacts(db, org.investorOrgId),
    listPublicationsForInvestorOrg(db, org.investorOrgId),
    listPublicationOptions(db),
  ]);

  return (
    <InvestorOrgDetail
      org={org}
      contacts={contacts}
      assignments={assignments}
      publicationOptions={options}
    />
  );
}
