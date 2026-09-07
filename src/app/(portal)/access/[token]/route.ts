// ============================================================================
// The invitation link. The ONLY place a raw token ever appears in a URL.
// ----------------------------------------------------------------------------
// GET /access/<token>
//
// This renders nothing. It validates the token server-side, moves it into a
// short-lived httpOnly cookie and answers 303 to /access, which carries no
// token. So the token-bearing URL is never a page the browser stays on: it is
// not what history records as the current entry, nothing is loaded from it that
// could leak a Referer, and the address bar shows /access by the time anyone
// looks at the screen.
//
// The response is never cached and sends no referrer, because a redirect that
// a shared cache kept, or a Referer carrying the token to a third party, would
// undo the whole point.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server";
import { validateInviteToken } from "@/lib/data/investor-invites";
import { attachInviteToken, attachInviteStatus } from "@/lib/auth/invite-session";

export const dynamic = "force-dynamic";

function redirectToAccess(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL("/access", request.url), 303);
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export async function GET(
  request: NextRequest, { params }: { params: { token: string } },
): Promise<NextResponse> {
  const rawToken = decodeURIComponent(params.token);
  const invite = await validateInviteToken(rawToken);
  const response = redirectToAccess(request);

  // A refused invitation hands on only the REASON. /access has to explain what
  // happened; it has no reason to be able to retry the token.
  return invite.ok
    ? attachInviteToken(response, rawToken)
    : attachInviteStatus(response, invite.reason);
}
