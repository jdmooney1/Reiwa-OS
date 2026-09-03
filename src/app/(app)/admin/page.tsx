import Link from "next/link";
import { ArrowRight, FileSearch, EyeOff, UserX } from "lucide-react";
import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import { getAdminOverview } from "@/lib/data/admin-portal";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const auth = await requireAdminAuth();
  const overview = await getAdminOverview(toDbSession(auth));
  const { counts } = overview;

  const stats: { label: string; value: number; href: string }[] = [
    { label: "Investor organisations", value: counts.investorOrganizations, href: "/admin/investors" },
    { label: "Active contacts", value: counts.activeContacts, href: "/admin/investors" },
    { label: "In draft", value: counts.publicationsInDraft, href: "/admin/publications?state=draft" },
    { label: "In review", value: counts.publicationsInReview, href: "/admin/publications?state=in_review" },
    { label: "Published", value: counts.publicationsPublished, href: "/admin/publications?state=published" },
    { label: "Visible assignments", value: counts.visibleAssignments, href: "/admin/investors" },
  ];

  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow="Investment Portal"
        title="Portal Administration"
        description="Prepare investor publications from internal opportunities, run them through review, and manage what each investor organisation sees."
      />

      <div className="space-y-6 px-8 py-6">
        {/* Operational counts */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {stats.map((s) => (
            <Link key={s.label} href={s.href}
              className="group rounded-lg border border-line bg-surface-card px-4 py-3.5 transition-colors hover:border-gold/40">
              <div className="tabular font-serif text-2xl text-ink">{s.value}</div>
              <div className="eyebrow mt-1 group-hover:text-ink-muted">{s.label}</div>
            </Link>
          ))}
        </div>

        {/* Workflow queues */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card>
            <CardHeader eyebrow="Review Queue" title="Awaiting review"
              action={<FileSearch className="h-4 w-4 text-ink-faint" strokeWidth={1.5} />} />
            <CardBody className="p-0">
              {overview.reviewQueue.length === 0 ? (
                <Empty text="Nothing is waiting for review." />
              ) : (
                <ul className="divide-y divide-line">
                  {overview.reviewQueue.map((v) => (
                    <li key={v.versionId}>
                      <Link href={`/admin/publications/${v.publicationId}`}
                        className="group flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-sunken/60">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-ink">{v.title}</div>
                          <div className="mt-0.5 text-2xs text-ink-faint">
                            Version {v.versionNumber} · submitted {formatDate(v.submittedAt)}
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-faint group-hover:text-gold-deep" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader eyebrow="Distribution" title="Published, not assigned"
              action={<EyeOff className="h-4 w-4 text-ink-faint" strokeWidth={1.5} />} />
            <CardBody className="p-0">
              {overview.unassignedPublished.length === 0 ? (
                <Empty text="Every live publication is visible to at least one investor." />
              ) : (
                <ul className="divide-y divide-line">
                  {overview.unassignedPublished.map((p) => (
                    <li key={p.publicationId}>
                      <Link href={`/admin/publications/${p.publicationId}`}
                        className="group flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-sunken/60">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-ink">{p.title}</div>
                          <div className="mt-0.5 text-2xs text-ink-faint">
                            Published {formatDate(p.lastPublishedAt)} · no investor can see it
                          </div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-faint group-hover:text-gold-deep" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader eyebrow="Coverage" title="Investors without opportunities"
              action={<UserX className="h-4 w-4 text-ink-faint" strokeWidth={1.5} />} />
            <CardBody className="p-0">
              {overview.investorsWithoutAssignments.length === 0 ? (
                <Empty text="Every active investor organisation has at least one visible opportunity." />
              ) : (
                <ul className="divide-y divide-line">
                  {overview.investorsWithoutAssignments.map((o) => (
                    <li key={o.investorOrgId}>
                      <Link href={`/admin/investors/${o.investorOrgId}`}
                        className="group flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-sunken/60">
                        <div className="truncate text-sm text-ink">{o.name}</div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-faint group-hover:text-gold-deep" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-5 py-8 text-center text-xs text-ink-faint">{text}</div>;
}
