import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import { listPublicationSummaries, listEligibleOpportunities } from "@/lib/data/admin-portal";
import { PageHeader } from "@/components/layout/page-header";
import { PublicationsDirectory } from "@/components/admin/publications-directory";

export const dynamic = "force-dynamic";

export default async function AdminPublicationsPage({
  searchParams,
}: {
  searchParams: { state?: string };
}) {
  const auth = await requireAdminAuth();
  const db = toDbSession(auth);
  const [publications, eligible] = await Promise.all([
    listPublicationSummaries(db),
    listEligibleOpportunities(db),
  ]);

  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow="Investment Portal"
        title="Investor Publications"
        description="Each publication is an independent, versioned snapshot prepared for investors — never a live view of the internal opportunity."
      />
      <PublicationsDirectory
        publications={publications}
        eligible={eligible}
        initialFilter={searchParams.state ?? "all"}
      />
    </div>
  );
}
