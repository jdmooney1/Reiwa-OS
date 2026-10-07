"use client";

import { useRouter } from "next/navigation";
import { RemoveDealButton, RestoreDealButton } from "@/components/opportunities/remove-deal";
import { RESTORABLE_FROM, REMOVABLE_FROM } from "@/lib/pipeline/removal";

/** The Remove / Restore control in the opportunity file's header. It refreshes the page when done. */
export function WorkspaceRemoval({ opportunityId, name, status }: { opportunityId: string; name: string; status: string }) {
  const router = useRouter();
  if (REMOVABLE_FROM.includes(status)) {
    return <RemoveDealButton opportunityId={opportunityId} name={name} onDone={() => router.refresh()} />;
  }
  if (RESTORABLE_FROM.includes(status)) {
    return <RestoreDealButton opportunityId={opportunityId} onDone={() => router.refresh()} />;
  }
  return null;
}
