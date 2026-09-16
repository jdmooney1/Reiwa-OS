"use client";

// ============================================================================
// Quick Opportunity — the 20-second capture.
// ----------------------------------------------------------------------------
// For a deal heard on the phone, on WhatsApp or over a table, before any
// document exists. Opens on "N" from anywhere, takes a name and nothing else
// mandatory, and returns you to what you were doing.
// ============================================================================
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { quickOpportunityAction } from "@/app/actions/ingestion";
import { cn } from "@/lib/utils";

export function QuickEntry({ orgs }: { orgs: { orgId: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // "N" from anywhere, as long as the user is not already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (!open && !typing && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setOpen(true);
      }
      if (open && e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => { if (open) nameRef.current?.focus(); }, [open]);

  const submit = (formData: FormData) => {
    setError(null);
    start(async () => {
      try {
        const { opportunityId } = await quickOpportunityAction(formData);
        setOpen(false);
        router.push(`/opportunities/${opportunityId}`);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Quick opportunity (N)"
        className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-card px-3.5 py-2 text-xs font-medium text-ink hover:border-gold/40">
        <Plus className="h-3.5 w-3.5" /> Quick Opportunity
        <kbd className="ml-1 rounded border border-line px-1 text-2xs text-ink-faint">N</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy/30 px-4 pt-24"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="w-full max-w-2xl rounded-lg border border-line bg-surface-card shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <div className="eyebrow">Capture</div>
            <h2 className="font-serif text-lg text-ink">Quick Opportunity</h2>
          </div>
          <button onClick={() => setOpen(false)} className="text-ink-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form action={submit} className="px-5 py-4">
          <input type="hidden" name="orgId" value={orgs[0]?.orgId ?? ""} />

          <div className="mb-3">
            <label className="eyebrow mb-1 block">Property or opportunity</label>
            <input ref={nameRef} name="name" required autoComplete="off"
              placeholder="16 Conduit Street"
              className={cn(INPUT, "text-base")} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Address"><input name="address" className={INPUT} autoComplete="off" /></Field>
            <Field label="Postcode"><input name="postcode" className={INPUT} autoComplete="off" /></Field>
            <Field label="City"><input name="city" className={INPUT} autoComplete="off" /></Field>
            <Field label="Broker / source"><input name="broker" className={INPUT} autoComplete="off" /></Field>
            <Field label="Price"><input name="price" placeholder="12.5m" className={INPUT} autoComplete="off" /></Field>
            <Field label="Income"><input name="income" placeholder="540k" className={INPUT} autoComplete="off" /></Field>
            <Field label="Yield %"><input name="yield" placeholder="4.12" className={INPUT} autoComplete="off" /></Field>
            <Field label="Currency">
              <select name="currency" className={INPUT} defaultValue="GBP">
                {["GBP", "EUR", "USD", "JPY"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div className="mt-3">
            <label className="eyebrow mb-1 block">Note</label>
            <textarea name="note" rows={2} placeholder="Heard from…, off-market, wants an answer by Friday"
              className={INPUT} />
          </div>

          {error && <p className="mt-3 text-2xs text-negative">{error}</p>}

          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <p className="text-2xs text-ink-faint">
              Saves at the inbox stage. Everything else can be filled in later.
            </p>
            <button type="submit" disabled={pending}
              className="inline-flex items-center gap-1.5 rounded bg-navy px-4 py-2 text-xs font-medium text-surface hover:bg-navy-50 disabled:opacity-60">
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const INPUT =
  "w-full rounded border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-gold/50 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="eyebrow mb-1 block">{label}</label>
      {children}
    </div>
  );
}
