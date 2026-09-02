import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listOpportunities } from "@/lib/data/opportunities";
import { PageHeader } from "@/components/layout/page-header";
import { OpportunityPipeline } from "@/components/opportunities/opportunity-pipeline";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const auth = await requireAuth();
  const opportunities = await listOpportunities(toDbSession(auth));
  const canWrite = auth.canWrite;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow="Investment Desk"
        title="Pipeline"
        description="Opportunities across the lifecycle — persisted to the live database."
        actions={
          canWrite ? (
            <Link href="/opportunities/new" className="flex items-center gap-1.5 rounded bg-navy px-3.5 py-2 text-xs font-medium text-surface transition-colors hover:bg-navy-50">
              <Plus className="h-3.5 w-3.5" /> New Opportunity
            </Link>
          ) : null
        }
      />
      <div className="min-h-0 flex-1">
        <OpportunityPipeline opportunities={opportunities} />
      </div>
    </div>
  );
}
