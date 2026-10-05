// ============================================================================
// GET /deal/<token> - a prospect opens their link.
// ----------------------------------------------------------------------------
// No session, no account, no portal shell. The token is the credential: it is hashed,
// matched to a deal share, compared in constant time and checked for expiry, revocation
// and that each memo is still final, all in src/lib/data/deal-share-access.ts. A valid
// open records one view and renders the two FROZEN documents; this page composes nothing
// and reads no live table.
//
// Every refusal is the same notFound(), whatever the reason. A database fault is a refusal
// too (fail closed), and is logged WITHOUT the token.
// ============================================================================
import { notFound } from "next/navigation";
import { openProspectShare } from "@/lib/data/deal-share-access";
import { ProspectDocument } from "@/components/deal-share/prospect-document";
import { reportError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export default async function ProspectDealPage({ params }: { params: { token: string } }) {
  let view = null;
  try {
    view = await openProspectShare(params.token);
  } catch (e) {
    reportError("prospect.deal.open", e);
  }
  if (!view) notFound();
  return <ProspectDocument view={view} token={params.token} />;
}
