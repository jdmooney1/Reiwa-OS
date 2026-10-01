// ============================================================================
// Investor photograph delivery endpoint.
// ----------------------------------------------------------------------------
// GET /portal/photos/<photoId>[?variant=thumb]
//
// The photograph twin of /portal/documents/<documentId>, and deliberately the
// same shape: the URL carries a photo id and nothing else - no bucket, no object
// path, no signature, no tier. The id is a REQUEST: the session is re-resolved
// from the request's own cookies on every call, and the database decides whether
// this investor may see that photograph (see lib/photos/portal-delivery.ts).
//
// A successful call answers 303 with a sixty-second signed URL in Location.
// Every refusal answers 404 with no body: an investor cannot tell a photograph
// they are not cleared for from an internal one from one that does not exist.
// A fault is logged in full and answered with the same 404, so it cannot be told
// apart from a refusal either.
//
// Never cached, and `Referrer-Policy: no-referrer` so the storage URL is not
// handed to anything the browser navigates to next.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { getPortalSession } from "@/lib/auth/portal-session";
import { issuePortalPhotoDownload } from "@/lib/photos/portal-delivery";
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
  request: NextRequest, { params }: { params: { photoId: string } },
): Promise<NextResponse> {
  const investor = await getPortalSession();
  if (!investor) return refuse();

  let signedUrl: string | null;
  try {
    signedUrl = await issuePortalPhotoDownload(
      investor.authUserId, params.photoId,
      request.nextUrl.searchParams.get("variant") === "thumb" ? "thumb" : "full");
  } catch (e) {
    reportError("portal.photo.download", e, {
      photoId: params.photoId,
      investorContactId: investor.investorContactId,
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
