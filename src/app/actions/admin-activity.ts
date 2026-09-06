"use server";

// ============================================================================
// Admin activity actions (P5) — internal, Reiwa administrators only.
// ----------------------------------------------------------------------------
// The only write P5 introduces is request triage. There is deliberately no
// action here that updates or deletes an activity event: the record is an
// append-only audit trail, and no code path in this application mutates it.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/admin";
import { setInvestorRequestStatus } from "@/lib/data/investor-portal";
import type { RequestStatus } from "@/lib/data/investor-portal";

const STATUSES: RequestStatus[] = ["new", "acknowledged", "in_progress", "closed"];

/**
 * Move a request through triage. `requireAdminAuth` re-resolves the caller's
 * identity server-side, and the `investor_requests_admin` policy re-checks
 * app.is_admin() on the update itself — an investor has no update policy on
 * this table at all, so a submitted request cannot be edited by its author.
 */
export async function setRequestStatusAction(
  requestId: string, status: string,
): Promise<void> {
  const { auth, db } = await requireAdminSession();
  if (!STATUSES.includes(status as RequestStatus)) return;

  await setInvestorRequestStatus(db, requestId, status as RequestStatus, auth.userId);

  revalidatePath("/admin");
  revalidatePath("/admin/activity");
  revalidatePath("/admin/investors", "layout");
  revalidatePath("/admin/publications", "layout");
}
