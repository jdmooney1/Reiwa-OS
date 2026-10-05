import Link from "next/link";
import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import { listDealShares, type DealShareRow } from "@/lib/data/deal-shares";
import { isUuid } from "@/lib/data/portal-feed";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { RevokeShareButton } from "@/components/admin/deal-share-revoke";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATE_STYLE: Record<DealShareRow["state"], string> = {
  active: "text-positive", expired: "text-ink-faint", revoked: "text-negative",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Prospect links: who was sent what, whether it is still live, and whether anyone has
 * opened it. A prospect is NOT an investor, so this is a list of its own and shares
 * nothing with the investor organisations.
 */
export default async function DealSharesPage({ searchParams }: { searchParams: { opportunityId?: string } }) {
  const auth = await requireAdminAuth();
  const opportunityId = searchParams.opportunityId && isUuid(searchParams.opportunityId) ? searchParams.opportunityId : undefined;
  const shares = await listDealShares(toDbSession(auth), { opportunityId });

  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow="Prospects"
        title="Prospect links"
        description="A named, expiring link to the frozen Asset Snapshot and Investor Teaser of one opportunity, for someone who is not yet on a mandate. Read-only, no account. Do not send one until counsel has confirmed how it may be used."
        actions={
          <Link href={`/admin/deal-shares/new${opportunityId ? `?opportunityId=${opportunityId}` : ""}`}
            className="rounded bg-purple px-3.5 py-2 text-xs font-semibold text-surface hover:bg-purple-70">
            Share with a prospect
          </Link>
        }
      />
      <div className="px-8 py-6">
        <Card>
          <CardHeader eyebrow={opportunityId ? "One opportunity" : "All opportunities"} title={`${shares.length} link${shares.length === 1 ? "" : "s"}`}
            action={opportunityId ? <Link href="/admin/deal-shares" className="text-2xs text-ink-muted hover:text-ink">Show all →</Link> : undefined} />
          {shares.length === 0 ? (
            <p className="px-5 py-8 text-sm text-ink-muted">No link has been created yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="eyebrow border-b border-line">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Prospect</th>
                    <th className="px-3 py-2.5 font-medium">Opportunity</th>
                    <th className="px-3 py-2.5 font-medium">Documents</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Created</th>
                    <th className="px-3 py-2.5 font-medium">Expires</th>
                    <th className="px-3 py-2.5 font-medium">Last viewed</th>
                    <th className="px-3 py-2.5 text-right font-medium">Views</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shares.map((s) => (
                    <tr key={s.shareId} data-share={s.shareId} data-state={s.state}>
                      <td className="px-5 py-3"><div className="text-ink">{s.prospectName}</div><div className="text-2xs text-ink-faint">{s.prospectEmail}</div></td>
                      <td className="px-3 py-3"><Link href={`/opportunities/${s.opportunityId}/memo`} className="text-ink hover:underline">{s.opportunityName}</Link></td>
                      <td className="px-3 py-3 text-xs text-ink-muted">
                        {[s.snapshotVersion !== null && `Snapshot v${s.snapshotVersion}`, s.teaserVersion !== null && `Teaser v${s.teaserVersion}`].filter(Boolean).join(", ")}
                      </td>
                      <td className={cn("px-3 py-3 text-xs font-medium capitalize", STATE_STYLE[s.state])}>{s.state}</td>
                      <td className="px-3 py-3 text-xs text-ink-muted">{formatDate(s.createdAt)}{s.createdByName ? ` by ${s.createdByName}` : ""}</td>
                      <td className="px-3 py-3 text-xs text-ink-muted">{s.revokedAt ? `Revoked ${formatDate(s.revokedAt)}` : formatDate(s.expiresAt)}</td>
                      <td className="px-3 py-3 text-xs text-ink-muted">{s.lastViewedAt ? when(s.lastViewedAt) : "Not opened"}</td>
                      <td className="tabular px-3 py-3 text-right text-ink">{s.viewCount}</td>
                      <td className="px-5 py-3 text-right">{s.state === "active" && <RevokeShareButton shareId={s.shareId} prospect={s.prospectName} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <p className="mt-3 max-w-2xl text-2xs leading-relaxed text-ink-faint">
          A view is recorded each time the link opens, so a mail scanner or a link preview can count as one. Treat the count as
          &quot;opened&quot;, not as proof that the person read it. Revoking stops the link on its next use; it cannot undo what was already seen.
        </p>
      </div>
    </div>
  );
}
