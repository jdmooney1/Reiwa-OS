"use client";

import { useState, useTransition } from "react";
import { saveFxRateAction } from "@/app/actions/fx";
import type { FxRateRecord } from "@/lib/data/fx-rates";
import { fxStaleness, FX_BASE_CURRENCY, FX_STALE_AFTER_DAYS } from "@/lib/fx";
import { ActionError } from "@/components/workspace/primitives";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const field = "h-8 rounded border border-line bg-surface-card px-2 text-sm text-ink focus:border-line-strong focus:outline-none";

/**
 * One row per currency. The current source is shown as text and the source box
 * starts EMPTY: a rate is saved with a source the person has just typed, never
 * with the previous one carried over by default.
 */
function RateRow({ rate, today }: { rate: FxRateRecord; today: string }) {
  const [value, setValue] = useState(String(rate.rateToGbp));
  const [source, setSource] = useState("");
  const [asOf, setAsOf] = useState(today);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const isBase = rate.currency === FX_BASE_CURRENCY;
  const age = isBase ? null : fxStaleness(rate.asOf, today);

  function save() {
    setError(undefined); setSaved(false);
    startTransition(async () => {
      const res = await saveFxRateAction({ currency: rate.currency, rate: value, source, asOf });
      if (res.error) setError(res.error); else { setSaved(true); setSource(""); }
    });
  }

  return (
    <li className="px-5 py-4" data-currency={rate.currency}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm text-ink">
          <span className="font-medium">{rate.currency}</span>
          <span className="ml-2 tabular text-ink-muted">1 {rate.currency} = {rate.rateToGbp} GBP</span>
        </div>
        <div className="text-2xs text-ink-faint">
          {rate.source} · as at {formatDate(rate.asOf)}
          {rate.updatedByName && rate.updatedAt ? ` · set by ${rate.updatedByName}, ${formatDate(rate.updatedAt)}` : ""}
        </div>
      </div>
      {isBase && <p className="mt-1 text-xs text-ink-faint">The base currency: always 1, so it is never flagged as stale.</p>}
      {age?.stale && (
        <p className="mt-1 text-xs text-caution" role="status">
          {age.note} Rates older than {FX_STALE_AFTER_DAYS} days are flagged wherever they are used.
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_9.5rem_auto] sm:items-end">
        <label className="text-2xs text-ink-faint">
          Rate to GBP
          <input type="text" inputMode="decimal" value={value} disabled={isBase} aria-label={`${rate.currency} rate to GBP`}
            onChange={(e) => { setValue(e.target.value); setSaved(false); }} className={cn(field, "mt-1 block w-full tabular")} />
        </label>
        <label className="text-2xs text-ink-faint">
          Source (required)
          <input type="text" value={source} placeholder="e.g. ECB euro reference rate" aria-label={`${rate.currency} source`}
            onChange={(e) => { setSource(e.target.value); setSaved(false); }} className={cn(field, "mt-1 block w-full")} />
        </label>
        <label className="text-2xs text-ink-faint">
          As of
          <input type="date" value={asOf} max={today} aria-label={`${rate.currency} as of date`}
            onChange={(e) => { setAsOf(e.target.value); setSaved(false); }} className={cn(field, "mt-1 block w-full")} />
        </label>
        <button type="button" disabled={pending} onClick={save} aria-label={`Save ${rate.currency} rate`}
          className="h-8 rounded bg-purple px-3.5 text-xs font-semibold text-surface hover:bg-purple-70 disabled:opacity-50">
          {pending ? "Saving..." : "Save rate"}
        </button>
      </div>
      <div className="mt-2 space-y-1">
        <ActionError message={error} />
        {saved && <p className="text-2xs text-positive" role="status">Saved.</p>}
      </div>
    </li>
  );
}

export function FxRatesCard({ rates, today }: { rates: FxRateRecord[]; today: string }) {
  return (
    <ul className="divide-y divide-line">
      {rates.map((r) => <RateRow key={r.currency} rate={r} today={today} />)}
    </ul>
  );
}
