"use client";

import { useState, useTransition } from "react";
import { saveInvestorMandateAction, clearInvestorMandateAction } from "@/app/actions/investor-mandates";
import {
  ASSET_TYPE_OPTIONS, STRATEGY_OPTIONS, MARKET_SUGGESTIONS, MANDATE_CURRENCIES, MAX_LIST,
  assetTypeLabel, strategyLabel, toMandateInput, EMPTY_MANDATE, type MandateInput,
} from "@/lib/mandate/mandate";
import type { StoredMandate } from "@/lib/data/investor-mandates";
import { formatDate } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const inputCls =
  "mt-1 h-9 w-full rounded border border-line bg-surface px-3 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30";

/**
 * What this investor organisation is looking for. Staff only, and it never reaches the portal.
 * Within a group a deal matches ANY of the ticked options; across groups it must satisfy every
 * group that has something ticked. A group with nothing ticked is not tested.
 */
export function MandateEditor({ investorOrgId, stored }: { investorOrgId: string; stored: StoredMandate | null }) {
  const [input, setInput] = useState<MandateInput>(() => toMandateInput(stored?.mandate ?? EMPTY_MANDATE));
  const [extraMarket, setExtraMarket] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const touch = () => { setError(null); setNotice(null); };
  const toggle = (key: "markets" | "assetTypes" | "strategies", value: string) => {
    touch();
    setInput((s) => ({
      ...s, [key]: s[key].includes(value) ? s[key].filter((v) => v !== value) : [...s[key], value],
    }));
  };
  const set = (key: "dealSizeMinM" | "dealSizeMaxM" | "minEntryYieldPct" | "currency", value: string) => {
    touch(); setInput((s) => ({ ...s, [key]: value }));
  };

  // Suggested markets, plus anything already chosen (so a market typed earlier stays visible).
  const markets = [...new Set([...MARKET_SUGGESTIONS, ...input.markets])];
  const addMarket = () => {
    const v = extraMarket.trim();
    if (!v) return;
    touch();
    setInput((s) => (s.markets.some((m) => m.toLowerCase() === v.toLowerCase()) ? s : { ...s, markets: [...s.markets, v] }));
    setExtraMarket("");
  };

  const save = () => start(async () => {
    const r = await saveInvestorMandateAction(investorOrgId, input);
    if (r.error) { setError(r.error); setNotice(null); } else { setNotice("Mandate saved."); setError(null); }
  });
  const clear = () => start(async () => {
    const r = await clearInvestorMandateAction(investorOrgId);
    if (r.error) { setError(r.error); } else { setInput(toMandateInput(EMPTY_MANDATE)); setNotice("Mandate cleared."); setError(null); }
  });

  return (
    <Card>
      <CardHeader eyebrow="Staff only" title="Investor mandate"
        action={<span className="text-2xs text-ink-faint">Never shown in the investor portal</span>} />
      <CardBody className="space-y-5">
        <p className="text-xs text-ink-muted">
          What this organisation says it wants. A deal matches when it is <strong>any of</strong> the ticked options in
          each group that has something ticked; a group with nothing ticked is not tested. Not the investment score.
        </p>

        <Group legend="Markets (any of)" hint={`Up to ${MAX_LIST}`}>
          {markets.map((m) => (
            <Check key={m} checked={input.markets.includes(m)} onChange={() => toggle("markets", m)}>{m}</Check>
          ))}
          <span className="flex items-center gap-1.5">
            <input value={extraMarket} onChange={(e) => setExtraMarket(e.target.value)} placeholder="Another market"
              aria-label="Add another market"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMarket(); } }}
              className="h-7 w-36 rounded border border-line bg-surface px-2 text-xs text-ink focus:border-line-strong focus:outline-none" />
            <button type="button" onClick={addMarket}
              className="rounded border border-line px-2 py-1 text-2xs font-medium text-ink-muted hover:text-ink">Add</button>
          </span>
        </Group>

        <Group legend="Asset types (any of)">
          {ASSET_TYPE_OPTIONS.map((a) => (
            <Check key={a} checked={input.assetTypes.includes(a)} onChange={() => toggle("assetTypes", a)}>{assetTypeLabel(a)}</Check>
          ))}
        </Group>

        <Group legend="Strategies (any of)">
          {STRATEGY_OPTIONS.map((s) => (
            <Check key={s} checked={input.strategies.includes(s)} onChange={() => toggle("strategies", s)}>{strategyLabel(s)}</Check>
          ))}
        </Group>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <label className="block">
            <span className="eyebrow">Deal size from (m)</span>
            <input inputMode="decimal" value={input.dealSizeMinM} onChange={(e) => set("dealSizeMinM", e.target.value)}
              placeholder="e.g. 10" className={inputCls} />
          </label>
          <label className="block">
            <span className="eyebrow">Deal size to (m)</span>
            <input inputMode="decimal" value={input.dealSizeMaxM} onChange={(e) => set("dealSizeMaxM", e.target.value)}
              placeholder="e.g. 40" className={inputCls} />
          </label>
          <label className="block">
            <span className="eyebrow">Currency</span>
            <select value={input.currency} onChange={(e) => set("currency", e.target.value)} className={inputCls}>
              {MANDATE_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="eyebrow">Minimum entry yield (%)</span>
            <input inputMode="decimal" value={input.minEntryYieldPct} onChange={(e) => set("minEntryYieldPct", e.target.value)}
              placeholder="e.g. 6" className={inputCls} />
          </label>
        </div>
        {/* A simplification, said out loud where the number is entered. */}
        <p className="text-2xs text-ink-faint">
          Deal size is compared with a deal&rsquo;s total cost. It is the size of deal they will look at, not their equity
          cheque: no equity-required figure exists on a deal yet. A deal in another currency is shown as unknown, not
          converted.
        </p>

        {error && (
          <p role="alert" className="rounded border border-negative/30 bg-negative/5 px-3 py-2 text-xs text-negative">{error}</p>
        )}
        {notice && <p role="status" className="text-xs text-positive">{notice}</p>}

        <div className="flex items-center justify-between">
          <span className="text-2xs text-ink-faint">
            {stored ? `Last updated ${formatDate(stored.updatedAt)}` : "No mandate recorded yet"}
          </span>
          <span className="flex items-center gap-2">
            {stored && (
              <button type="button" onClick={clear} disabled={pending}
                className="rounded border border-line px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-negative/40 hover:text-negative disabled:opacity-50">
                Clear
              </button>
            )}
            <button type="button" onClick={save} disabled={pending}
              className="rounded bg-purple px-4 py-2 text-xs font-semibold text-surface hover:bg-purple-70 disabled:opacity-60">
              {pending ? "Saving…" : "Save mandate"}
            </button>
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function Group({ legend, hint, children }: { legend: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="eyebrow mb-1.5">{legend}{hint && <span className="ml-2 normal-case text-ink-faint">{hint}</span>}</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">{children}</div>
    </fieldset>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-1.5 text-xs", checked ? "text-ink" : "text-ink-muted")}>
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-purple" />
      {children}
    </label>
  );
}
