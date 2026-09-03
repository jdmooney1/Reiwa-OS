"use server";

// ============================================================================
// Admin actions for investor access (P3): provisioning and invitations.
// ----------------------------------------------------------------------------
// Same double gate as every P2 admin action: requireAdminSession() first, then
// every read/write runs under the admin's own RLS session. The one privileged
// touch is the Supabase Auth Admin API used to pre-provision the passwordless
// investor account — SERVER-ONLY, and only after the admin gate.
//
// createInviteForContactAction returns the RAW invitation token exactly once,
// for the admin's screen; only its hash is stored anywhere.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/admin";
import { updateInvestorContact } from "@/lib/data/investor-portal";
import {
  createInvite, revokeInvite, getInvestorContactForAdmin,
} from "@/lib/data/investor-invites";
import { provisionInvestorAuthUser } from "@/lib/supabase/investor-admin";

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
  if (!contact) throw new Error("Contact not found.");
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
 * Mint (or re-mint) the contact's invitation. Any previously active invitation
 * is revoked in the same transaction, so one link is live per contact. The raw
 * token in the result is shown once and never stored.
 */
export async function createInviteForContactAction(
  investorContactId: string, investorOrgId: string,
): Promise<CreatedInvite> {
  const { db, auth } = await requireAdminSession();
  const contact = await getInvestorContactForAdmin(db, investorContactId);
  if (!contact) throw new Error("Contact not found.");
  if (!contact.authUserId) {
    throw new Error("Provision the contact's sign-in before creating an invitation.");
  }
  if (!contact.isActive) {
    throw new Error("Reactivate the contact before creating an invitation.");
  }

  const invite = await createInvite(db, investorContactId, {}, auth.userId);
  refreshInvestor(investorOrgId);
  return {
    rawToken: invite.rawToken,
    path: `/access/${invite.rawToken}`,
    expiresAt: invite.expiresAt,
  };
}

export async function revokeInviteAction(inviteId: string, investorOrgId: string): Promise<void> {
  const { db } = await requireAdminSession();
  await revokeInvite(db, inviteId);
  refreshInvestor(investorOrgId);
}
