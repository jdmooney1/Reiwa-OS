"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { createOpportunityAction } from "@/app/actions/opportunities";
import { ACTION_IDLE } from "@/lib/actions/result";
import { ActionError } from "@/components/workspace/primitives";
import { expectedCurrency } from "@/lib/market-currency";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import type { AssetType, Strategy } from "@/types/database";

const MARKETS = ["London", "Amsterdam", "Paris", "Berlin", "Frankfurt", "Madrid", "Milan", "Dublin", "Tokyo", "Other"];
const CURRENCIES = ["GBP", "EUR", "USD", "JPY"];

export function NewOpportunityForm({ orgs }: { orgs: { orgId: string; name: string }[] }) {
  const [state, formAction] = useFormState(createOpportunityAction, ACTION_IDLE);
  const [market, setMarket] = useState(MARKETS[0]);
  const [currency, setCurrency] = useState("GBP");
  // Choosing a market selects the currency it normally trades in. It is a
  // default, not a lock: the server refuses a mismatch unless it is confirmed.
  const expected = expectedCurrency(market);
  const mismatch = expected !== null && expected !== currency;
  return (
    <form action={formAction} className="mx-auto max-w-2xl">
      <Card>
        <CardHeader eyebrow="Pipeline" title="New Opportunity" />
        <CardBody className="space-y-4">
          {orgs.length > 1 ? (
            <SelectField label="Organisation" name="orgId" options={orgs.map((o) => ({ value: o.orgId, label: o.name }))} />
          ) : (
            <input type="hidden" name="orgId" value={orgs[0]?.orgId ?? ""} />
          )}

          <TextField label="Asset / opportunity name" name="name" required placeholder="20 Example Street" />

          {/*
            Address and postcode are what let Reiwa recognise this building the
            next time it comes to market. Without them the property cannot be
            keyed, and a relaunch two years from now opens an unrelated record.
          */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <TextField label="Address" name="address" placeholder="20 Example Street, Mayfair" />
            </div>
            <TextField label="Postcode" name="postcode" placeholder="W1S 2XJ" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <TextField label="City" name="city" placeholder="London" />
            <SelectField label="Market" name="market" options={MARKETS.map((m) => ({ value: m, label: m }))}
              value={market} onChange={(v) => { setMarket(v); const e = expectedCurrency(v); if (e) setCurrency(e); }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Asset type" name="assetType"
              options={(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map((k) => ({ value: k, label: ASSET_TYPE_LABEL[k] }))} />
            <SelectField label="Strategy" name="strategy"
              options={(Object.keys(STRATEGY_LABEL) as Strategy[]).map((k) => ({ value: k, label: STRATEGY_LABEL[k] }))} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SelectField label="Currency" name="currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              value={currency} onChange={setCurrency} />
            <TextField label="Target price" name="targetPrice" type="number" placeholder="25000000" min={0} />
            <TextField label="NIY %" name="niy" type="number" step="0.01" placeholder="5.0" min={0} max={100} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <TextField label="Target IRR %" name="targetIrr" type="number" step="0.1" placeholder="15" min={0} max={100} />
            <TextField label="Capex budget" name="capexBudget" type="number" placeholder="2000000" min={0} />
            <TextField label="Source" name="source" placeholder="Off-market" />
          </div>
          {mismatch && (
            <label className="flex items-start gap-2 border-l-2 border-caution pl-3 text-xs leading-relaxed text-ink-muted">
              <input type="checkbox" name="confirmCurrency" className="mt-0.5" />
              <span>
                {market} deals are normally {expected}, but this one is set to {currency}.
                Tick to confirm the currency is intended.
              </span>
            </label>
          )}
          <TextField label="Broker" name="brokerName" placeholder="Knight Frank" />
          <label className="block">
            <span className="eyebrow">Thesis / summary</span>
            <textarea name="summary" rows={3}
              className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30" />
          </label>
        </CardBody>
        <div className="space-y-3 border-t border-line px-5 py-3">
          <ActionError message={state.error} />
          <div className="flex items-center justify-end gap-2">
          <Link href="/pipeline" className="rounded px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink">Cancel</Link>
          <Submit />
          </div>
        </div>
      </Card>
    </form>
  );
}

function TextField({ label, name, type = "text", placeholder, required, step, min, max }: {
  label: string; name: string; type?: string; placeholder?: string; required?: boolean; step?: string;
  min?: number; max?: number;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input name={name} type={type} placeholder={placeholder} required={required} step={step} min={min} max={max}
        className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30" />
    </label>
  );
}

function SelectField({ label, name, options, value, onChange }: {
  label: string; name: string; options: { value: string; label: string }[];
  /** Controlled when given; otherwise the browser owns the value. */
  value?: string; onChange?: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <select name={name} {...(value !== undefined ? { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange?.(e.target.value) } : {})}
        className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-2.5 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="rounded bg-purple px-4 py-2 text-xs font-semibold text-surface hover:bg-purple-70 disabled:opacity-60">
      {pending ? "Creating…" : "Create Opportunity"}
    </button>
  );
}
