"use client";

import { useFormState, useFormStatus } from "react-dom";
import { signInAction, type SignInState } from "@/app/actions/auth";
import { ReiwaLockup } from "@/components/brand/reiwa-lockup";

const DEMO = [
  { label: "Reiwa Admin (all orgs)", email: "admin@reiwa.com" },
  { label: "Meiji · Analyst (read/write)", email: "analyst@meiji.com" },
  { label: "Meiji · Investor (read-only)", email: "viewer@meiji.com" },
];

/**
 * The demonstration credentials are a development affordance and nothing else.
 * NODE_ENV is inlined at build time, so a production build contains neither the
 * prefilled values nor the account list — they are not hidden with CSS, they
 * are not in the bundle.
 */
const SHOW_DEMO_ACCOUNTS = process.env.NODE_ENV !== "production";

export default function SignInPage() {
  const [state, action] = useFormState<SignInState, FormData>(signInAction, {});
  return (
    <div className="w-full max-w-sm">
      <ReiwaLockup size="entry" />
      <div className="eyebrow mt-5">Deal &amp; Asset Intelligence</div>

      <form action={action} className="mt-10 space-y-5">
        <Field label="Email" name="email" type="email" placeholder="you@reiwa-capital.com"
          defaultValue={SHOW_DEMO_ACCOUNTS ? "analyst@meiji.com" : undefined} />
        <Field label="Password" name="password" type="password" placeholder="••••••••"
          defaultValue={SHOW_DEMO_ACCOUNTS ? "reiwa2026" : undefined} />
        {state.error && (
          <p className="border-l-2 border-negative py-1 pl-3 text-xs text-negative">{state.error}</p>
        )}
        <SubmitButton />
      </form>

      {SHOW_DEMO_ACCOUNTS && (
      <div className="mt-10 border-t border-line pt-4">
        <div className="eyebrow mb-2">Demo accounts · password reiwa2026</div>
        <ul className="space-y-1">
          {DEMO.map((d) => (
            <li key={d.email} className="flex justify-between gap-4 text-2xs text-ink-faint">
              <span>{d.label}</span><span className="tabular">{d.email}</span>
            </li>
          ))}
        </ul>
      </div>
      )}
    </div>
  );
}

function Field({ label, name, type, placeholder, defaultValue }: {
  label: string; name: string; type: string; placeholder: string; defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input
        name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} required
        className="mt-1.5 h-11 w-full rounded border-0 border-b border-line bg-transparent px-0 text-sm text-ink placeholder:text-ink-faint focus:border-purple focus:outline-none focus:ring-0"
      />
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" disabled={pending}
      className="w-full rounded bg-purple px-4 py-3 text-sm font-medium text-surface transition-colors hover:bg-purple-70 disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
