import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listPipeline } from "@/lib/data/opportunity-file";
import { PageHeader } from "@/components/layout/page-header";
import { OpportunityPipeline } from "@/components/opportunities/opportunity-pipeline";
import { listSavedViews } from "@/lib/data/pipeline-views";
import { parseViewState, parseMode } from "@/lib/pipeline/view-state";

export const dynamic = "force-dynamic";

export default async function PipelinePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const auth = await requireAuth();
  const session = toDbSession(auth);
  const [opportunities, savedViews] = await Promise.all([listPipeline(session), listSavedViews(session)]);
  const canWrite = auth.role !== "investor_viewer";
  // The address bar IS the view: a bookmarked, filtered pipeline opens as it was saved. Anything in it
  // that is not valid is dropped rather than refused (see lib/pipeline/view-state).
  const initialState = parseViewState(searchParams);
  const initialMode = parseMode(searchParams);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow="Investment Desk"
        title="Pipeline"
        description="Opportunities across the lifecycle — persisted to the live database."
        actions={
          canWrite ? (
            <Link href="/opportunities/new" className="flex items-center gap-1.5 rounded bg-purple px-3.5 py-2 text-xs font-medium text-surface transition-colors hover:bg-purple-70">
              <Plus className="h-3.5 w-3.5" /> New Opportunity
            </Link>
          ) : null
        }
      />
      <div className="min-h-0 flex-1">
        <OpportunityPipeline
          opportunities={opportunities} initialState={initialState} initialMode={initialMode}
          savedViews={savedViews} canWrite={canWrite}
        />
      </div>
    </div>
  );
}
