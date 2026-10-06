import Link from "next/link";
import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import { listShareableMemos, listShareableOpportunities, opportunityName } from "@/lib/data/deal-shares";
import { isUuid } from "@/lib/data/portal-feed";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { DealShareForm } from "@/components/admin/deal-share-form";

export const dynamic = "force-dynamic";

export default async function NewDealSharePage({ searchParams }: { searchParams: { opportunityId?: string } }) {
  const auth = await requireAdminAuth();
  const db = toDbSession(auth);
  const id = searchParams.opportunityId && isUuid(searchParams.opportunityId) ? searchParams.opportunityId : null;
  const name = id ? await opportunityName(db, id) : null;

  if (!id || !name) {
    const options = await listShareableOpportunities(db);
    return (
      <div className="min-h-full">
        <PageHeader eyebrow="Prospects" title="Share with a prospect" description="Choose the opportunity. Only one with a finalised memo can be shared." />
        <div className="px-8 py-6">
          <Card>
            {options.length === 0 ? (
              <p className="px-5 py-8 text-sm text-ink-muted">No opportunity has a finalised memo yet. Finalise a memo first.</p>
            ) : (
              <ul className="divide-y divide-line">
                {options.map((o) => (
                  <li key={o.opportunityId}>
                    <Link href={`/admin/deal-shares/new?opportunityId=${o.opportunityId}`} className="flex items-center justify-between px-5 py-3 text-sm text-ink hover:bg-surface-sunken">
                      <span>{o.name}</span><span className="text-2xs text-ink-faint">{o.finalVersions} finalised version{o.finalVersions === 1 ? "" : "s"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    );
  }

  const memos = await listShareableMemos(db, id);
  return (
    <div className="min-h-full">
      <PageHeader eyebrow="Prospects" title={`Share ${name} with a prospect`}
        description="Creates one link, named to one person. It shows the frozen documents only, never the IC memo and never anything live." />
      <div className="max-w-3xl px-8 py-6">
        <Card>
          <CardBody>
            {memos.length === 0 ? (
              <p className="text-sm text-ink-muted">This opportunity has no finalised memo yet. Finalise it first, then come back.</p>
            ) : (
              <DealShareForm opportunityId={id} memos={memos} />
            )}
          </CardBody>
        </Card>
        <p className="mt-3 text-2xs text-ink-faint"><Link href={`/admin/deal-shares?opportunityId=${id}`} className="hover:text-ink-muted">Existing links for this opportunity →</Link></p>
      </div>
    </div>
  );
}
