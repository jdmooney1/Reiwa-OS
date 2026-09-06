import { notFound } from "next/navigation";
import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import { listInvestorContacts, listPublicationsForInvestorOrg } from "@/lib/data/investor-portal";
import { getInvestorOrganization, listPublicationOptions } from "@/lib/data/admin-portal";
import { listInvitesForOrg } from "@/lib/data/investor-invites";
import { InvestorOrgDetail } from "@/components/admin/investor-org-detail";
import { getOrgActivity, listRequests } from "@/lib/data/admin-activity";
import { OrgActivitySection } from "@/components/admin/activity-sections";

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

  const [contacts, assignments, options, invites, activity, requests] = await Promise.all([
    listInvestorContacts(db, org.investorOrgId),
    listPublicationsForInvestorOrg(db, org.investorOrgId),
    listPublicationOptions(db),
    listInvitesForOrg(db, org.investorOrgId),
    getOrgActivity(db, org.investorOrgId),
    listRequests(db, { investorOrgId: org.investorOrgId }),
  ]);

  return (
    <>
      <InvestorOrgDetail
      org={org}
      contacts={contacts}
      assignments={assignments}
      publicationOptions={options}
      invites={invites}
    />
      <div className="mx-auto w-full max-w-6xl px-6 pb-10">
        <OrgActivitySection
          summary={activity}
          requests={requests}
          investorOrgId={org.investorOrgId}
        />
      </div>
    </>
  );
}
