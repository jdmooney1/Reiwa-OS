import { redirect } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listOrgs } from "@/lib/data/orgs";
import { PageHeader } from "@/components/layout/page-header";
import { NewOpportunityForm } from "@/components/opportunities/new-opportunity-form";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage() {
  const auth = await requireAuth();
  if (!auth.canWrite) redirect("/pipeline");
  const orgs = await listOrgs(toDbSession(auth));

  return (
    <div className="min-h-full">
      <PageHeader eyebrow="Investment Desk" title="Create Opportunity"
        description="Logs a new opportunity against a property and saves it to the database." />
      <div className="px-8 py-6">
        <NewOpportunityForm orgs={orgs} />
      </div>
    </div>
  );
}
