"use client";

// ============================================================================
// Deal Inbox — an ingestion queue, not an upload folder.
// ----------------------------------------------------------------------------
// Dense table, keyboard-driven, bulk actions on selection. Deliberately no
// cards, no charts and no animation: the design test in the brief is twenty
// broker opportunities organised in a morning.
// ============================================================================
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check, X, Eye, Loader2, AlertTriangle, Link2, FileSpreadsheet, Mail, PenLine,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBar } from "@/components/inbox/confidence-bar";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { matchPercent } from "@/lib/ingestion/match";
import {
  promoteManyAction, setReviewStatusAction,
} from "@/app/actions/ingestion";
import type { IngestionItem, ReviewStatus } from "@/lib/data/ingestion";

const STATUS_TONE: Record<ReviewStatus, "neutral" | "gold" | "positive" | "caution" | "muted" | "negative"> = {
  new: "neutral",
  needs_review: "caution",
  approved: "positive",
  merged: "gold",
  rejected: "muted",
  passed: "muted",
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  new: "New",
  needs_review: "Needs review",
  approved: "Approved",
  merged: "Merged",
  rejected: "Rejected",
  passed: "Passed",
};

const CHANNEL_ICON = {
  upload: FileSpreadsheet,
  email_inbound: Mail,
  manual: PenLine,
  api: FileSpreadsheet,
} as const;

const FILTERS: { key: string; label: string; statuses: ReviewStatus[] | null }[] = [
  { key: "open", label: "Open", statuses: ["new", "needs_review"] },
  { key: "needs_review", label: "Needs review", statuses: ["needs_review"] },
  { key: "new", label: "New", statuses: ["new"] },
  { key: "done", label: "Processed", statuses: ["approved", "merged"] },
  { key: "dismissed", label: "Rejected", statuses: ["rejected", "passed"] },
  { key: "all", label: "All", statuses: null },
];

export function InboxTable({ items }: { items: IngestionItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const statuses = FILTERS.find((f) => f.key === filter)?.statuses;
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statuses && !statuses.includes(item.reviewStatus)) return false;
      if (!needle) return true;
      return (
        item.displayName?.toLowerCase().includes(needle) ||
        item.displayLocation?.toLowerCase().includes(needle) ||
        item.sourceFileName?.toLowerCase().includes(needle) ||
        JSON.stringify(item.rawPayload).toLowerCase().includes(needle)
      );
    });
  }, [items, filter, search]);

  const actionable = visible.filter((i) => !i.promotedAt);
  const allSelected = actionable.length > 0 && actionable.every((i) => selected.has(i.itemId));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(actionable.map((i) => i.itemId)));
  };
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const run = (fn: () => Promise<{ failed?: { itemId: string; error: string }[] } | { updated: number }>) => {
    setError(null);
    start(async () => {
      try {
        const result = (await fn()) as { failed?: { itemId: string; error: string }[] };
        // Bulk failures are surfaced, never swallowed: a partial import that
        // silently drops rows is worse than one that refuses.
        if (result.failed?.length) {
          setError(
            `${result.failed.length} item${result.failed.length === 1 ? "" : "s"} could not be promoted. ` +
            `First reason: ${result.failed[0].error}`);
        }
        setSelected(new Set());
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const ids = [...selected];

  return (
    <div className="flex h-full flex-col">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-8 py-3">
        {FILTERS.map((f) => {
          const count = f.statuses
            ? items.filter((i) => f.statuses!.includes(i.reviewStatus)).length
            : items.length;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded border px-2.5 py-1 text-2xs font-medium transition-colors",
                filter === f.key
                  ? "border-navy bg-navy text-surface"
                  : "border-line bg-surface-card text-ink-muted hover:border-gold/40",
              )}
            >
              {f.label}
              <span className="ml-1.5 tabular opacity-60">{count}</span>
            </button>
          );
        })}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search property, address, broker, any source column…"
          className="ml-auto w-80 rounded border border-line bg-surface-card px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-gold/50 focus:outline-none"
        />
      </div>

      {/* Bulk action bar — only present when there is a selection */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 border-b border-gold/30 bg-gold/5 px-8 py-2.5">
          <span className="text-2xs font-medium text-ink">
            {selected.size} selected
          </span>
          <div className="mx-2 h-4 w-px bg-line" />
          <BulkButton icon={Check} label="Approve" disabled={pending}
            onClick={() => run(() => promoteManyAction(ids))} />
          <BulkButton icon={Eye} label="Mark for review" disabled={pending}
            onClick={() => run(async () => setReviewStatusAction(ids, "needs_review"))} />
          <BulkButton icon={X} label="Pass" disabled={pending}
            onClick={() => run(async () => setReviewStatusAction(ids, "passed"))} />
          <BulkButton icon={X} label="Reject" disabled={pending}
            onClick={() => run(async () => setReviewStatusAction(ids, "rejected"))} />
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" />}
          <button onClick={() => setSelected(new Set())}
            className="ml-auto text-2xs text-ink-faint hover:text-ink">Clear</button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 border-b border-negative/30 bg-negative/5 px-8 py-2.5 text-2xs text-negative">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-surface-sunken">
            <tr className="border-b border-line text-left">
              <Th className="w-8 pl-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  aria-label="Select all" className="accent-navy" />
              </Th>
              <Th>Property</Th>
              <Th>Location</Th>
              <Th className="text-right">Price</Th>
              <Th className="text-right">Income</Th>
              <Th className="text-right">Yield</Th>
              <Th>Broker</Th>
              <Th>Source</Th>
              <Th>Confidence</Th>
              <Th>Possible match</Th>
              <Th>Issues</Th>
              <Th>Status</Th>
              <Th className="pr-8">Received</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const ChannelIcon = CHANNEL_ICON[item.batchChannel ?? "upload"];
              const errors = item.issues.filter((i) => i.severity === "error");
              const warnings = item.issues.filter((i) => i.severity === "warning");
              return (
                <tr key={item.itemId}
                  className={cn(
                    "border-b border-line/60 hover:bg-gold/[0.03]",
                    selected.has(item.itemId) && "bg-gold/[0.06]",
                  )}>
                  <Td className="pl-8">
                    <input type="checkbox" disabled={!!item.promotedAt}
                      checked={selected.has(item.itemId)}
                      onChange={() => toggle(item.itemId)}
                      aria-label={`Select ${item.displayName ?? "item"}`}
                      className="accent-navy disabled:opacity-30" />
                  </Td>
                  <Td>
                    <Link href={`/inbox/${item.itemId}`}
                      className="font-medium text-ink hover:text-gold-deep">
                      {item.displayName ?? <span className="text-ink-faint">Unnamed row</span>}
                    </Link>
                  </Td>
                  <Td className="max-w-56 truncate text-ink-muted" title={item.displayLocation ?? ""}>
                    {item.displayLocation ?? "—"}
                  </Td>
                  <Td className="tabular text-right">{extractedText(item, "asking_price")}</Td>
                  <Td className="tabular text-right">{extractedText(item, "passing_income")}</Td>
                  <Td className="tabular text-right">{extractedText(item, "niy", "%")}</Td>
                  <Td className="text-ink-muted">{extractedText(item, "broker")}</Td>
                  <Td className="text-ink-muted">
                    <span className="inline-flex items-center gap-1.5" title={item.sourceFileName ?? ""}>
                      <ChannelIcon className="h-3 w-3 shrink-0 text-ink-faint" />
                      <span className="max-w-32 truncate">{item.batchLabel ?? item.sourceFileName ?? "—"}</span>
                    </span>
                  </Td>
                  <Td><ConfidenceBar value={item.confidenceOverall} /></Td>
                  <Td>
                    {item.topMatchScore != null ? (
                      <Link href={`/inbox/${item.itemId}`}
                        className="inline-flex items-center gap-1 text-gold-deep hover:underline">
                        <Link2 className="h-3 w-3" />
                        <span className="tabular">{matchPercent(item.topMatchScore)}%</span>
                        <span className="max-w-28 truncate text-ink-muted">{item.topMatchLabel}</span>
                      </Link>
                    ) : <span className="text-ink-faint">—</span>}
                  </Td>
                  <Td>
                    {errors.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-negative"
                        title={errors.map((e) => e.message).join("\n")}>
                        <AlertTriangle className="h-3 w-3" /> {errors.length}
                      </span>
                    ) : warnings.length > 0 ? (
                      <span className="text-caution" title={warnings.map((w) => w.message).join("\n")}>
                        {warnings.length}
                      </span>
                    ) : <span className="text-ink-faint">—</span>}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[item.reviewStatus]}>
                      {STATUS_LABEL[item.reviewStatus]}
                    </Badge>
                  </Td>
                  <Td className="pr-8 text-ink-faint">{formatDate(item.createdAt)}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="px-8 py-16 text-center text-sm text-ink-muted">
            {items.length === 0
              ? "Nothing in the inbox. Upload a broker spreadsheet to begin."
              : "No items match this filter."}
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("eyebrow px-3 py-2 font-medium", className)}>{children}</th>;
}
function Td({ children, className, title }: {
  children?: React.ReactNode; className?: string; title?: string;
}) {
  return <td title={title} className={cn("px-3 py-2 align-middle", className)}>{children}</td>;
}

function BulkButton({
  icon: Icon, label, onClick, disabled,
}: { icon: typeof Check; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-card px-2.5 py-1 text-2xs font-medium text-ink hover:border-gold/40 disabled:opacity-50">
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}

/** Read a value out of the staged extraction for the dense table. */
function extractedText(item: IngestionItem, field: string, suffix = ""): string {
  const entry = item.extracted[field] as { value?: unknown } | undefined;
  if (entry?.value == null) return "—";
  const value = entry.value;
  if (typeof value === "number") {
    if (suffix === "%") return `${value.toFixed(2)}%`;
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
    return value.toLocaleString("en-GB");
  }
  return `${String(value)}${suffix}`;
}
