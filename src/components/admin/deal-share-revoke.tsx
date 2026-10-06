"use client";

import { useState, useTransition } from "react";
import { revokeDealShareAction } from "@/app/actions/deal-shares";
import { ActionError } from "@/components/workspace/primitives";

/** Revoke a link now. It stops working on its next use; what was already seen cannot be unseen. */
export function RevokeShareButton({ shareId, prospect }: { shareId: string; prospect: string }) {
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <button
        type="button" disabled={pending} aria-label={`Revoke the link for ${prospect}`}
        onClick={() => {
          if (!window.confirm(`Revoke ${prospect}'s link? It stops working immediately.`)) return;
          setError(undefined);
          startTransition(async () => { const r = await revokeDealShareAction(shareId); if (r.error) setError(r.error); });
        }}
        className="rounded border border-line px-2.5 py-1 text-2xs font-medium text-negative hover:bg-surface-sunken disabled:opacity-50"
      >
        {pending ? "Revoking..." : "Revoke"}
      </button>
      <ActionError message={error} />
    </div>
  );
}
