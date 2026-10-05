// ============================================================================
// Asset photograph delivery endpoint.
// ----------------------------------------------------------------------------
// GET /api/asset-photos/<photoId>[?variant=thumb]
//
// `variant=thumb` serves the 480 px rendition for lists and the board; anything
// else, or nothing, serves the full image. Authorisation is identical for both.
//
// The photograph twin of /opportunities/<id>/documents/<id>, and the same shape:
// the URL carries an id and nothing else - no bucket, no object path, no
// signature. The session is re-resolved on every call, and role and visibility
// are re-checked every call (lib/photos/delivery.ts); nothing here is cached.
//
// Success is a 303 to a sixty-second signed URL. Every refusal is the SAME 404
// with no body, so a photo in another organisation cannot be told apart from one
// that does not exist, and a read-only or investor session cannot tell a real id
// from an invented one.
//
// `no-store` so neither the browser nor a proxy keeps the redirect (the signed
// URL in it would outlive its sixty seconds), and `no-referrer` so the storage
// URL is not handed to whatever the browser visits next.
//
// Not to be confused with /api/property-photo/<propertyId>, which streams a
// live Street View frame from Google and stores nothing.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { getSession, toDbSession } from "@/lib/auth/session";
import { issuePhotoDownload } from "@/lib/photos/delivery";
import { reportError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function refuse(): NextResponse {
  return new NextResponse(null, { status: 404, headers: HEADERS });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { photoId: string } },
): Promise<NextResponse> {
  const auth = await getSession();
  if (!auth) return refuse();

  let signedUrl: string | null;
  try {
    signedUrl = await issuePhotoDownload(
      toDbSession(auth), params.photoId,
      request.nextUrl.searchParams.get("variant") === "thumb" ? "thumb" : "full");
  } catch (e) {
    reportError("workspace.photo.download", e, { photoId: params.photoId, userId: auth.userId });
    return refuse();
  }
  if (!signedUrl) return refuse();

  return new NextResponse(null, { status: 303, headers: { ...HEADERS, location: signedUrl } });
}
