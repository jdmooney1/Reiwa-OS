import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getOpportunity } from "@/lib/data/opportunities";
import { listScores } from "@/lib/data/scores";
import { ScoreWorkspace } from "@/components/score/score-workspace";

export const dynamic = "force-dynamic";

export default async function ScorePage({ params }: { params: { opportunityId: string } }) {
  const auth = await requireAuth();
  const session = toDbSession(auth);
  const opp = await getOpportunity(session, params.opportunityId);
  if (!opp) notFound();
  const scores = await listScores(session, params.opportunityId);
  return (
    <ScoreWorkspace
      opportunityId={params.opportunityId}
      latest={scores[0] ?? null}
      history={scores.map((s) => ({ version: s.version, scoredAt: s.scoredAt, scoredByName: s.scoredByName, view: s.view }))}
      canWrite={auth.role !== "investor_viewer"}
    />
  );
}
