import { redirect } from "next/navigation";
import { resolveIdentity } from "@/lib/auth/portal-session";
import { validateInviteToken } from "@/lib/data/investor-invites";
import { maskEmail } from "@/lib/auth/investor-access";
import { VerifyForm } from "@/components/portal/verify-form";
import { AccessFrame } from "@/components/portal/access-frame";

export const dynamic = "force-dynamic";

// The OTP entry point: reached from an invitation (token in the query, email
// resolved server-side) or directly by an already-authorised contact (email
// requested in the form). Signed-in users are routed by identity kind.
export default async function PortalVerifyPage({
  searchParams,
}: {
  searchParams: { invite?: string };
}) {
  const identity = await resolveIdentity();
  if (identity?.kind === "investor") redirect("/portal");
  if (identity?.kind === "internal") redirect("/portfolio");

  const inviteToken = searchParams.invite ?? null;
  if (inviteToken) {
    const invite = await validateInviteToken(inviteToken);
    // A token that stopped being valid mid-flow gets the explanatory page.
    if (!invite.ok) redirect(`/access/${encodeURIComponent(inviteToken)}`);
    return (
      <AccessFrame>
        <VerifyForm
          mode="invite"
          inviteToken={inviteToken}
          maskedEmail={maskEmail(invite.contactEmail)}
          orgName={invite.investorOrgName}
        />
      </AccessFrame>
    );
  }

  return <AccessFrame><VerifyForm mode="direct" /></AccessFrame>;
}
