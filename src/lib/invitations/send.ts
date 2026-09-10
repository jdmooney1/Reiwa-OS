// ============================================================================
// Sending an invitation: the whole decision, in one testable place.
// ----------------------------------------------------------------------------
// The server action above this is deliberately thin — it resolves the admin,
// the origin and the transport, and then calls in here. Everything that has a
// rule attached to it lives in this file, so the rules can be exercised
// against a real database without a request context.
//
// Two guarantees are the reason this is one function rather than a sequence in
// a component:
//
//   * The raw token never leaves. It is minted, embedded in the message and
//     dropped. The return value carries the address it went to and nothing
//     more, so no invitation URL can reach a browser, a React payload or an
//     admin's history through this path.
//   * A minted invitation is never left live and undeliverable. If the send
//     fails, the invitation created moments earlier is revoked BEFORE the
//     failure is reported. There is no path out of this function that leaves a
//     working link nobody knows about.
//
// SERVER-ONLY.
// ============================================================================
import type { Session } from "@/lib/db/client";
import { listEntitlements } from "@/lib/data/investor-portal";
import { getInvestorOrganization } from "@/lib/data/admin-portal";
import {
  createInvite, revokeInvite, getInvestorContactForAdmin, listInvitesForContact,
} from "@/lib/data/investor-invites";
import { AppError, reportError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { sendEmail, type OutboundEmail, type SendResult } from "@/lib/email/send";
import {
  INVITATION_SUBJECT, invitationEmailHtml, invitationEmailText,
} from "@/lib/email/invitation-email";

export interface SentInvitation {
  /** The address it actually went to, so an admin can see it was the right one. */
  sentTo: string;
  expiresAt: string;
  /** True when this send replaced a live invitation that is now dead. */
  replacedPrevious: boolean;
}

/** The transport, injectable so a test can fail it deliberately. */
export interface DeliveryTransport {
  send: (message: OutboundEmail) => Promise<SendResult>;
}

/**
 * Everything that must be true before an invitation is worth sending.
 *
 * These are not defensive duplicates of the database's rules — the database
 * refuses a suspended organisation or a deactivated contact on its own. They
 * exist so the ADMIN finds out now, on the screen, instead of the investor
 * finding out later in front of a refusal page.
 *
 * The entitlement check is the one that is purely about the experience: an
 * investor whose first ever sign-in shows an empty portal has been given a bad
 * first impression of a private-office product, and that cannot be taken back.
 */
export async function assertSendable(db: Session, investorContactId: string) {
  const contact = await getInvestorContactForAdmin(db, investorContactId);
  if (!contact) throw new AppError("Contact not found.");
  if (!contact.isActive) {
    throw new AppError("This contact is deactivated. Reactivate them before sending an invitation.");
  }
  if (!contact.authUserId) {
    throw new AppError("Provision this contact's sign-in before sending an invitation.");
  }

  const org = await getInvestorOrganization(db, contact.investorOrgId);
  if (!org) throw new AppError("Investor organisation not found.");
  if (org.status !== "active") {
    throw new AppError(
      `Portal access for ${org.name} is ${org.status}. ` +
      "Reactivate the organisation before sending an invitation.",
    );
  }

  const entitlements = await listEntitlements(db, contact.investorOrgId);
  if (!entitlements.some((e) => e.isVisible)) {
    throw new AppError(
      "Assign at least one visible opportunity before inviting this contact — " +
      "otherwise their first sign-in shows an empty portal.",
    );
  }

  return contact;
}

/**
 * Mint an invitation and email it to the contact's own stored address.
 *
 * `origin` is the absolute portal origin (no trailing slash). It is passed in
 * rather than derived here so that this function has no dependency on a
 * request, and so the only place a domain is decided stays the caller.
 */
export async function deliverInvitation(
  db: Session,
  investorContactId: string,
  origin: string,
  actorUserId: string | null,
  transport: DeliveryTransport = { send: sendEmail },
): Promise<SentInvitation> {
  const contact = await assertSendable(db, investorContactId);

  // Whether this send invalidates a live link — decided before we replace it.
  const previous = await listInvitesForContact(db, investorContactId);
  const replacedPrevious = previous.some((i) => i.state === "active");

  // createInvite revokes any live predecessor in the same transaction, so
  // there is never a window with two working links.
  const invite = await createInvite(db, investorContactId, {}, actorUserId);
  const expiresOn = formatDate(invite.expiresAt);
  const invitationUrl = `${origin}/access/${invite.rawToken}`;
  const content = {
    recipientName: contact.name,
    invitationUrl,
    origin,
    expiresOn,
  };

  const result = await transport.send({
    to: contact.email,
    subject: INVITATION_SUBJECT,
    html: invitationEmailHtml(content),
    text: invitationEmailText(content),
  });

  if (!result.ok) {
    // Undo the mint. An invitation that exists but was never delivered is a
    // live credential nobody is watching.
    await revokeInvite(db, invite.inviteId);
    // The reason and the contact id are logged; the token and the URL are not.
    reportError("invitation.send", new Error(result.reason), { investorContactId });
    throw new AppError(
      "The invitation could not be emailed, so it has been cancelled. Nothing was sent — try again.",
    );
  }

  return { sentTo: contact.email, expiresAt: invite.expiresAt, replacedPrevious };
}
