"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Plus, X, AlertTriangle, Loader2 } from "lucide-react";
import type { PublicationSummary, EligibleOpportunity, WorkflowState } from "@/lib/data/admin-portal";
import { preparePublicationAction } from "@/app/actions/admin-portal";
import { WORKFLOW_LABEL, WORKFLOW_TONE } from "@/lib/portal-labels";
import { ASSET_TYPE_LABEL } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AssetType } from "@/types/database";

type Filter = "all" | WorkflowState | "source_changed";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "in_review", label: "In Review" },
  { key: "published", label: "Published" },
  { key: "withdrawn", label: "Withdrawn" },
  { key: "source_changed", label: "Source Changed" },
];

export function PublicationsDirectory({
  publications, eligible, initialFilter,
}: {
  publications: PublicationSummary[];
  eligible: EligibleOpportunity[];
  initialFilter: string;
}) {
  const [filter, setFilter] = useState<Filter>(
    (FILTERS.some((f) => f.key === initialFilter) ? initialFilter : "all") as Filter);
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    if (filter === "all") return publications;
    if (filter === "source_changed") return publications.filter((p) => p.sourceChanged);
    return publications.filter((p) => p.state === filter);
  }, [publications, filter]);

  return (
    <div className="px-8 py-6">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center rounded-lg border border-line bg-surface-card p-0.5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn(
                "rounded px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f.key ? "bg-navy text-surface" : "text-ink-muted hover:text-ink",
              )}>
              {f.label}
              {f.key === "source_changed" && publications.some((p) => p.sourceChanged) && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-caution align-middle" />
              )}
            </button>
          ))}
        </div>
        <button onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 rounded bg-navy px-3.5 py-2 text-xs font-semibold text-surface hover:bg-navy-50">
          {creating ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {creating ? "Cancel" : "New Publication"}
        </button>
      </div>

      {/* Create from an eligible internal opportunity */}
      {creating && (
        <div className="mb-5 rounded-lg border border-gold/30 bg-surface-card">
          <div className="border-b border-line px-5 py-3.5">
            <div className="eyebrow mb-1">Create publication</div>
            <p className="text-xs text-ink-muted">
              A publication starts as a draft prefilled from the internal opportunity through the approved
              field whitelist — confidential fields never carry over. Opportunities that already have a
              publication are not listed: each opportunity has at most one.
            </p>
          </div>
          {eligible.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-ink-faint">
              Every active internal opportunity already has a publication.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {eligible.map((o) => (
                <li key={o.opportunityId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{o.name}</div>
                    <div className="mt-0.5 text-2xs text-ink-faint">
                      {[o.city ?? o.market, ASSET_TYPE_LABEL[o.assetType as AssetType] ?? o.assetType, o.strategy]
                        .filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <button disabled={pending}
                    onClick={() => start(() => preparePublicationAction(o.opportunityId))}
                    className="flex shrink-0 items-center gap-1.5 rounded bg-gold px-3 py-1.5 text-2xs font-semibold text-navy hover:bg-gold-soft disabled:opacity-60">
                    {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Prepare for Investors
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Directory */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line py-16 text-center">
          <div className="text-sm text-ink-muted">
            {publications.length === 0
              ? "No publications yet."
              : `Nothing is ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()}.`}
          </div>
          {publications.length === 0 && (
            <div className="mt-1 text-2xs text-ink-faint">
              Create one from an internal opportunity to start the investor workflow.
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <Th>Publication</Th>
                <Th>Market</Th>
                <Th>Asset type</Th>
                <Th>Status</Th>
                <Th className="text-right">Version</Th>
                <Th>Source</Th>
                <Th className="text-right">Investors</Th>
                <Th className="text-right">Published</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((p) => (
                <tr key={p.publicationId} className="group hover:bg-surface-sunken/60">
                  <td className="px-5 py-3">
                    <Link href={`/admin/publications/${p.publicationId}`}
                      className="font-medium text-ink group-hover:text-gold-deep">
                      {p.title}
                    </Link>
                    {p.opportunityName && p.opportunityName !== p.title && (
                      <div className="mt-0.5 text-2xs text-ink-faint">from {p.opportunityName}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-ink-muted">{p.market ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-muted">
                    {p.assetType ? (ASSET_TYPE_LABEL[p.assetType as AssetType] ?? p.assetType) : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={WORKFLOW_TONE[p.state]} dot>{WORKFLOW_LABEL[p.state]}</Badge>
                      {p.state === "published" && p.hasOpenDraft && (
                        <Badge tone="neutral">Draft open</Badge>
                      )}
                    </div>
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">v{p.currentVersionNumber}</td>
                  <td className="px-5 py-3">
                    {p.sourceChanged ? (
                      <span className="flex items-center gap-1 text-2xs font-medium text-caution">
                        <AlertTriangle className="h-3 w-3" /> Source changed
                      </span>
                    ) : (
                      <span className="text-2xs text-ink-faint">In step</span>
                    )}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">
                    {p.visibleOrgs}
                    {p.assignedOrgs > p.visibleOrgs && (
                      <span className="text-ink-faint"> / {p.assignedOrgs}</span>
                    )}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-2xs text-ink-faint">
                    {p.lastPublishedAt ? formatDate(p.lastPublishedAt) : "—"}
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
