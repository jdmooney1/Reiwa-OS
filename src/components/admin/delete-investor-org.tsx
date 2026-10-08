"use client";

import { useState, useTransition } from "react";
import { Check, Trash2, X } from "lucide-react";
import { deleteInvestorOrgAction, updateInvestorOrgAction } from "@/app/actions/admin-portal";
import type { DeletionGuard } from "@/lib/investor/deletion-guard";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface OrgForDelete {
  investorOrgId: string;
  name: string;
  status: "active" | "suspended" | "closed";
  notes: string | null;
}

/**
 * The danger zone. Shows exactly what the deletion guard checked, and only lets an organisation
 * that has never been used be deleted - by typing its name. One that has been used is pointed at
 * Suspended / Closed, which keep the record. The server runs the guard again on submit.
 */
export function DeleteInvestorOrg({ org, guard }: { org: OrgForDelete; guard: DeletionGuard }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const confirmed = typed.trim() === org.name;

  const setStatus = (status: "suspended" | "closed") => start(async () => {
    const fd = new FormData();
    fd.set("name", org.name); fd.set("status", status); fd.set("notes", org.notes ?? "");
    await updateInvestorOrgAction(org.investorOrgId, fd);
    setOpen(false);
  });

  const remove = () => start(async () => {
    setError(null);
    const result = await deleteInvestorOrgAction(org.investorOrgId, typed);
    if (result?.error) setError(result.error); // a success redirects, so only a refusal returns
  });

  return (
    <Card>
      <CardHeader eyebrow="Danger zone" title="Delete organisation"
        action={
          <button type="button" onClick={() => { setOpen((v) => !v); setError(null); setTyped(""); }}
            aria-expanded={open}
            className="flex items-center gap-1 rounded border border-line px-2.5 py-1.5 text-2xs font-medium text-ink-muted hover:border-negative/40 hover:text-negative">
            {open ? <X className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />} {open ? "Cancel" : "Delete…"}
          </button>
        } />
      {open && (
        <CardBody className="space-y-4">
          <div>
            <div className="eyebrow mb-2">What was checked</div>
            <ul className="divide-y divide-line rounded border border-line text-xs">
              {guard.checks.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex items-center gap-2 text-ink-muted">
                    {c.blocks
                      ? <X className="h-3.5 w-3.5 shrink-0 text-negative" aria-label="blocks deletion" />
                      : <Check className="h-3.5 w-3.5 shrink-0 text-positive" aria-label="clear" />}
                    {c.label}
                  </span>
                  <span className={cn("tabular", c.blocks ? "font-semibold text-negative" : "text-ink-faint")}>{c.count}</span>
                </li>
              ))}
            </ul>
          </div>

          {guard.allowed ? (
            <>
              <p className="text-xs text-ink-muted">
                This organisation has never been used. Deleting it is permanent
                {guard.alsoDeleted.contacts > 0 || guard.alsoDeleted.unacceptedInvites > 0 ? (
                  <> and also removes its {guard.alsoDeleted.contacts} contact{guard.alsoDeleted.contacts === 1 ? "" : "s"}
                    {guard.alsoDeleted.unacceptedInvites > 0 ? ` and ${guard.alsoDeleted.unacceptedInvites} unaccepted invitation${guard.alsoDeleted.unacceptedInvites === 1 ? "" : "s"}` : ""}
                    {" "}(none has signed in)</>
                ) : null}.
              </p>
              <label className="block">
                <span className="eyebrow">Type <span className="font-mono normal-case text-ink">{org.name}</span> to confirm</span>
                <input value={typed} onChange={(e) => { setTyped(e.target.value); setError(null); }}
                  autoComplete="off" spellCheck={false}
                  className="mt-1 h-9 w-full rounded border border-line bg-surface px-3 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30" />
              </label>
              <div className="flex justify-end">
                <button type="button" onClick={remove} disabled={!confirmed || pending}
                  className="rounded bg-negative px-3.5 py-2 text-xs font-semibold text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                  {pending ? "Deleting…" : "Delete organisation"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-ink-muted">
                This organisation has been used ({guard.reasons.join(", ")}), so it cannot be deleted.
                Set it to Suspended or Closed instead: that stops portal access and keeps the record.
              </p>
              <div className="flex gap-2">
                {org.status !== "suspended" && (
                  <button type="button" disabled={pending} onClick={() => setStatus("suspended")}
                    className="rounded border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50">
                    Set to Suspended
                  </button>
                )}
                {org.status !== "closed" && (
                  <button type="button" disabled={pending} onClick={() => setStatus("closed")}
                    className="rounded border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50">
                    Set to Closed
                  </button>
                )}
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="rounded border border-negative/30 bg-negative/5 px-3 py-2 text-xs text-negative">{error}</p>
          )}
        </CardBody>
      )}
    </Card>
  );
}
