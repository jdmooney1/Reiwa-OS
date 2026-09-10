// ============================================================================
// Outbound application email — Resend's HTTP API over native fetch.
// ----------------------------------------------------------------------------
// This is NOT the same channel as the one-time codes. Those are sent by
// Supabase Auth (GoTrue) through the project's own SMTP configuration, and the
// application never sees them. Configuring custom SMTP for Supabase gives this
// application no ability to send anything: it is Supabase's transport, bound to
// Supabase's own templates.
//
// So application mail — currently exactly one message, the investor invitation
// — goes through Resend's REST API directly. No SDK: it is one POST with a
// JSON body, and a dependency here would add a supply-chain surface and an
// upgrade obligation for no correctness gain.
//
// RESEND_API_KEY is server-only and is never given a NEXT_PUBLIC_ prefix. It is
// deliberately NOT the Supabase secret key: a mail credential and a database
// credential should not be the same thing, so that revoking one does not
// require rotating the other.
//
// SERVER-ONLY.
// ============================================================================
import { AppError } from "@/lib/errors";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * The one sender identity. Kept here rather than threaded through business
 * logic, so the brand appears in exactly one place and the domain that has to
 * be verified with Resend is obvious.
 */
export const REIWA_SENDER = "Reiwa Capital <invitations@reiwa-capital.com>";

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: string };

/** Whether outbound email is configured at all. */
export function emailIsConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/**
 * Send one message. Never throws: the caller has to be able to UNDO what it
 * did before calling (an invitation it just minted), and an exception in the
 * middle of that is how a live-but-undeliverable invitation gets left behind.
 *
 * The failure reason is for the server log and for a short admin-facing
 * sentence. It never contains the message body, so a token embedded in the
 * HTML cannot reach a log through this path.
 */
export async function sendEmail(message: OutboundEmail): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "RESEND_API_KEY is not set" };
  }

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: REIWA_SENDER,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      // A hung mail provider must not hold an admin's request open.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { ok: false, reason: `transport error: ${(e as Error).name}` };
  }

  if (!response.ok) {
    // Resend answers with a JSON error; keep the status and its short name,
    // never the request body we sent.
    let detail = "";
    try {
      const body = (await response.json()) as { name?: string; message?: string };
      detail = body?.name ?? body?.message ?? "";
    } catch {
      // Non-JSON error body; the status is enough.
    }
    return { ok: false, reason: `HTTP ${response.status}${detail ? ` ${detail}` : ""}` };
  }

  let id: string | null = null;
  try {
    id = ((await response.json()) as { id?: string })?.id ?? null;
  } catch {
    // Delivery was accepted; the id is a convenience, not a requirement.
  }
  return { ok: true, id };
}

/** The message shown to an admin when mail is not configured at all. */
export function notConfiguredError(): AppError {
  return new AppError(
    "Email is not configured for this deployment, so no invitation was sent. " +
    "Set RESEND_API_KEY and try again.",
  );
}
