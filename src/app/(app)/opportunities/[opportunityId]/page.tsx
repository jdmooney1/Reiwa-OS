import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getOpportunityFile } from "@/lib/data/opportunity-file";
import { listRisks } from "@/lib/data/opportunity-risks";
import { listVersions } from "@/lib/data/underwriting";
import { SummarySection } from "@/components/workspace/summary-section";

export const dynamic = "force-dynamic";

export default async function SummaryPage({
  params,
}: {
  params: { opportunityId: string };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);
  const file = await getOpportunityFile(session, params.opportunityId);
  if (!file) notFound();

  const risks = await listRisks(session, params.opportunityId);
  const openRisks = risks
    .filter((r) => r.status === "open")
    .sort((a, b) => (b.financialImpact ?? 0) - (a.financialImpact ?? 0));

  // When the summary is showing APPROVED figures and a newer working version
  // exists, say so. Otherwise a reader quoting this page has no way to know the
  // desk has moved on — and the approved numbers are still the right ones to
  // show, so silently swapping them would be worse.
  let workingAhead: { version: number } | null = null;
  if (file.basis === "approved") {
    const versions = await listVersions(session, params.opportunityId);
    const working = versions.find((v) => v.status === "current");
    if (working) workingAhead = { version: working.version };
  }

  return <SummarySection file={file} openRisks={openRisks} workingAhead={workingAhead} />;
}
