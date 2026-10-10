"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { runDealAssessmentAction } from "@/app/actions/deal-assessment";
import { ActionError } from "@/components/workspace/primitives";

/**
 * Two buttons, because they cost different things. "Run the model" is the
 * engine alone: free, instant, every figure. "Run with assessment" adds the
 * model's judgement, which takes a minute and is billed.
 */
export function RunControls({
  opportunityId, modelConfigured,
}: {
  opportunityId: string;
  modelConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"engine" | "full" | null>(null);
  const [error, setError] = useState<string | undefined>();

  async function run(withModel: boolean) {
    setPending(withModel ? "full" : "engine");
    setError(undefined);
    const r = await runDealAssessmentAction(opportunityId, withModel);
    setPending(null);
    if (r.error) { setError(r.error); return; }
    router.replace(`/opportunities/${opportunityId}/assessment`);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button" disabled={pending !== null} onClick={() => run(false)}
          className="rounded border border-line px-3 py-2 text-xs font-medium text-ink hover:border-line-strong disabled:opacity-50"
        >
          {pending === "engine" ? "Running…" : "Run the model"}
        </button>
        <button
          type="button" disabled={pending !== null || !modelConfigured} onClick={() => run(true)}
          title={modelConfigured ? undefined : "ANTHROPIC_API_KEY is not set on this server"}
          className="rounded bg-purple px-4 py-2 text-xs font-semibold text-surface hover:bg-purple-70 disabled:opacity-50"
        >
          {pending === "full" ? "Assessing… (about a minute)" : "Run with assessment"}
        </button>
      </div>
      {!modelConfigured && <p className="text-2xs text-ink-faint">The written assessment is not configured on this server; the model still runs.</p>}
      <ActionError message={error} />
    </div>
  );
}
