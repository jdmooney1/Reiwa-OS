import { redirect } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { isInternalStaff } from "@/lib/auth/admin";
import { listOrgs } from "@/lib/data/orgs";
import { PageHeader } from "@/components/layout/page-header";
import { TeaserIntake } from "@/components/opportunities/teaser-intake";

export const dynamic = "force-dynamic";
// Reading a long teaser takes the model a minute or two; the actions on this page inherit this.
export const maxDuration = 300;

export default async function TeaserIntakePage() {
  const auth = await requireAuth();
  if (!isInternalStaff(auth)) redirect("/pipeline");
  const orgs = await listOrgs(toDbSession(auth));

  return (
    <div className="min-h-full">
      <PageHeader eyebrow="Investment Desk" title="New Deal from Teaser"
        description="Drop a broker teaser or IM. Its facts are read for you to check, and the deal is created as an untriaged draft with the teaser filed on it. Nothing is investor-visible." />
      <div className="px-8 py-6">
        <TeaserIntake orgs={orgs} />
      </div>
    </div>
  );
}
