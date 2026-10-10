import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { isInternalStaff } from "@/lib/auth/admin";
import { getOpportunity } from "@/lib/data/opportunities";
import { listAssessments } from "@/lib/data/deal-assessments";
import { assessmentIsConfigured } from "@/lib/underwrite/assess";
import { AssessmentView } from "@/components/assessment/assessment-view";

export const dynamic = "force-dynamic";

/**
 * The deal assessment: the engine's numbers for the current underwriting
 * version, and the model's judgement over them when one was asked for.
 * Shows the latest run in full and lists earlier ones; a stored run is shown
 * exactly as it was recorded, never recomputed.
 */
export default async function AssessmentPage({
  params, searchParams,
}: {
  params: { opportunityId: string };
  searchParams: { run?: string };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);
  const opp = await getOpportunity(session, params.opportunityId);
  if (!opp) notFound();
  const runs = await listAssessments(session, params.opportunityId);
  const selected = runs.find((r) => r.assessmentId === searchParams.run) ?? runs[0] ?? null;
  return (
    <AssessmentView
      opportunityId={params.opportunityId}
      run={selected}
      history={runs.map((r) => ({
        assessmentId: r.assessmentId, createdAt: r.createdAt, createdByName: r.createdByName,
        tier: r.tier, verdict: r.verdict, caseVersion: r.caseVersion, hasAssessment: r.assessment !== null,
      }))}
      canRun={isInternalStaff(auth)}
      modelConfigured={assessmentIsConfigured()}
    />
  );
}
