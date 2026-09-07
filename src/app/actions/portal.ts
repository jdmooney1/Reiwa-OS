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
  loadPortalOpportunity, resolveDocumentDownload,
} from "@/lib/data/portal-feed";
import { createSignedDocumentUrl, documentObjectExists } from "@/lib/supabase/storage";
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

// ---- Secure document delivery (P6) -----------------------------------------

export type DocumentRequest =
  | { ok: true; url: string; fileName: string }
  | { ok: false; reason: "signed_out" | "not_available" | "missing_file" | "failed" };

/**
 * Hand back a short-lived download link for one document.
 *
 * Authorisation happens first and entirely in the database:
 * `resolveDocumentDownload` reads the row under the investor's OWN row level
 * security, so identity, active contact, active organisation, visible
 * entitlement, active published version and document tier are all re-checked on
 * every single request — `internal` included, which no tier can ever reach.
 * Only once that returns a row is a URL signed, and it expires in a minute.
 *
 * A revoked entitlement therefore stops the NEXT download immediately: there is
 * no standing grant to withdraw and no cache to clear.
 */
export async function requestDocumentUrlAction(documentId: string): Promise<DocumentRequest> {
  const investor = await getPortalSession();
  if (!investor) return { ok: false, reason: "signed_out" };

  const document = await resolveDocumentDownload(investor.authUserId, documentId);
  if (!document) return { ok: false, reason: "not_available" };

  // Distinguish "you may not have this" from "we have not uploaded it yet", so
  // the investor is told something true rather than shown a broken link.
  if (!(await documentObjectExists(document.storagePath))) {
    return { ok: false, reason: "missing_file" };
  }

  const url = await createSignedDocumentUrl(document.storagePath, {
    downloadAs: document.fileName,
  });
  if (!url) return { ok: false, reason: "failed" };

  // Recorded only now — after a real, authorised delivery.
  await recordPortalEvent(investor.authUserId, "document_downloaded", {
    publicationId: document.publicationId,
    versionId: document.versionId,
    context: { document_id: documentId },
  });

  return { ok: true, url, fileName: document.fileName };
}
