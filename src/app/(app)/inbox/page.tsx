import Link from "next/link";
import { redirect } from "next/navigation";
import { Upload } from "lucide-react";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listInbox } from "@/lib/data/ingestion";
import { listOrgs } from "@/lib/data/orgs";
import { PageHeader } from "@/components/layout/page-header";
import { InboxTable } from "@/components/inbox/inbox-table";
import { QuickEntry } from "@/components/inbox/quick-entry";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: { batch?: string };
}) {
  const auth = await requireAuth();
  if (auth.role === "investor_viewer") redirect("/pipeline");

  const session = toDbSession(auth);
  const [items, orgs] = await Promise.all([
    listInbox(session, { batchId: searchParams.batch ?? null }),
    listOrgs(session),
  ]);

  const open = items.filter((i) => i.reviewStatus === "new" || i.reviewStatus === "needs_review").length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow="Opportunities"
        title="Deal Inbox"
        description={
          open > 0
            ? `${open} item${open === 1 ? "" : "s"} awaiting review. Nothing becomes an opportunity until you approve it.`
            : "Incoming opportunities land here for review before they become Reiwa data."
        }
        actions={
          <>
            <QuickEntry orgs={orgs} />
            <Link href="/inbox/import"
              className="inline-flex items-center gap-1.5 rounded bg-navy px-3.5 py-2 text-xs font-medium text-surface hover:bg-navy-50">
              <Upload className="h-3.5 w-3.5" /> Import spreadsheet
            </Link>
          </>
        }
      />
      <div className="min-h-0 flex-1">
        <InboxTable items={items} />
      </div>
    </div>
  );
}
