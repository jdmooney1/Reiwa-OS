// ============================================================================
// Internal opportunity document delivery endpoint.
// ----------------------------------------------------------------------------
// GET /opportunities/<opportunityId>/documents/<documentId>
//
// The staff-side twin of /portal/documents/<documentId>, and deliberately the
// same shape: the URL carries ids and nothing else — no bucket, no object path,
// no signature — the internal session is re-resolved on every call, and the
// database decides whether this member of staff may read that document
// (see internal-delivery.ts).
//
// A successful call answers 303 with a sixty-second signed URL in Location.
// Every refusal answers 404 with no body, so a document in another
// organisation cannot be told apart from one that does not exist.
//
// Never cached, and `Referrer-Policy: no-referrer` so the storage URL is not
// handed to whatever the browser navigates to next.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { getSession, toDbSession } from "@/lib/auth/session";
import { issueInternalDocumentDownload } from "@/lib/documents/internal-delivery";
import { reportError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** One refusal, used for every reason. */
function refuse(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: {
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { opportunityId: string; documentId: string } },
): Promise<NextResponse> {
  // An internal session, not merely an authenticated one. A portal investor has
  // no profile row and so cannot obtain one — and would in any case read no row,
  // because `app.has_org()` is false for them on every organisation.
  const auth = await getSession();
  if (!auth) return refuse();

  let signedUrl: string | null;
  try {
    signedUrl = await issueInternalDocumentDownload(
      toDbSession(auth), params.opportunityId, params.documentId);
  } catch (e) {
    // A genuine fault, not a refusal. The log gets the whole story; the caller
    // gets the same 404, so a failure cannot be told apart from a refusal.
    reportError("workspace.document.download", e, {
      opportunityId: params.opportunityId,
      documentId: params.documentId,
      userId: auth.userId,
    });
    return refuse();
  }
  if (!signedUrl) return refuse();

  return new NextResponse(null, {
    // 303: the follow-up to the storage URL is a GET regardless of this method.
    status: 303,
    headers: {
      location: signedUrl,
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
    },
  });
}
