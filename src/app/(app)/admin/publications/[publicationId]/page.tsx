import { notFound } from "next/navigation";
import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import {
  getPublication, listPublicationVersions, listPublicationDocuments,
  listInvestorOrganizations,
} from "@/lib/data/investor-portal";
import {
  getPublicationSourcePanel, listVersionDrift, listEntitlementsForPublication,
} from "@/lib/data/admin-portal";
import { PublicationDetail } from "@/components/admin/publication-detail";
import { getPublicationActivity, listRequests } from "@/lib/data/admin-activity";
import { PublicationActivitySection } from "@/components/admin/activity-sections";

export const dynamic = "force-dynamic";

export default async function AdminPublicationPage({
  params,
}: {
  params: { publicationId: string };
}) {
  const auth = await requireAdminAuth();
  const db = toDbSession(auth);

  const publication = await getPublication(db, params.publicationId).catch(() => null);
  if (!publication) notFound();

  const [versions, source, drift, entitlements, investorOrgs, activity, requests] = await Promise.all([
    listPublicationVersions(db, publication.publicationId),
    getPublicationSourcePanel(db, publication.publicationId),
    listVersionDrift(db, publication.publicationId),
    listEntitlementsForPublication(db, publication.publicationId),
    listInvestorOrganizations(db),
    getPublicationActivity(db, publication.publicationId),
    listRequests(db, { publicationId: publication.publicationId }),
  ]);

  // The one editable (or in-review) version, and the live one.
  const working = versions.find((v) => v.status === "draft" || v.status === "in_review") ?? null;
  const active = versions.find((v) => v.versionId === publication.activeVersionId) ?? null;

  const [workingDocuments, activeDocuments] = await Promise.all([
    working ? listPublicationDocuments(db, working.versionId) : Promise.resolve([]),
    active && active.versionId !== working?.versionId
      ? listPublicationDocuments(db, active.versionId)
      : Promise.resolve([]),
  ]);

  return (
    <>
      <PublicationDetail
      publication={publication}
      versions={versions}
      working={working}
      active={active}
      workingDocuments={workingDocuments}
      activeDocuments={activeDocuments}
      source={source}
      drift={drift}
      entitlements={entitlements}
      investorOrgs={investorOrgs}
    />
      <div className="mx-auto w-full max-w-6xl px-6 pb-10">
        <PublicationActivitySection
          activity={activity}
          requests={requests}
          publicationId={publication.publicationId}
        />
      </div>
    </>
  );
}
