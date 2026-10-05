// ============================================================================
// Frozen memo asset delivery.
// ----------------------------------------------------------------------------
// GET /api/memo-assets/<memoId>/<photo|map>
//
// The picture a FINALISED Asset Snapshot froze at finalisation (src/lib/memo/assets.ts).
// The twin of /api/asset-photos/<id>, with the same shape: the URL carries a memo id and a
// slot and nothing else - no bucket, no path, no photograph id. The session is re-resolved on
// every call, the memo is read as the caller (so RLS decides it is theirs), the role is
// re-checked, and every refusal is the SAME 404 with no body, so a memo in another
// organisation cannot be told from one that does not exist. Success is a 303 to a sixty-second
// signed URL, `no-store`, `no-referrer`.
//
// It reads only `memos`. It never touches property_photos, which is the point.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { getSession, toDbSession } from "@/lib/auth/session";
import { issueMemoAssetDownload } from "@/lib/data/memo-assets";
import { isSnapshotSlot } from "@/lib/memo/snapshot-images";
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
  { params }: { params: { memoId: string; slot: string } },
): Promise<NextResponse> {
  const auth = await getSession();
  if (!auth || !isSnapshotSlot(params.slot)) return refuse();

  let signedUrl: string | null;
  try {
    signedUrl = await issueMemoAssetDownload(toDbSession(auth), params.memoId, params.slot);
  } catch (e) {
    reportError("workspace.memo-asset.download", e, { memoId: params.memoId, userId: auth.userId });
    return refuse();
  }
  if (!signedUrl) return refuse();
  return new NextResponse(null, { status: 303, headers: { ...HEADERS, location: signedUrl } });
}
