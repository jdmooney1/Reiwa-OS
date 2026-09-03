"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  requestOtpDirectAction, verifyOtpAction, type AccessFormState,
} from "@/app/actions/portal-access";

const EMPTY: AccessFormState = {};

/**
 * The two OTP entry modes:
 *  - invite: the email was resolved server-side from the invitation token and
 *    is only ever displayed masked; the code goes straight in.
 *  - direct: an authorised contact asks for a code by email first. The
 *    response is identical whether or not the address is authorised.
 */
export function VerifyForm(props:
  | { mode: "invite"; inviteToken: string; maskedEmail: string; orgName: string }
  | { mode: "direct" },
) {
  const [requestState, requestAction] = useFormState(requestOtpDirectAction, EMPTY);
  const [verifyState, verifyAction] = useFormState(verifyOtpAction, EMPTY);

  const invite = props.mode === "invite";
  const directEmail = requestState.sent ? requestState.email : null;
  const codeStage = invite || !!directEmail;

  return (
    <div className="rounded-lg border border-line bg-surface-card px-7 py-7">
      {invite ? (
        <>
          <div className="eyebrow mb-2">Invitation · {props.orgName}</div>
          <h1 className="font-serif text-xl text-ink">Enter your access code</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            We have emailed a one-time code to <span className="font-medium text-ink">{props.maskedEmail}</span>.
            Enter it below to confirm your identity.
          </p>
        </>
      ) : (
        <>
          <div className="eyebrow mb-2">Investor sign-in</div>
          <h1 className="font-serif text-xl text-ink">
            {codeStage ? "Enter your access code" : "Sign in to the portal"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {codeStage
              ? "If your address is authorised, a one-time code is on its way. Enter it below."
              : "Portal access is limited to authorised investor contacts. Enter your email and we will send a one-time access code."}
          </p>
        </>
      )}

      {!codeStage && (
        <form action={requestAction} className="mt-5 space-y-4">
          <label className="block">
            <span className="eyebrow">Email address</span>
            <input name="email" type="email" required autoFocus
              className="mt-1 h-10 w-full rounded border border-line bg-surface px-3 text-sm text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30" />
          </label>
          {requestState.error && <FormError text={requestState.error} />}
          <SubmitButton label="Email me a secure access code" />
        </form>
      )}

      {codeStage && (
        <form action={verifyAction} className="mt-5 space-y-4">
          {invite
            ? <input type="hidden" name="invite" value={props.inviteToken} />
            : <input type="hidden" name="email" value={verifyState.email ?? directEmail ?? ""} />}
          <label className="block">
            <span className="eyebrow">Access code</span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus
              placeholder="6-digit code"
              className="mt-1 h-11 w-full rounded border border-line bg-surface px-3 text-center font-serif text-xl tracking-[0.4em] text-ink placeholder:tracking-normal placeholder:font-sans placeholder:text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30" />
          </label>
          {verifyState.error && <FormError text={verifyState.error} />}
          <SubmitButton label="Verify and enter the portal" />
          {invite ? (
            <p className="text-center text-2xs text-ink-faint">
              Code not arriving? Return to your invitation link to request a new one.
            </p>
          ) : (
            <p className="text-center text-2xs text-ink-faint">
              Wrong address or no code?{" "}
              <a href="/portal/verify" className="text-gold-deep hover:underline">Start again</a>.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="w-full rounded bg-gold px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold-soft disabled:opacity-60">
      {pending ? "One moment…" : label}
    </button>
  );
}

function FormError({ text }: { text: string }) {
  return (
    <p className="rounded border border-negative/30 bg-negative/5 px-3 py-2 text-xs text-negative">
      {text}
    </p>
  );
}
