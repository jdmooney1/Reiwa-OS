// ============================================================================
// The investor invitation email.
// ----------------------------------------------------------------------------
// This is the first thing an investor ever sees from Reiwa Capital, and it
// arrives cold in an inbox alongside everything else competing for attention.
// It is deliberately quiet: the mark, one sentence, one button, one line of
// small print. Nothing to read twice, nothing to be suspicious of.
//
// Built as a table with inline styles, because that is what email clients
// actually render — Outlook has no flexbox and Gmail strips <style> blocks.
// The palette is the product's own (tailwind.config.ts): the cream ground
// #F3EFE7 and the single purple accent #271430 sampled from the logo, so the
// email and the portal are recognisably the same institution.
//
// DM Sans is named first and will be used by clients that have it; the rest of
// the stack is the ordinary system fallback. No webfont is loaded — most
// clients block it, and a blocked font is worse than a good fallback.
//
// The token appears in exactly one place: the CTA href. It is not in the
// subject, not in the preheader, not in the plain-text alternative as anything
// but the same link, and not in any log line.
// ============================================================================

/** Brand values, mirroring tailwind.config.ts. */
const GROUND = "#F3EFE7";
const CARD = "#FAF8F4";
const PURPLE = "#271430";
const INK = "#271430";
const INK_MUTED = "#5F585F";
const INK_FAINT = "#6E666C";
const LINE = "#DDD5C8";
const FONT = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export const INVITATION_SUBJECT = "Invitation | Reiwa Capital Investment Portal";

export interface InvitationEmailInput {
  /** The named recipient, for the "intended only for" line. */
  recipientName: string;
  /** Absolute /access/<token> URL. */
  invitationUrl: string;
  /** Absolute origin, for the logo. */
  origin: string;
  /** When the invitation stops working, already formatted for a human. */
  expiresOn: string;
}

/** Escape anything interpolated into the HTML. Names come from the database. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function invitationEmailHtml(input: InvitationEmailInput): string {
  const name = esc(input.recipientName);
  const url = esc(input.invitationUrl);
  const logo = esc(`${input.origin}/brand/reiwa-capital-logo.png`);
  const expires = esc(input.expiresOn);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(INVITATION_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:${GROUND};">
<!-- Preheader: the inbox preview line. Deliberately the same sentence as the body. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">You have been invited to access the Reiwa Capital Investment Portal.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${GROUND};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:${CARD};border:1px solid ${LINE};border-radius:6px;">
        <tr>
          <td style="padding:40px 40px 0 40px;">
            <img src="${logo}" width="132" alt="Reiwa Capital" style="display:block;width:132px;max-width:60%;height:auto;border:0;">
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 0 40px;font-family:${FONT};">
            <p style="margin:0;font-size:11px;letter-spacing:0.09em;text-transform:uppercase;color:${INK_FAINT};">Invitation</p>
            <p style="margin:18px 0 0 0;font-size:17px;line-height:1.6;color:${INK};">
              You have been invited to access the Reiwa Capital Investment Portal.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 40px 0 40px;">
            <!-- One call to action. The token lives here and nowhere else. -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:${PURPLE};border-radius:4px;">
                  <a href="${url}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:14px;font-weight:500;color:${CARD};text-decoration:none;">Access Investment Portal</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 40px 0 40px;font-family:${FONT};">
            <p style="margin:0;font-size:13px;line-height:1.65;color:${INK_MUTED};">
              You will be asked to confirm your identity with a one-time code sent to this address.
              This invitation is valid until ${expires} and can be used once.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px 40px 40px;font-family:${FONT};">
            <div style="border-top:1px solid ${LINE};padding-top:18px;">
              <p style="margin:0;font-size:11px;line-height:1.6;color:${INK_FAINT};">
                This invitation is intended only for ${name}. If you were not expecting it, please ignore this message.
              </p>
            </div>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td align="center" style="padding:20px 8px 0 8px;font-family:${FONT};">
            <p style="margin:0;font-size:11px;color:${INK_FAINT};">Private &amp; confidential. Access is by invitation of Reiwa Capital only.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** The plain-text alternative. Same words, same single link. */
export function invitationEmailText(input: InvitationEmailInput): string {
  return [
    "REIWA CAPITAL",
    "",
    "You have been invited to access the Reiwa Capital Investment Portal.",
    "",
    "Access Investment Portal:",
    input.invitationUrl,
    "",
    "You will be asked to confirm your identity with a one-time code sent to",
    `this address. This invitation is valid until ${input.expiresOn} and can be`,
    "used once.",
    "",
    `This invitation is intended only for ${input.recipientName}. If you were not`,
    "expecting it, please ignore this message.",
    "",
    "Private & confidential. Access is by invitation of Reiwa Capital only.",
  ].join("\n");
}
