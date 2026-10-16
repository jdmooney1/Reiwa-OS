import { redirect } from "next/navigation";
import Link from "next/link";
import { FileUp } from "lucide-react";
import { isInternalStaff } from "@/lib/auth/admin";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listOrgs } from "@/lib/data/orgs";
import { PageHeader } from "@/components/layout/page-header";
import { NewOpportunityForm } from "@/components/opportunities/new-opportunity-form";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage() {
  const auth = await requireAuth();
  if (auth.role === "investor_viewer") redirect("/pipeline");
  const orgs = await listOrgs(toDbSession(auth));

  return (
    <div className="min-h-full">
      <PageHeader eyebrow="Investment Desk" title="Create Opportunity"
        description="Logs a new opportunity against a property and saves it to the database."
        actions={isInternalStaff(auth) ? (
          <Link href="/opportunities/intake" className="flex items-center gap-1.5 rounded border border-line px-3.5 py-2 text-xs font-medium text-ink transition-colors hover:border-line-strong">
            <FileUp className="h-3.5 w-3.5" /> Start from a teaser instead
          </Link>
        ) : undefined} />
      <div className="px-8 py-6">
        <NewOpportunityForm orgs={orgs} />
      </div>
    </div>
  );
}
