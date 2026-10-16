import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getOpportunity } from "@/lib/data/opportunities";
import { listVersions } from "@/lib/data/underwriting";
import { compareVersions } from "@/lib/underwriting/compare";
import { UnderwritingSection } from "@/components/workspace/underwriting-section";
import type { Currency } from "@/types/database";
import { isInternalStaff } from "@/lib/auth/admin";
import { withSession } from "@/lib/db/client";
import { getTeaserBrief } from "@/lib/data/teaser-intake";
import { TeaserBriefPanel } from "@/components/workspace/teaser-brief";

export const dynamic = "force-dynamic";

/**
 * Which two versions to compare comes from the URL, so a comparison can be
 * sent to somebody. With no parameters the page compares the two most recent
 * versions, which is the comparison people want by default.
 */
export default async function UnderwritingPage({
  params, searchParams,
}: {
  params: { opportunityId: string };
  searchParams: { from?: string; to?: string };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);
  const opp = await getOpportunity(session, params.opportunityId);
  if (!opp) notFound();

  const versions = await listVersions(session, params.opportunityId);
  const byVersion = new Map(versions.map((v) => [v.version, v]));

  let from = byVersion.get(Number(searchParams.from)) ?? null;
  let to = byVersion.get(Number(searchParams.to)) ?? null;

  if ((!from || !to) && versions.length > 1) {
    to = versions[0]; // listVersions is newest-first
    from = versions[1];
  }

  const comparison = from && to && from.caseId !== to.caseId
    ? compareVersions(from, to)
    : null;

  // The broker's own words stay with Reiwa's staff: an organisation user sees the versions, not the teaser.
  const brief = isInternalStaff(auth)
    ? await withSession(session, (tx) => getTeaserBrief(tx, params.opportunityId))
    : null;
  const working = versions.find((v) => v.status === "current") ?? versions.find((v) => v.status === "approved") ?? versions[0] ?? null;

  return (
    <>
    {brief && (
      <TeaserBriefPanel opportunityId={params.opportunityId} brief={brief} working={working}
        currency={opp.currency as Currency} />
    )}
    <UnderwritingSection
      opportunityId={params.opportunityId}
      versions={versions}
      comparison={comparison}
      canWrite={auth.role !== "investor_viewer"}
      currency={opp.currency as Currency}
    />
    </>
  );
}
