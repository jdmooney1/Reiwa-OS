import { redirect } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listOrgs } from "@/lib/data/orgs";
import { PageHeader } from "@/components/layout/page-header";
import { ImportPanel } from "@/components/inbox/import-panel";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const auth = await requireAuth();
  if (auth.role === "investor_viewer") redirect("/pipeline");
  const orgs = await listOrgs(toDbSession(auth));

  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow="Deal Inbox"
        title="Import a broker spreadsheet"
        description="Map the columns once, preview what lands, then stage the rows for review. Unrecognised columns are kept against the source row, never discarded."
      />
      <ImportPanel orgs={orgs} />
    </div>
  );
}
