"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { createOpportunityAction } from "@/app/actions/opportunities";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import type { AssetType, Strategy } from "@/types/database";

const MARKETS = ["London", "Amsterdam", "Paris", "Berlin", "Frankfurt", "Madrid", "Milan", "Dublin", "Other"];

export function NewOpportunityForm({ orgs }: { orgs: { orgId: string; name: string }[] }) {
  return (
    <form action={createOpportunityAction} className="mx-auto max-w-2xl">
      <Card>
        <CardHeader eyebrow="Pipeline" title="New Opportunity" />
        <CardBody className="space-y-4">
          {orgs.length > 1 ? (
            <SelectField label="Organisation" name="orgId" options={orgs.map((o) => ({ value: o.orgId, label: o.name }))} />
          ) : (
            <input type="hidden" name="orgId" value={orgs[0]?.orgId ?? ""} />
          )}

          <TextField label="Asset / opportunity name" name="name" required placeholder="20 Example Street" />

          <div className="grid grid-cols-2 gap-4">
            <TextField label="City" name="city" placeholder="London" />
            <SelectField label="Market" name="market" options={MARKETS.map((m) => ({ value: m, label: m }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Asset type" name="assetType"
              options={(Object.keys(ASSET_TYPE_LABEL) as AssetType[]).map((k) => ({ value: k, label: ASSET_TYPE_LABEL[k] }))} />
            <SelectField label="Strategy" name="strategy"
              options={(Object.keys(STRATEGY_LABEL) as Strategy[]).map((k) => ({ value: k, label: STRATEGY_LABEL[k] }))} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <SelectField label="Currency" name="currency" options={["GBP", "EUR", "USD"].map((c) => ({ value: c, label: c }))} />
            <TextField label="Target price" name="targetPrice" type="number" placeholder="25000000" />
            <TextField label="NIY %" name="niy" type="number" step="0.01" placeholder="5.0" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <TextField label="Target IRR %" name="targetIrr" type="number" step="0.1" placeholder="15" />
            <TextField label="Capex budget" name="capexBudget" type="number" placeholder="2000000" />
            <TextField label="Source" name="source" placeholder="Off-market" />
          </div>
          <TextField label="Broker" name="brokerName" placeholder="Knight Frank" />
          <label className="block">
            <span className="eyebrow">Thesis / summary</span>
            <textarea name="summary" rows={3}
              className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30" />
          </label>
        </CardBody>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <Link href="/pipeline" className="rounded px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink">Cancel</Link>
          <Submit />
        </div>
      </Card>
    </form>
  );
}

function TextField({ label, name, type = "text", placeholder, required, step }: {
  label: string; name: string; type?: string; placeholder?: string; required?: boolean; step?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input name={name} type={type} placeholder={placeholder} required={required} step={step}
        className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30" />
    </label>
  );
}

function SelectField({ label, name, options }: { label: string; name: string; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <select name={name}
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
