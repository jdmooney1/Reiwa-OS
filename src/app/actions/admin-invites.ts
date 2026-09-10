"use server";

// ============================================================================
// Admin actions for investor access (P3): provisioning and invitations.
// ----------------------------------------------------------------------------
// Same double gate as every P2 admin action: requireAdminSession() first, then
// every read/write runs under the admin's own RLS session. The one privileged
// touch is the Supabase Auth Admin API used to pre-provision the passwordless
// investor account — SERVER-ONLY, and only after the admin gate.
//
// These actions are deliberately thin. Sending an invitation has real rules
// attached to it — prerequisites, and undoing the mint when delivery fails —
// and those live in src/lib/invitations/send.ts so they can be tested against
// a real database without a request. What is decided HERE is only what needs a
// request: who the admin is. The link's origin is configuration, not request.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/admin";
import { updateInvestorContact } from "@/lib/data/investor-portal";
import {
  createInvite, revokeInvite, getInvestorContactForAdmin,
} from "@/lib/data/investor-invites";
import { provisionInvestorAuthUser } from "@/lib/supabase/investor-admin";
import { AppError } from "@/lib/errors";
import { investorPortalUrl } from "@/lib/email/portal-url";
import { emailIsConfigured, notConfiguredError } from "@/lib/email/send";
import {
  assertSendable, deliverInvitation, type SentInvitation,
} from "@/lib/invitations/send";

export type { SentInvitation };

function refreshInvestor(investorOrgId: string): void {
  revalidatePath("/admin/investors");
  revalidatePath(`/admin/investors/${investorOrgId}`);
}

/**
 * Pre-provision the Supabase Auth identity for a contact (passwordless,
 * OTP-only). This is the ONLY way investor Auth users come into existence.
 */
export async function provisionContactAccessAction(
  investorContactId: string, investorOrgId: string,
): Promise<void> {
  const { db } = await requireAdminSession();
  const contact = await getInvestorContactForAdmin(db, investorContactId);
  if (!contact) throw new AppError("Contact not found.");
  if (contact.authUserId) { refreshInvestor(investorOrgId); return; }

  const authUserId = await provisionInvestorAuthUser(contact.email, contact.name);
  await updateInvestorContact(db, investorContactId, { authUserId });
  refreshInvestor(investorOrgId);
}

export interface CreatedInvite {
  rawToken: string;
  path: string;
  expiresAt: string;
}

/**
 * Mint an invitation and return the RAW link for the admin's screen.
 *
 * Retained as the administrator fallback for the rare case where email cannot
 * be used — a bouncing domain, or an investor who wants the link by another
 * channel. sendInvitationAction is the ordinary path, and it never puts the
 * token in the browser.
 */
export async function createInviteForContactAction(
  investorContactId: string, investorOrgId: string,
): Promise<CreatedInvite> {
  const { db, auth } = await requireAdminSession();
  await assertSendable(db, investorContactId);

  const invite = await createInvite(db, investorContactId, {}, auth.userId);
  refreshInvestor(investorOrgId);
  return {
    rawToken: invite.rawToken,
    path: `/access/${invite.rawToken}`,
    expiresAt: invite.expiresAt,
  };
}

/**
 * The primary action: mint an invitation and email it to the contact's own
 * stored address. The token never reaches the browser — the result carries the
 * address it went to and nothing else.
 */
export async function sendInvitationAction(
  investorContactId: string, investorOrgId: string,
): Promise<SentInvitation> {
  const { db, auth } = await requireAdminSession();
  // Fail before minting anything, where we can.
  if (!emailIsConfigured()) throw notConfiguredError();
  // The canonical configured address — never anything from the request.
  const origin = investorPortalUrl();

  try {
    return await deliverInvitation(db, investorContactId, origin, auth.userId);
  } finally {
    // Whether it sent or was cancelled, the invitation state on screen changed.
    refreshInvestor(investorOrgId);
  }
}

export async function revokeInviteAction(inviteId: string, investorOrgId: string): Promise<void> {
  const { db } = await requireAdminSession();
  await revokeInvite(db, inviteId);
  refreshInvestor(investorOrgId);
}
