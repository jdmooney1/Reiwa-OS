import { redirect } from "next/navigation";
import { resolveIdentity } from "@/lib/auth/portal-session";
import { validateInviteToken } from "@/lib/data/investor-invites";
import { readInviteToken } from "@/lib/auth/invite-session";
import { maskEmail } from "@/lib/auth/investor-access";
import { VerifyForm } from "@/components/portal/verify-form";
import { AccessFrame } from "@/components/portal/access-frame";

export const dynamic = "force-dynamic";

// The OTP entry point: reached from an invitation (context read from the
// httpOnly cookie the /access hand-off set) or directly by an already-
// authorised contact (email requested in the form). Signed-in users are routed
// by identity kind.
export default async function PortalVerifyPage({
  searchParams,
}: {
  searchParams: { invite?: string };
}) {
  // A token in the query is a link from before the P6 hand-off, or someone
  // pasting one. It is not honoured, and the URL is scrubbed rather than left
  // in history with a credential in it.
  if (searchParams.invite) redirect("/portal/verify");

  const identity = await resolveIdentity();
  if (identity?.kind === "investor") redirect("/portal");
  if (identity?.kind === "internal") redirect("/portfolio");

  const inviteToken = readInviteToken();
  if (inviteToken) {
    const invite = await validateInviteToken(inviteToken);
    // A token that stopped being valid mid-flow gets the explanatory page.
    if (!invite.ok) redirect("/access");
    return (
      <AccessFrame>
        <VerifyForm
          mode="invite"
          maskedEmail={maskEmail(invite.contactEmail)}
          orgName={invite.investorOrgName}
        />
      </AccessFrame>
    );
  }

  return <AccessFrame><VerifyForm mode="direct" /></AccessFrame>;
}
