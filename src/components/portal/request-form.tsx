"use client";

import { useFormState, useFormStatus } from "react-dom";
import { CheckCircle2 } from "lucide-react";
import { submitRequestAction, type RequestFormState } from "@/app/actions/portal";

const EMPTY: RequestFormState = {};

const OPTIONS = [
  { value: "information", label: "Request more information",
    hint: "A member of the Reiwa team will follow up on this opportunity." },
  { value: "diligence_access", label: "Request diligence access",
    hint: "Ask to be released the diligence document set for this opportunity." },
  { value: "meeting", label: "Discuss this opportunity",
    hint: "Arrange a call or meeting with the Reiwa investment team." },
] as const;

/**
 * The investor's request against one opportunity. The publication id is bound
 * server-side and re-checked against the investor's own entitlement before
 * anything is written, so this form cannot be used to reach an opportunity the
 * investor is not entitled to — including by editing the page.
 */
export function RequestForm({
  publicationId, submittedCount,
}: {
  publicationId: string;
  submittedCount: number;
}) {
  const action = submitRequestAction.bind(null, publicationId);
  const [state, formAction] = useFormState(action, EMPTY);

  if (state.ok) {
    return (
      <div className="border-l-2 border-positive py-1 pl-5">
        <div className="flex items-center gap-2 text-positive">
          <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
          <span className="text-xs font-semibold uppercase tracking-label">Request received</span>
        </div>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink">
          Thank you — your request has been logged with the Reiwa Capital investment team. They
          will be in touch directly.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction}>
      {submittedCount > 0 && (
        <p className="mb-4 text-2xs text-ink-faint">
          You have previously submitted {submittedCount}{" "}
          {submittedCount === 1 ? "request" : "requests"} on this opportunity.
        </p>
      )}

      <fieldset>
        <legend className="text-2xs uppercase tracking-label text-ink-faint">
          How can we help?
        </legend>
        <div className="mt-3 space-y-2.5">
          {OPTIONS.map((o, i) => (
            <label key={o.value} className="flex cursor-pointer gap-3">
              <input
                type="radio"
                name="requestType"
                value={o.value}
                defaultChecked={i === 0}
                className="mt-1 accent-purple"
              />
              <span>
                <span className="block text-sm font-medium text-ink">{o.label}</span>
                <span className="block text-2xs leading-relaxed text-ink-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 block">
        <span className="text-2xs uppercase tracking-label text-ink-faint">
          Message <span className="normal-case tracking-normal">(optional)</span>
        </span>
        <textarea
          name="message"
          rows={3}
          maxLength={2000}
          placeholder="Anything specific you would like us to cover."
          className="mt-1.5 w-full rounded border border-line bg-surface-card px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-purple focus:outline-none focus:ring-0"
        />
      </label>

      {state.error && (
        <p role="alert" className="mt-3 text-xs text-negative">{state.error}</p>
      )}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 rounded bg-purple px-5 py-2.5 text-xs font-medium text-surface transition-colors hover:bg-purple-70 disabled:opacity-60"
    >
      {pending ? "Sending…" : "Send request"}
    </button>
  );
}
