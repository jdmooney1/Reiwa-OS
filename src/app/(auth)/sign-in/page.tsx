"use client";

import { useFormState, useFormStatus } from "react-dom";
import { signInAction, type SignInState } from "@/app/actions/auth";

const DEMO = [
  { label: "Reiwa Admin (all orgs)", email: "admin@reiwa.com" },
  { label: "Meiji · Analyst (read/write)", email: "analyst@meiji.com" },
  { label: "Meiji · Investor (read-only)", email: "viewer@meiji.com" },
];

export default function SignInPage() {
  const [state, action] = useFormState<SignInState, FormData>(signInAction, {});
  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 text-center">
        <div className="display text-xl tracking-wide text-surface">
          REIWA<span className="text-surface/50"> OS</span>
        </div>
        <div className="eyebrow-light mt-1">Deal &amp; Asset Intelligence</div>
      </div>

      <form action={action} className="space-y-3 rounded-lg border border-line-dark bg-plum-100 p-6">
        <Field label="Email" name="email" type="email" placeholder="analyst@meiji.com" defaultValue="analyst@meiji.com" />
        <Field label="Password" name="password" type="password" placeholder="••••••••" defaultValue="reiwa2026" />
        {state.error && <p className="text-2xs text-negative">{state.error}</p>}
        <SubmitButton />
      </form>

      <div className="mt-4 rounded-lg border border-line-dark/60 p-3">
        <div className="eyebrow-light mb-1.5">Demo accounts · password reiwa2026</div>
        <ul className="space-y-0.5">
          {DEMO.map((d) => (
            <li key={d.email} className="flex justify-between text-2xs text-surface/60">
              <span>{d.label}</span><span className="tabular text-surface/40">{d.email}</span>
            </li>
          ))}
        </ul>
      </div>
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
        className="mt-1 h-9 w-full rounded border border-line-dark bg-plum px-3 text-sm text-surface placeholder:text-surface/30 focus:border-surface/40 focus:outline-none focus:ring-1 focus:ring-surface/20"
      />
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" disabled={pending}
      className="mt-1 w-full rounded bg-surface px-3 py-2 text-xs font-semibold text-plum transition-colors hover:bg-surface-sunken disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
