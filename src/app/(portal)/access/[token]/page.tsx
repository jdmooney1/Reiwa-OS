import Link from "next/link";
import { validateInviteToken } from "@/lib/data/investor-invites";
import { maskEmail } from "@/lib/auth/investor-access";
import { requestOtpForInviteAction } from "@/app/actions/portal-access";
import { formatDate } from "@/lib/format";
import { AccessFrame } from "@/components/portal/access-frame";

export const dynamic = "force-dynamic";

// The invitation link necessarily carries the token. Suppress the Referer so
// it cannot travel to any resource this page loads or links to.
export const metadata = { referrer: "no-referrer" as const };

// The invitation landing page. The token only identifies the intended access
// context — every state below is decided server-side, and nothing is granted
// until the OTP to the authorised email is verified.
export default async function AccessPage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  const invite = await validateInviteToken(token);

  if (!invite.ok) {
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
    const c = copy[invite.reason] ?? copy.not_found;
    return (
      <PortalCard>
        <h1 className="font-serif text-xl text-ink">{c.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{c.body}</p>
        {invite.reason === "accepted" && (
          <Link href="/portal/verify"
            className="mt-5 inline-block rounded bg-navy px-4 py-2 text-xs font-semibold text-surface hover:bg-navy-50">
            Continue to sign in
          </Link>
        )}
      </PortalCard>
    );
  }

  return (
    <PortalCard>
      <div className="eyebrow mb-2">Invitation · {invite.investorOrgName}</div>
      <h1 className="font-serif text-xl text-ink">Welcome, {invite.contactName}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Reiwa Capital has invited you to its private investment portal. To continue,
        we will email a one-time access code to your authorised address:
      </p>
      <div className="mt-3 rounded border border-line bg-surface-sunken px-4 py-2.5 text-sm font-medium text-ink">
        {maskEmail(invite.contactEmail)}
      </div>
      <form action={requestOtpForInviteAction.bind(null, token)} className="mt-5">
        <button type="submit"
          className="w-full rounded bg-gold px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold-soft">
          Email me a secure access code
        </button>
      </form>
      <p className="mt-4 text-2xs text-ink-faint">
        This invitation is valid until {formatDate(invite.expiresAt)} and does not itself grant
        access — only the code sent to the authorised address can sign you in.
      </p>
    </PortalCard>
  );
}

function PortalCard({ children }: { children: React.ReactNode }) {
  return (
    <AccessFrame>
      <div className="rounded-lg border border-line bg-surface-card px-7 py-7">{children}</div>
    </AccessFrame>
  );
}
