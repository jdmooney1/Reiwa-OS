"use server";

// ============================================================================
// Investor portal actions (P4) — save, compare, request information.
// ----------------------------------------------------------------------------
// Every action re-resolves the investor identity from the request's Supabase
// session before it does anything. Nothing the browser submits is trusted as an
// authorisation: a publication id is only ever a *request* to act on something,
// and the P1 policies decide whether it is allowed. A revoked entitlement, a
// deactivated contact or a suspended organisation therefore stops these actions
// at the database, in the same statement that would have written the row.
// ============================================================================
import { revalidatePath } from "next/cache";
import { getPortalSession } from "@/lib/auth/portal-session";
import {
  saveOpportunity, unsaveOpportunity, submitRequest, recordPortalEvent,
  loadPortalOpportunity,
} from "@/lib/data/portal-feed";
import type { RequestType } from "@/lib/data/investor-portal";

const REQUEST_TYPES: RequestType[] = ["information", "diligence_access", "meeting"];

export interface RequestFormState {
  ok?: boolean;
  error?: string;
}

/** Toggle this contact's saved state for one opportunity. */
export async function toggleSaveAction(publicationId: string, saved: boolean): Promise<void> {
  const investor = await getPortalSession();
  if (!investor) return;

  if (saved) {
    // The insert's WITH CHECK re-tests entitlement, so an unentitled id writes
    // nothing; only record the event when a row actually appeared.
    if (await saveOpportunity(investor.authUserId, publicationId)) {
      await recordPortalEvent(investor.authUserId, "saved", { publicationId });
    }
  } else if (await unsaveOpportunity(investor.authUserId, publicationId)) {
    await recordPortalEvent(investor.authUserId, "unsaved", { publicationId });
  }

  revalidatePath("/portal");
  revalidatePath("/portal/saved");
  revalidatePath(`/portal/opportunities/${publicationId}`);
}

/** Submit an information request against an entitled opportunity. */
export async function submitRequestAction(
  publicationId: string, _prev: RequestFormState, formData: FormData,
): Promise<RequestFormState> {
  const investor = await getPortalSession();
  if (!investor) return { error: "Your session has ended. Sign in again to continue." };

  const requested = String(formData.get("requestType") ?? "");
  const requestType = (REQUEST_TYPES as string[]).includes(requested)
    ? (requested as RequestType)
    : "information";
  const message = String(formData.get("message") ?? "");

  // Re-read the opportunity through the investor's own RLS. This is what turns
  // a forged or revoked publication id into a refusal rather than a request
  // against something they cannot see.
  const opportunity = await loadPortalOpportunity(investor.authUserId, publicationId);
  if (!opportunity) {
    return { error: "This opportunity is no longer available to you." };
  }

  const requestId = await submitRequest(investor.authUserId, publicationId, requestType, message);
  if (!requestId) return { error: "We could not submit that request. Please try again." };

  await recordPortalEvent(investor.authUserId, "information_requested", {
    publicationId,
    versionId: opportunity.versionId,
    context: { request_type: requestType },
  });
  revalidatePath(`/portal/opportunities/${publicationId}`);
  return { ok: true };
}
