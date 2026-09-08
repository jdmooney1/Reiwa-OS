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
  | { mode: "invite"; maskedEmail: string; orgName: string }
  | { mode: "direct" },
) {
  const [requestState, requestAction] = useFormState(requestOtpDirectAction, EMPTY);
  const [verifyState, verifyAction] = useFormState(verifyOtpAction, EMPTY);

  const invite = props.mode === "invite";
  const directEmail = requestState.sent ? requestState.email : null;
  const codeStage = invite || !!directEmail;

  return (
    <div>
      {invite ? (
        <>
          <div className="eyebrow">Invitation</div>
          <div className="mt-1.5 text-sm text-ink-muted">{props.orgName}</div>
          <h1 className="mt-5 text-2xl leading-tight tracking-[-0.02em] text-ink">
            Enter your access code
          </h1>
          <p className="mt-3 max-w-measure text-sm leading-relaxed text-ink-muted">
            We have emailed a one-time code to <span className="font-medium text-ink">{props.maskedEmail}</span>.
            Enter it below to confirm your identity.
          </p>
        </>
      ) : (
        <>
          <div className="eyebrow">Investment Portal</div>
          <h1 className="mt-5 text-2xl leading-tight tracking-[-0.02em] text-ink">
            {codeStage ? "Enter your access code" : "Sign in to the portal"}
          </h1>
          <p className="mt-3 max-w-measure text-sm leading-relaxed text-ink-muted">
            {codeStage
              ? "If your address is authorised, a one-time code is on its way. Enter it below."
              : "Portal access is limited to authorised investor contacts. Enter your email and we will send a one-time access code."}
          </p>
        </>
      )}

      {!codeStage && (
        <form action={requestAction} className="mt-8 space-y-5">
          <label className="block">
            <span className="eyebrow">Email address</span>
            <input name="email" type="email" required autoFocus
              className="mt-1.5 h-11 w-full rounded border-0 border-b border-line bg-transparent px-0 text-sm text-ink focus:border-purple focus:outline-none focus:ring-0" />
          </label>
          {requestState.error && <FormError text={requestState.error} />}
          <SubmitButton label="Email me a secure access code" />
        </form>
      )}

      {codeStage && (
        <form action={verifyAction} className="mt-8 space-y-5">
          {/* No hidden invitation field: the token lives in an httpOnly cookie
              the server reads, so it is not in this markup to be read or replayed. */}
          {!invite && (
            <input type="hidden" name="email" value={verifyState.email ?? directEmail ?? ""} />
          )}
          <label className="block" htmlFor="otp-code">
            <span className="eyebrow">Access code</span>
            {/* No length is assumed anywhere: a Supabase project's OTP length is
                a project setting (6 by default, 8 once an operator raises it),
                so there is no "6-digit" in the copy, no maxLength, and no
                client-side length check. The code is passed through as typed
                and Supabase decides whether it is valid. */}
            <input id="otp-code" name="code" inputMode="numeric" autoComplete="one-time-code"
              required autoFocus spellCheck={false} autoCapitalize="off"
              aria-describedby="otp-code-hint"
              placeholder="Enter the code from your email"
              className="tabular mt-1.5 h-14 w-full rounded border-0 border-b border-line bg-transparent px-0 text-2xl tracking-[0.32em] text-ink placeholder:text-sm placeholder:tracking-normal placeholder:text-ink-faint focus:border-purple focus:outline-none focus:ring-0" />
            <span id="otp-code-hint" className="mt-2.5 block text-2xs text-ink-faint">
              Enter the code exactly as it appears in the email.
            </span>
          </label>
          {verifyState.error && <FormError text={verifyState.error} />}
          <SubmitButton label="Verify and enter the portal" />
          {invite ? (
            <p className="text-2xs text-ink-faint">
              Code not arriving?{" "}
              <a href="/access" className="text-ink-muted hover:underline">Request a new one</a>.
            </p>
          ) : (
            <p className="text-2xs text-ink-faint">
              Wrong address or no code?{" "}
              <a href="/portal/verify" className="text-ink-muted hover:underline">Start again</a>.
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
      className="w-full rounded bg-purple px-4 py-3 text-sm font-medium text-surface transition-colors hover:bg-purple-70 disabled:opacity-60">
      {pending ? "One moment…" : label}
    </button>
  );
}

function FormError({ text }: { text: string }) {
  return (
    <p className="border-l-2 border-negative py-1 pl-3 text-xs text-negative">
      {text}
    </p>
  );
}
