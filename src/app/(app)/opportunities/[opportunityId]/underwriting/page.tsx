import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getOpportunity } from "@/lib/data/opportunities";
import { listVersions } from "@/lib/data/underwriting";
import { compareVersions } from "@/lib/underwriting/compare";
import { UnderwritingSection } from "@/components/workspace/underwriting-section";
import type { Currency } from "@/types/database";

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

  return (
    <UnderwritingSection
      opportunityId={params.opportunityId}
      versions={versions}
      comparison={comparison}
      canWrite={auth.role !== "investor_viewer"}
      currency={opp.currency as Currency}
    />
  );
}
