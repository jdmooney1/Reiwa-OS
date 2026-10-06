// ============================================================================
// GET /deal/<token>/image/<photo|map> - a frozen Snapshot picture, for a prospect.
// ----------------------------------------------------------------------------
// The prospect's twin of /api/memo-assets/<memoId>/<slot>, which is staff-only and needs a
// session a prospect does not have. The same token that opens the page opens this, through
// the same check, and every refusal is the SAME bare 404. Success is a 303 to a
// sixty-second signed URL for the copy frozen at finalisation, `no-store`, `no-referrer`.
// It reads deal_shares and memos only, and records no view (the page already did).
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { frozenPictureForShare } from "@/lib/data/deal-share-access";
import { reportError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
};

const refuse = () => new NextResponse(null, { status: 404, headers: HEADERS });

export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string; slot: string } },
): Promise<NextResponse> {
  let signedUrl: string | null = null;
  try {
    signedUrl = await frozenPictureForShare(params.token, params.slot);
  } catch (e) {
    reportError("prospect.deal.image", e, { slot: params.slot });
  }
  if (!signedUrl) return refuse();
  return new NextResponse(null, { status: 303, headers: { ...HEADERS, location: signedUrl } });
}
