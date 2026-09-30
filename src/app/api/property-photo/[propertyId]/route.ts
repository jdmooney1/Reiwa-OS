// ============================================================================
// Property street photo, fetched live from Google on every request.
// ----------------------------------------------------------------------------
// GET /api/property-photo/<propertyId>
//
// WHY A ROUTE AND NOT AN <img src> POINTING AT GOOGLE: the Street View Static
// API authenticates with a key in the query string. The server key has no
// referrer restriction (it never reaches a browser), so a URL carrying it in a
// page would publish it. The browser asks THIS route; the key stays here.
//
// WHY LIVE AND NOT STORED: Google's terms forbid storing Street View imagery,
// so the bytes are fetched, streamed and forgotten. Only the panorama id is kept
// (properties.street_view_pano_id, migration 0017). Never written to Supabase
// Storage, never cached: the response is `private, no-store`.
//
// WHO: signed-in staff, and only for a property RLS lets them read. The internal
// session is re-resolved on every call. A portal investor has no profile row and
// cannot obtain one, and would read no property anyway (app.has_org() is false
// for them everywhere). Every refusal is the SAME 404 with no body, so a property
// in another organisation cannot be told apart from one that does not exist -
// the shape of /opportunities/<id>/documents/<id>.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { getSession, toDbSession } from "@/lib/auth/session";
import { getPropertyPhotoSource } from "@/lib/data/properties";
import { loadPropertyPhoto } from "@/lib/geo/property-photo";
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
  _request: NextRequest,
  { params }: { params: { propertyId: string } },
): Promise<NextResponse> {
  const auth = await getSession();
  if (!auth || auth.role === "investor_viewer") return refuse();

  try {
    const source = await getPropertyPhotoSource(toDbSession(auth), params.propertyId);
    if (!source) return refuse();

    const photo = await loadPropertyPhoto(source);
    if (photo.kind === "none") return refuse();
    if (photo.kind === "error") {
      // A genuine fault, not a refusal: the log gets the reason, the caller the same 404.
      reportError("workspace.property-photo", new Error(photo.reason), {
        propertyId: params.propertyId, userId: auth.userId,
      });
      return refuse();
    }
    return new NextResponse(new Uint8Array(photo.bytes), {
      status: 200,
      headers: { ...HEADERS, "content-type": photo.contentType },
    });
  } catch (e) {
    reportError("workspace.property-photo", e, { propertyId: params.propertyId, userId: auth.userId });
    return refuse();
  }
}
