"use client";

import { useFormState, useFormStatus } from "react-dom";
import { signInAction, type SignInState } from "@/app/actions/auth";

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
      <div className="mb-6 text-center">
        <div className="font-serif text-xl tracking-wide text-surface">
          REIWA<span className="text-gold"> OS</span>
        </div>
        <div className="eyebrow-light mt-1">Deal &amp; Asset Intelligence</div>
      </div>

      <form action={action} className="space-y-3 rounded-lg border border-line-dark bg-navy-100 p-6">
        <Field label="Email" name="email" type="email" placeholder="you@reiwa-capital.com"
          defaultValue={SHOW_DEMO_ACCOUNTS ? "analyst@meiji.com" : undefined} />
        <Field label="Password" name="password" type="password" placeholder="••••••••"
          defaultValue={SHOW_DEMO_ACCOUNTS ? "reiwa2026" : undefined} />
        {state.error && <p className="text-2xs text-rose-300">{state.error}</p>}
        <SubmitButton />
      </form>

      {SHOW_DEMO_ACCOUNTS && (
      <div className="mt-4 rounded-lg border border-line-dark/60 p-3">
        <div className="eyebrow-light mb-1.5">Demo accounts · password reiwa2026</div>
        <ul className="space-y-0.5">
          {DEMO.map((d) => (
            <li key={d.email} className="flex justify-between text-2xs text-surface/60">
              <span>{d.label}</span><span className="tabular text-surface/60">{d.email}</span>
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
      <span className="eyebrow-light">{label}</span>
      <input
        name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} required
        className="mt-1 h-9 w-full rounded border border-line-dark bg-navy px-3 text-sm text-surface placeholder:text-surface/60 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30"
      />
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" disabled={pending}
      className="mt-1 w-full rounded bg-gold px-3 py-2 text-xs font-semibold text-navy transition-colors hover:bg-gold-soft disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
