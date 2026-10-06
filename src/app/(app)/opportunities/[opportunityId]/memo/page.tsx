import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { latestMemo, composeLive } from "@/lib/data/memos";
import { MemoWorkspace } from "@/components/memo/memo-workspace";
import { FORMAT_BY_KEY, type OutputFormat } from "@/lib/memo/sections";

export const dynamic = "force-dynamic";

/** Only a format sections.ts defines is honoured; anything else is the teaser. */
function parseFormat(raw: string | string[] | undefined): OutputFormat {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v in FORMAT_BY_KEY ? (v as OutputFormat) : "teaser";
}

export default async function MemoPage({
  params, searchParams,
}: {
  params: { opportunityId: string };
  searchParams: { format?: string | string[] };
}) {
  const auth = await requireAuth();
  const session = toDbSession(auth);
  const [live, memo] = await Promise.all([
    composeLive(session, params.opportunityId),
    latestMemo(session, params.opportunityId),
  ]);
  if (!live) notFound();

  return (
    <MemoWorkspace
      opportunityId={params.opportunityId}
      memo={memo}
      live={live}
      format={parseFormat(searchParams.format)}
      canWrite={auth.role !== "investor_viewer"}
      canShare={auth.role === "reiwa_admin"}
      canReview={auth.role === "reiwa_admin"}
    />
  );
}
