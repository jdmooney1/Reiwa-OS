"use server";

// ============================================================================
// Admin actions for prospect deal shares.
// ----------------------------------------------------------------------------
// The same double gate as every admin action: requireAdminSession() first, then every
// read and write runs under the admin's own RLS session (migration 0029 admits admins
// only). The link is composed from configuration (DEAL_SHARE_URL), never from the request.
//
// The RAW token leaves this file exactly once, in the return value of
// createDealShareAction, to the admin's own browser. It is not logged, not put in a
// revalidated path, and not stored: the database holds only its hash.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/admin";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/data/portal-feed";
import { createDealShare, revokeDealShare } from "@/lib/data/deal-shares";
import { validateShareInput, dealShareLink, dealShareOrigin } from "@/lib/deal-share/policy";

export interface CreateShareResult extends ActionResult {
  /** The complete link. Shown once; there is no way to get it back. */
  link?: string;
  expiresAt?: string;
}

export async function createDealShareAction(input: {
  opportunityId: string; prospectName: string; prospectEmail: string; ttlDays: number;
  snapshotMemoId: string | null; teaserMemoId: string | null;
}): Promise<CreateShareResult> {
  const { db, auth } = await requireAdminSession();
  let created: { link: string; expiresAt: string } | undefined;
  const result = await runAction("admin.deal-share.create", { opportunityId: input.opportunityId }, async () => {
    if (!isUuid(input.opportunityId)) throw new AppError("That opportunity could not be found.");
    // Checked BEFORE minting: a missing address must not leave a live share nobody can link to.
    const origin = dealShareOrigin();
    const valid = validateShareInput(input);
    const share = await createDealShare(db, auth.userId, input.opportunityId, valid);
    created = { link: dealShareLink(origin, share.rawToken), expiresAt: share.expiresAt };
    revalidatePath("/admin/deal-shares");
  }, { ruleMessage: "This link could not be created." });
  return created ? { ...result, ...created } : result;
}

export async function revokeDealShareAction(shareId: string): Promise<ActionResult> {
  const { db } = await requireAdminSession();
  return runAction("admin.deal-share.revoke", { shareId }, async () => {
    if (!isUuid(shareId)) throw new AppError("That link could not be found.");
    await revokeDealShare(db, shareId);
    revalidatePath("/admin/deal-shares");
  });
}
