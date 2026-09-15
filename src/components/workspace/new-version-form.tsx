"use client";

import { useState } from "react";
import type { UnderwritingVersion } from "@/lib/data/underwriting-types";
import { createVersionAction } from "@/app/actions/workspace";
import { currencySymbol } from "@/lib/format";
import type { Currency } from "@/types/database";

/**
 * Create the next underwriting version.
 *
 * Prefilled from the version it supersedes, because underwriting is revised
 * rather than rewritten: the analyst changes three numbers, and the other
 * fifteen must carry forward unchanged or the comparison between versions
 * becomes noise.
 *
 * Structured inputs only, for fields the schema actually has. There is no
 * formula bar and no derived cell — total cost is computed in Postgres from
 * price, costs and capex, so it is shown here as a read-only consequence of
 * what is typed rather than as something to disagree with.
 */
const GROUPS: { title: string; fields: { name: keyof UnderwritingVersion; label: string; kind: "money" | "percent" | "years" | "multiple" }[] }[] = [
  {
    title: "Cost",
    fields: [
      { name: "acquisitionPrice", label: "Acquisition price", kind: "money" },
      { name: "acquisitionCosts", label: "Acquisition costs", kind: "money" },
      { name: "capex", label: "Capital expenditure", kind: "money" },
      { name: "equity", label: "Equity", kind: "money" },
    ],
  },
  {
    title: "Income",
    fields: [
      { name: "grossRentalIncome", label: "Gross rental income", kind: "money" },
      { name: "noi", label: "Net operating income", kind: "money" },
      { name: "erv", label: "ERV", kind: "money" },
      { name: "occupancyPct", label: "Occupancy", kind: "percent" },
    ],
  },
  {
    title: "Debt",
    fields: [
      { name: "debt", label: "Debt", kind: "money" },
      { name: "ltvPct", label: "Leverage (LTV)", kind: "percent" },
      { name: "debtCostPct", label: "Debt cost", kind: "percent" },
    ],
  },
  {
    title: "Value and return",
    fields: [
      { name: "valuation", label: "Entry valuation", kind: "money" },
      { name: "exitValue", label: "Exit / stabilised value", kind: "money" },
      { name: "entryYieldPct", label: "Entry yield", kind: "percent" },
      { name: "exitYieldPct", label: "Exit yield", kind: "percent" },
      { name: "holdPeriodYears", label: "Hold period (years)", kind: "years" },
      { name: "targetIrr", label: "Target IRR", kind: "percent" },
      { name: "targetEquityMultiple", label: "Equity multiple", kind: "multiple" },
    ],
  },
];

export function NewVersionForm({
  opportunityId, seed, currency,
}: {
  opportunityId: string;
  seed: UnderwritingVersion | null;
  currency: Currency;
}) {
  const [open, setOpen] = useState(false);
  const sym = currencySymbol(currency);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-purple px-4 py-2 text-xs font-semibold text-surface hover:bg-purple-70"
      >
        {seed ? `Revise from v${seed.version}` : "Create first version"}
      </button>
    );
  }

  const initial = (k: keyof UnderwritingVersion) => {
    const v = seed?.[k];
    return typeof v === "number" ? String(v) : "";
  };

  return (
    <form action={createVersionAction.bind(null, opportunityId)} className="max-w-4xl space-y-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        <Field label="Strategy" name="strategy" defaultValue={seed?.strategy ?? ""} />
        <Field
          label="Change rationale"
          name="changeRationale"
          placeholder="Why this version differs"
          required
        />
      </div>

      {GROUPS.map((g) => (
        <fieldset key={g.title}>
          <legend className="eyebrow mb-2">{g.title}</legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {g.fields.map((f) => (
              <Field
                key={String(f.name)}
                label={f.label}
                name={String(f.name)}
                type="number"
                step={f.kind === "money" ? "1" : "0.01"}
                prefix={f.kind === "money" ? sym : undefined}
                suffix={f.kind === "percent" ? "%" : f.kind === "multiple" ? "x" : undefined}
                defaultValue={initial(f.name)}
              />
            ))}
          </div>
        </fieldset>
      ))}

      <label className="block">
        <span className="eyebrow">Investment thesis</span>
        <textarea
          name="thesis"
          rows={4}
          defaultValue={seed?.thesis ?? ""}
          className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30"
        />
      </label>

      <label className="block">
        <span className="eyebrow">Business plan</span>
        <textarea
          name="businessPlanAssumptions"
          rows={3}
          defaultValue={seed?.businessPlanAssumptions ?? ""}
          className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30"
        />
      </label>

      <div className="flex items-center gap-2 border-t border-line pt-4">
        <button
          type="submit"
          className="rounded bg-purple px-4 py-2 text-xs font-semibold text-surface hover:bg-purple-70"
        >
          Create version
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
        <span className="text-2xs text-ink-faint">
          Total cost is computed from price, costs and capex.
        </span>
      </div>
    </form>
  );
}

function Field({
  label, name, type = "text", step, defaultValue, placeholder, prefix, suffix, required,
}: {
  label: string;
  name: string;
  type?: string;
  step?: string;
  defaultValue?: string;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <span className="mt-1 flex h-9 items-center rounded border border-line bg-surface-card focus-within:border-line-strong focus-within:ring-1 focus-within:ring-purple/30">
        {prefix && <span className="pl-2.5 text-2xs text-ink-faint">{prefix}</span>}
        <input
          name={name}
          type={type}
          step={step}
          required={required}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="h-full w-full min-w-0 bg-transparent px-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
        {suffix && <span className="pr-2.5 text-2xs text-ink-faint">{suffix}</span>}
      </span>
    </label>
  );
}
