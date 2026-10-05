"use client";

import { useState, useTransition } from "react";
import { Copy, Check } from "lucide-react";
import { createDealShareAction } from "@/app/actions/deal-shares";
import { ActionError } from "@/components/workspace/primitives";
import { DEAL_SHARE_TTL_DAYS_DEFAULT, DEAL_SHARE_TTL_DAYS_MAX } from "@/lib/deal-share/limits";
import type { ShareableMemo } from "@/lib/data/deal-shares";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const field = "h-9 rounded border border-line bg-surface-card px-2.5 text-sm text-ink focus:border-line-strong focus:outline-none disabled:opacity-50";

/**
 * Share two frozen documents with ONE named prospect. The link comes back once, here, with
 * a copy button and a plain warning that it will not be shown again: staff sends it
 * themselves; nothing is emailed from here.
 */
export function DealShareForm({ opportunityId, memos }: { opportunityId: string; memos: ShareableMemo[] }) {
  const snapshots = memos.filter((m) => m.hasSnapshot);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(String(DEAL_SHARE_TTL_DAYS_DEFAULT));
  const [useSnapshot, setUseSnapshot] = useState(snapshots.length > 0);
  const [useTeaser, setUseTeaser] = useState(memos.length > 0);
  const [snapshotMemoId, setSnapshotMemoId] = useState(snapshots[0]?.memoId ?? "");
  const [teaserMemoId, setTeaserMemoId] = useState(memos[0]?.memoId ?? "");
  const [error, setError] = useState<string | undefined>();
  const [made, setMade] = useState<{ link: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const chosenSnapshot = snapshots.find((m) => m.memoId === snapshotMemoId);

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const res = await createDealShareAction({
        opportunityId, prospectName: name, prospectEmail: email, ttlDays: Number(days),
        snapshotMemoId: useSnapshot ? snapshotMemoId || null : null,
        teaserMemoId: useTeaser ? teaserMemoId || null : null,
      });
      if (res.error) setError(res.error);
      else if (res.link && res.expiresAt) setMade({ link: res.link, expiresAt: res.expiresAt });
    });
  }

  async function copy(link: string) {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  }

  if (made) {
    return (
      <div className="space-y-4" data-state="created">
        <div className="rounded border border-caution bg-surface-card px-4 py-3 text-sm text-ink" role="alert">
          <strong>This link will not be shown again.</strong> Copy it now and send it yourself. Only a fingerprint of it is kept, so if it is lost the
          only remedy is to revoke it and create another.
        </div>
        <div className="flex items-stretch gap-2">
          <input readOnly value={made.link} aria-label="Prospect link" onFocus={(e) => e.currentTarget.select()}
            className={cn(field, "min-w-0 flex-1 font-mono text-xs")} />
          <button type="button" onClick={() => copy(made.link)}
            className="inline-flex items-center gap-1.5 rounded bg-purple px-3.5 text-xs font-semibold text-surface hover:bg-purple-70">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-xs text-ink-muted">
          For {name}. Expires {formatDate(made.expiresAt)}. Revoke it any time from the list of links.
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-ink-muted">Prospect&apos;s name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={cn(field, "mt-1 block w-full")} required />
        </label>
        <label className="text-xs text-ink-muted">Prospect&apos;s email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={cn(field, "mt-1 block w-full")} required />
        </label>
        <label className="text-xs text-ink-muted">Link lasts (days, 1 to {DEAL_SHARE_TTL_DAYS_MAX})
          <input type="number" min={1} max={DEAL_SHARE_TTL_DAYS_MAX} value={days} onChange={(e) => setDays(e.target.value)} className={cn(field, "mt-1 block w-full tabular")} />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-xs text-ink-muted">Documents to include</legend>
        <div className="flex flex-wrap items-center gap-3">
          <label className={cn("flex items-center gap-2 text-sm", snapshots.length === 0 && "text-ink-faint")}>
            <input type="checkbox" checked={useSnapshot} disabled={snapshots.length === 0} onChange={(e) => setUseSnapshot(e.target.checked)} />
            Asset Snapshot
          </label>
          {snapshots.length > 0 ? (
            <select value={snapshotMemoId} disabled={!useSnapshot} onChange={(e) => setSnapshotMemoId(e.target.value)} className={field} aria-label="Snapshot version">
              {snapshots.map((m) => <option key={m.memoId} value={m.memoId}>Version {m.version}, finalised {formatDate(m.finalizedAt)}</option>)}
            </select>
          ) : <span className="text-xs text-ink-faint">No finalised Snapshot yet. Finalise the memo first.</span>}
        </div>
        {useSnapshot && chosenSnapshot?.snapshotPicturesLive && (
          <p className="text-xs text-caution">This version was finalised before pictures were frozen, so it will be shown without its photograph and map.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className={cn("flex items-center gap-2 text-sm", memos.length === 0 && "text-ink-faint")}>
            <input type="checkbox" checked={useTeaser} disabled={memos.length === 0} onChange={(e) => setUseTeaser(e.target.checked)} />
            Investor Teaser
          </label>
          {memos.length > 0 ? (
            <select value={teaserMemoId} disabled={!useTeaser} onChange={(e) => setTeaserMemoId(e.target.value)} className={field} aria-label="Teaser version">
              {memos.map((m) => <option key={m.memoId} value={m.memoId}>Version {m.version}, finalised {formatDate(m.finalizedAt)}</option>)}
            </select>
          ) : <span className="text-xs text-ink-faint">No finalised memo yet. Finalise the memo first.</span>}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || (!useSnapshot && !useTeaser)}
          className="rounded bg-purple px-3.5 py-2 text-xs font-semibold text-surface hover:bg-purple-70 disabled:opacity-50">
          {pending ? "Creating..." : "Create link"}
        </button>
        <ActionError message={error} />
      </div>
    </form>
  );
}
