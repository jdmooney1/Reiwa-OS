"use client";

// ============================================================================
// Review one staged item: what was extracted, where each value came from, and
// what it might already be.
// ----------------------------------------------------------------------------
// Approve / Edit / Merge / Reject / Pass, per the brief. Every value shows the
// source column it was read from, and low-confidence values carry a gold rule
// rather than a number shouted at the reviewer.
// ============================================================================
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check, X, Loader2, ChevronLeft, AlertTriangle, Link2, EyeOff,
} from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FIELDS, FIELD_BY_KEY, type FieldKey } from "@/lib/ingestion/fields";
import { matchPercent } from "@/lib/ingestion/match";
import { promoteItemAction, setReviewStatusAction } from "@/app/actions/ingestion";
import type { IngestionItem } from "@/lib/data/ingestion";

interface Candidate {
  candidateId: string;
  propertyId: string | null;
  opportunityId: string | null;
  score: number;
  band: string;
  reasons: string[];
  label: string | null;
}

interface ExtractedEntry {
  value?: unknown;
  confidence?: number | null;
  notes?: string[];
  excerpt?: string;
  source_header?: string;
}

export function ItemReview({
  item, candidates,
}: {
  item: IngestionItem;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [attachTo, setAttachTo] = useState<string | null>(null);

  const extracted = item.extracted as Record<string, ExtractedEntry>;
  const blocking = item.issues.filter((i) => i.severity === "error");
  const done = !!item.promotedAt;

  const act = (fn: () => Promise<unknown>, back = true) => {
    setError(null);
    start(async () => {
      try {
        await fn();
        if (back) router.push("/inbox");
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const overrides = () => {
    const out: Record<string, string | number | null> = {};
    for (const [key, raw] of Object.entries(edits)) {
      const def = FIELD_BY_KEY[key as FieldKey];
      if (!def) continue;
      const trimmed = raw.trim();
      if (trimmed === "") { out[key] = null; continue; }
      out[key] = ["money", "percent", "area", "integer"].includes(def.kind)
        ? Number(trimmed.replace(/[£€$¥,\s%]/g, ""))
        : trimmed;
    }
    return out;
  };

  const groups = ["identity", "asset", "financial", "occupancy", "transaction", "description"] as const;

  return (
    <div className="min-h-full">
      <div className="border-b border-line bg-surface-card px-8 py-5">
        <Link href="/inbox" className="mb-2 inline-flex items-center gap-1 text-2xs text-ink-faint hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Deal Inbox
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-serif text-2xl text-ink">
                {item.displayName ?? "Unnamed row"}
              </h1>
              {done && <Badge tone="positive" dot>Promoted</Badge>}
              {blocking.length > 0 && <Badge tone="negative">{blocking.length} blocking</Badge>}
            </div>
            <div className="mt-1 text-sm text-ink-muted">
              {item.displayLocation ?? "No address supplied"}
              {item.sourceFileName && <> · from {item.sourceFileName}</>}
              {" "}· row {item.sequence}
            </div>
          </div>

          {!done && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => act(() => promoteItemAction(item.itemId, {
                  attachToOpportunityId: attachTo, overrides: overrides(),
                }))}
                disabled={pending || blocking.length > 0}
                title={blocking.length > 0
                  ? "Resolve the blocking issues below before approving"
                  : attachTo ? "Attach to the selected opportunity" : "Create a new opportunity"}
                className="inline-flex items-center gap-1.5 rounded bg-gold px-3.5 py-2 text-xs font-semibold text-navy hover:bg-gold-soft disabled:opacity-50">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : attachTo ? <Link2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                {attachTo ? "Merge into selected" : "Approve as new opportunity"}
              </button>
              <button onClick={() => act(() => setReviewStatusAction([item.itemId], "passed"))}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded border border-line px-3.5 py-2 text-xs font-medium text-ink-muted hover:border-gold/40 disabled:opacity-50">
                <EyeOff className="h-3.5 w-3.5" /> Pass
              </button>
              <button onClick={() => act(() => setReviewStatusAction([item.itemId], "rejected"))}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded border border-line px-3.5 py-2 text-xs font-medium text-ink-muted hover:border-negative/40 disabled:opacity-50">
                <X className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b border-negative/30 bg-negative/5 px-8 py-3 text-xs text-negative">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-3">
        {/* ---- Extracted fields ---------------------------------------- */}
        <div className="space-y-6 lg:col-span-2">
          {blocking.length > 0 && (
            <Card className="border-negative/30">
              <CardHeader eyebrow="Blocking" title="Resolve before approving" />
              <CardBody className="space-y-1.5">
                {blocking.map((issue, i) => (
                  <div key={i} className="text-xs text-negative">{issue.message}</div>
                ))}
              </CardBody>
            </Card>
          )}

          {groups.map((group) => {
            const fields = FIELDS.filter(
              (f) => f.group === group && (extracted[f.key]?.value != null || f.important));
            if (fields.length === 0) return null;
            return (
              <Card key={group}>
                <CardHeader eyebrow={group} title={GROUP_TITLE[group]} />
                <CardBody className="space-y-0 p-0">
                  {fields.map((field) => {
                    const entry = extracted[field.key];
                    const confidence = entry?.confidence ?? null;
                    const low = confidence !== null && confidence < 0.7;
                    return (
                      <div key={field.key}
                        className={cn(
                          "flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line/60 px-5 py-2.5 last:border-b-0",
                          low && "border-l-2 border-l-gold pl-[18px]",
                        )}>
                        <div className="w-40 shrink-0 text-2xs text-ink-muted">{field.label}</div>
                        <div className="min-w-0 flex-1">
                          {done ? (
                            <span className="text-sm text-ink">
                              {entry?.value == null ? <span className="text-ink-faint">Not stated</span>
                                : String(entry.value)}
                            </span>
                          ) : (
                            <input
                              defaultValue={entry?.value == null ? "" : String(entry.value)}
                              placeholder="Not stated"
                              onChange={(e) =>
                                setEdits((prev) => ({ ...prev, [field.key]: e.target.value }))}
                              className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-ink placeholder:text-ink-faint hover:border-line focus:border-gold/50 focus:bg-surface-card focus:outline-none"
                            />
                          )}
                          {/* Provenance: where this value came from. */}
                          {entry?.source_header && (
                            <div className="mt-0.5 px-1.5 text-2xs text-ink-faint">
                              from column &ldquo;{entry.source_header}&rdquo;
                              {entry.excerpt ? ` — "${entry.excerpt}"` : ""}
                            </div>
                          )}
                          {entry?.notes && entry.notes.length > 0 && (
                            <div className="mt-0.5 px-1.5 text-2xs text-caution">
                              {entry.notes.filter((n) => !n.startsWith("unconfirmed_mapping")).join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            );
          })}

          {/* The source row, verbatim. Including the columns nothing mapped. */}
          <Card>
            <CardHeader eyebrow="Source" title="Original row, as received"
              action={<span className="text-2xs text-ink-faint">Preserved unchanged</span>} />
            <CardBody className="p-0">
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {Object.entries(item.rawPayload).map(([key, value]) => {
                    const mapped = Object.values(extracted).some((e) => e?.source_header === key);
                    return (
                      <tr key={key} className="border-b border-line/60 last:border-b-0">
                        <td className="w-48 px-5 py-1.5 text-2xs text-ink-muted">{key}</td>
                        <td className="px-5 py-1.5 text-ink">
                          {value == null || value === "" ? <span className="text-ink-faint">—</span> : String(value)}
                        </td>
                        <td className="w-28 px-5 py-1.5 text-right">
                          {!mapped && <Badge tone="muted">kept</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </div>

        {/* ---- Matches -------------------------------------------------- */}
        <div className="space-y-6">
          <Card>
            <CardHeader eyebrow="Matching" title="Possible existing records" />
            <CardBody className="space-y-2">
              {candidates.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  Nothing in the database scored above the match threshold. Approving this will
                  create a new opportunity.
                </p>
              ) : (
                <>
                  <button
                    onClick={() => setAttachTo(null)}
                    className={cn(
                      "w-full rounded border px-3 py-2 text-left text-xs transition-colors",
                      attachTo === null
                        ? "border-gold bg-gold/10 text-ink"
                        : "border-line bg-surface hover:border-gold/40",
                    )}>
                    <div className="font-medium">Create a new opportunity</div>
                    <div className="mt-0.5 text-2xs text-ink-muted">
                      Treat this as a property Reiwa has not seen before.
                    </div>
                  </button>

                  {candidates.map((c) => (
                    <button
                      key={c.candidateId}
                      onClick={() => setAttachTo(c.opportunityId)}
                      disabled={!c.opportunityId}
                      className={cn(
                        "w-full rounded border px-3 py-2 text-left text-xs transition-colors disabled:opacity-50",
                        attachTo && attachTo === c.opportunityId
                          ? "border-gold bg-gold/10"
                          : "border-line bg-surface hover:border-gold/40",
                      )}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">{c.label ?? "Untitled"}</span>
                        <span className="tabular text-gold-deep">{matchPercent(c.score)}%</span>
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {c.reasons.map((r, i) => (
                          <div key={i} className="text-2xs text-ink-muted">{r}</div>
                        ))}
                      </div>
                      {!c.opportunityId && (
                        <div className="mt-1 text-2xs text-ink-faint">
                          Property known, but it has no open opportunity to merge into.
                        </div>
                      )}
                    </button>
                  ))}
                  <p className="pt-1 text-2xs text-ink-faint">
                    Nothing is ever merged automatically. Choose deliberately.
                  </p>
                </>
              )}
            </CardBody>
          </Card>

          {item.issues.filter((i) => i.severity === "warning").length > 0 && (
            <Card>
              <CardHeader eyebrow="Review" title="Worth checking" />
              <CardBody className="space-y-1.5">
                {item.issues.filter((i) => i.severity === "warning").map((issue, i) => (
                  <div key={i} className="text-2xs text-ink-muted">{issue.message}</div>
                ))}
              </CardBody>
            </Card>
          )}

          {done && item.matchedOpportunityId && (
            <Card>
              <CardBody>
                <Link href={`/opportunities/${item.matchedOpportunityId}`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-deep hover:underline">
                  View the opportunity <Link2 className="h-3.5 w-3.5" />
                </Link>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const GROUP_TITLE: Record<string, string> = {
  identity: "Property identity",
  asset: "Asset",
  financial: "Financial",
  occupancy: "Occupancy and leasing",
  transaction: "Transaction",
  description: "Description",
};
