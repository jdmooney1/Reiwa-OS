// ============================================================================
// Investor document delivery endpoint.
// ----------------------------------------------------------------------------
// GET /portal/documents/<documentId>
//
// The URL carries a document id and nothing else — no bucket, no object path,
// no signature, no tier. The id is a *request*: the session is re-resolved from
// the request's own Supabase cookies on every call, and the database decides
// whether this investor may read that document (see secure-delivery.ts).
//
// A successful call answers 303 with a sixty-second signed URL in Location.
// Every refusal answers 404 with no body: an investor cannot tell an unentitled
// document from an internal one from one that does not exist.
//
// The response is never cached — the signed URL inside it is short-lived and
// specific to one investor — and carries `Referrer-Policy: no-referrer` so the
// storage URL is not handed to anything the browser navigates to next.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { getPortalSession } from "@/lib/auth/portal-session";
import { issueDocumentDownload } from "@/lib/documents/secure-delivery";

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
  _request: NextRequest, { params }: { params: { documentId: string } },
): Promise<NextResponse> {
  const investor = await getPortalSession();
  if (!investor) return refuse();

  const grant = await issueDocumentDownload(investor.authUserId, params.documentId);
  if (!grant) return refuse();

  return new NextResponse(null, {
    // 303: the follow-up to the storage URL is a GET regardless of this method.
    status: 303,
    headers: {
      location: grant.signedUrl,
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
    },
  });
}
