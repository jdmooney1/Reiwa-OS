import { requireAuth, toDbSession } from "@/lib/auth/session";
import { listDecisions, listAmendments } from "@/lib/data/ic-decisions";
import { listVersions } from "@/lib/data/underwriting";
import { DecisionSection, type DecisionRecord } from "@/components/workspace/decision-section";

export const dynamic = "force-dynamic";

export default async function DecisionPage({
  params,
}: {
  params: { opportunityId: string };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);

  const [decisions, versions] = await Promise.all([
    listDecisions(session, params.opportunityId),
    listVersions(session, params.opportunityId),
  ]);
  const byCase = new Map(versions.map((v) => [v.caseId, v]));

  const records: DecisionRecord[] = await Promise.all(
    decisions.map(async (decision) => ({
      decision,
      amendments: await listAmendments(session, decision.decisionId),
      version: byCase.get(decision.investmentCaseId) ?? null,
    })),
  );

  return (
    <DecisionSection
      opportunityId={params.opportunityId}
      records={records}
      versions={versions}
      canWrite={auth.role !== "investor_viewer"}
    />
  );
}
