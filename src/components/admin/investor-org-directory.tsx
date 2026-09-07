"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import type { InvestorOrgSummary } from "@/lib/data/admin-portal";
import { createInvestorOrgAction } from "@/app/actions/admin-portal";
import { INVESTOR_ORG_STATUS_LABEL, INVESTOR_ORG_STATUS_TONE } from "@/lib/portal-labels";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function InvestorOrgDirectory({ orgs }: { orgs: InvestorOrgSummary[] }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((o) =>
      o.name.toLowerCase().includes(q) ||
      (o.featuredTitle ?? "").toLowerCase().includes(q) ||
      o.status.includes(q));
  }, [orgs, query]);

  return (
    <div className="px-8 py-6">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search investor organisations"
            type="search"
            placeholder="Search organisations…"
            className="h-9 w-72 rounded border border-line bg-surface-card pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30"
          />
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 rounded bg-navy px-3.5 py-2 text-xs font-semibold text-surface hover:bg-navy-50"
        >
          {creating ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {creating ? "Cancel" : "New Investor Organisation"}
        </button>
      </div>

      {/* Create panel */}
      {creating && (
        <div className="mb-5 rounded-lg border border-gold/30 bg-surface-card p-5">
          <div className="eyebrow mb-3">New investor organisation</div>
          <form action={createInvestorOrgAction} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block md:col-span-1">
              <span className="eyebrow">Name</span>
              <input name="name" required
                className="mt-1 h-9 w-full rounded border border-line bg-surface px-3 text-sm text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30" />
            </label>
            <label className="block">
              <span className="eyebrow">Status</span>
              <select name="status" defaultValue="active"
                className="mt-1 h-9 w-full rounded border border-line bg-surface px-2.5 text-sm text-ink focus:border-gold focus:outline-none">
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label className="block">
              <span className="eyebrow">Notes (internal)</span>
              <input name="notes"
                className="mt-1 h-9 w-full rounded border border-line bg-surface px-3 text-sm text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30" />
            </label>
            <div className="md:col-span-3 flex justify-end">
              <button type="submit"
                className="rounded bg-gold px-4 py-2 text-xs font-semibold text-navy hover:bg-gold-soft">
                Create Organisation
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Directory */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line py-16 text-center">
          <div className="text-sm text-ink-muted">
            {orgs.length === 0 ? "No investor organisations yet." : "No organisation matches this search."}
          </div>
          {orgs.length === 0 && (
            <div className="mt-1 text-2xs text-ink-faint">
              Create the first organisation to begin assigning opportunities.
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <Th>Organisation</Th>
                <Th>Status</Th>
                <Th className="text-right">Contacts</Th>
                <Th className="text-right">Visible opportunities</Th>
                <Th>Featured opportunity</Th>
                <Th className="text-right">Updated</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((o) => (
                <tr key={o.investorOrgId} className="group hover:bg-surface-sunken/60">
                  <td className="px-5 py-3">
                    <Link href={`/admin/investors/${o.investorOrgId}`}
                      className="font-medium text-ink group-hover:text-gold-deep">
                      {o.name}
                    </Link>
                    {o.linkedInternalOrganizationName && (
                      <div className="mt-0.5 text-2xs text-ink-faint">
                        Linked to {o.linkedInternalOrganizationName}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={INVESTOR_ORG_STATUS_TONE[o.status]} dot>
                      {INVESTOR_ORG_STATUS_LABEL[o.status]}
                    </Badge>
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">
                    {o.contactsActive}
                    {o.contactsTotal > o.contactsActive && (
                      <span className="text-ink-faint"> / {o.contactsTotal}</span>
                    )}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">{o.visibleOpportunities}</td>
                  <td className="px-5 py-3 text-ink-muted">{o.featuredTitle ?? "—"}</td>
                  <td className="tabular px-5 py-3 text-right text-2xs text-ink-faint">
                    {formatDate(o.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn("px-5 py-2.5 text-2xs font-medium uppercase tracking-label text-ink-faint", className)}>
      {children}
    </th>
  );
}
