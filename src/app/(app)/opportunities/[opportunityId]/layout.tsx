import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getOpportunityFile } from "@/lib/data/opportunity-file";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";

export const dynamic = "force-dynamic";

/**
 * The opportunity file shell: one header and one section rule, shared by every
 * section beneath it.
 *
 * Authorisation is not re-implemented here. requireAuth() establishes the
 * session, and the file itself is fetched under RLS — an opportunity outside
 * the caller's organisation returns null and 404s, which is the same answer a
 * non-existent one gives. Portal investors have no profile row and so cannot
 * obtain an internal session at all.
 */
export default async function OpportunityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { opportunityId: string };
}) {
  const auth = await requireAuth();
  const file = await getOpportunityFile(toDbSession(auth), params.opportunityId);
  if (!file) notFound();

  return (
    <div className="min-h-full">
      <WorkspaceHeader file={file} canWrite={auth.role !== "investor_viewer"} />
      {children}
    </div>
  );
}
