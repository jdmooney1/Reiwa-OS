import Link from "next/link";
import { validateInviteToken } from "@/lib/data/investor-invites";
import { readInviteToken, readInviteStatus } from "@/lib/auth/invite-session";
import { maskEmail } from "@/lib/auth/investor-access";
import { requestOtpForInviteAction } from "@/app/actions/portal-access";
import { formatDate } from "@/lib/format";
import { AccessFrame } from "@/components/portal/access-frame";

export const dynamic = "force-dynamic";

// The invitation landing page. The token reached the server at
// /access/<token>, which moved it into an httpOnly cookie and redirected here,
// so this URL carries nothing: it is what history keeps, what a Referer would
// disclose and what the recipient sees in the address bar.
//
// The invitation is re-validated on every render rather than trusted from the
// hand-off, so an invitation revoked between the click and the click-through is
// refused here too. The token still identifies the intended access context and
// nothing more — no access is granted until the OTP to the authorised email is
// verified.
export default async function AccessPage() {
  const rawToken = readInviteToken();
  const invite = rawToken ? await validateInviteToken(rawToken) : null;

  if (!invite?.ok) {
    const reason = invite ? invite.reason : (readInviteStatus() ?? "not_found");
    const copy: Record<string, { title: string; body: string }> = {
      expired: {
        title: "This invitation has expired",
        body: "For security, invitation links are time-limited. Please ask your Reiwa Capital contact to issue a new one.",
      },
      revoked: {
        title: "This invitation is no longer valid",
        body: "The link has been withdrawn. Please ask your Reiwa Capital contact to issue a new one.",
      },
      accepted: {
        title: "This invitation has already been used",
        body: "Your access is set up — sign in directly with your authorised email address.",
      },
      contact_inactive: {
        title: "Access unavailable",
        body: "This contact is not currently active. Please get in touch with Reiwa Capital.",
      },
      org_not_active: {
        title: "Access unavailable",
        body: "Portal access for your organisation is currently paused. Please get in touch with Reiwa Capital.",
      },
      not_provisioned: {
        title: "Access not ready yet",
        body: "Your sign-in has not been finalised. Please get in touch with Reiwa Capital.",
      },
      not_found: {
        title: "Invitation not recognised",
        body: "Check that the link was copied completely, or ask your Reiwa Capital contact for a new invitation.",
      },
    };
    const c = copy[reason] ?? copy.not_found;
    return (
      <PortalCard>
        <h1 className="text-2xl leading-tight tracking-[-0.02em] text-ink">{c.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{c.body}</p>
        {reason === "accepted" && (
          <Link href="/portal/verify"
            className="mt-6 inline-block rounded bg-purple px-4 py-2.5 text-xs font-medium text-surface transition-colors hover:bg-purple-70">
            Continue to sign in
          </Link>
        )}
      </PortalCard>
    );
  }

  return (
    <PortalCard>
      <div className="eyebrow">Invitation</div>
      <div className="mt-1.5 text-sm text-ink-muted">{invite.investorOrgName}</div>
      <h1 className="mt-5 text-2xl leading-tight tracking-[-0.02em] text-ink">
        Welcome, {invite.contactName}
      </h1>
      <p className="mt-3 max-w-measure text-sm leading-relaxed text-ink-muted">
        Reiwa Capital has invited you to its private investment portal. To continue,
        we will email a one-time access code to your authorised address:
      </p>
      <div className="mt-4 border-y border-line py-3 text-sm font-medium tabular text-ink">
        {maskEmail(invite.contactEmail)}
      </div>
      {/* The action takes no argument: it reads the invitation from the cookie,
          so the token is not in this page's markup either. */}
      <form action={requestOtpForInviteAction} className="mt-8">
        <button type="submit"
          className="w-full rounded bg-purple px-4 py-3 text-sm font-medium text-surface transition-colors hover:bg-purple-70">
          Email me a secure access code
        </button>
      </form>
      <p className="mt-4 max-w-measure text-2xs leading-relaxed text-ink-faint">
        This invitation is valid until {formatDate(invite.expiresAt)} and does not itself grant
        access — only the code sent to the authorised address can sign you in.
      </p>
    </PortalCard>
  );
}

function PortalCard({ children }: { children: React.ReactNode }) {
  return <AccessFrame>{children}</AccessFrame>;
}
