"use client";

import { useReducer, useState } from "react";
import type { UnderwritingVersion } from "@/lib/data/underwriting-types";
import { useFormState } from "react-dom";
import { createVersionAction } from "@/app/actions/workspace";
import { ACTION_IDLE } from "@/lib/actions/result";
import { ActionError } from "@/components/workspace/primitives";
import { currencySymbol } from "@/lib/format";
import { RENT_ROLL_COLUMNS, RentRollSchema, rentRollToCsv, overridesToText, readOverrides } from "@/lib/underwrite/inputs";
import type { Currency } from "@/types/database";
import {
  deriveReducer, initDerive, isAutoFilled, reconcile, type Warning,
} from "@/lib/underwriting/derive";

/**
 * Create the next underwriting version.
 *
 * Prefilled from the version it supersedes, because underwriting is revised
 * rather than rewritten: the analyst changes three numbers, and the other
 * fifteen must carry forward unchanged or the comparison between versions
 * becomes noise.
 *
 * Structured inputs only, for fields the schema actually has. There is no
 * formula bar. Total cost is computed in Postgres from price, costs and capex.
 *
 * A few fields follow arithmetically from others (equity, LTV, occupancy, entry
 * yield, ...). Those are filled in when empty and marked "calculated"; anything
 * the person has typed, or that carried forward from the last version, is never
 * overwritten. The rules live in lib/underwriting/derive.ts.
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
    title: "Value allocation",
    fields: [
      { name: "landValue", label: "Land value", kind: "money" },
      { name: "buildingValue", label: "Building value (depreciable)", kind: "money" },
      { name: "depreciationYears", label: "Depreciation life (years)", kind: "years" },
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
  return (
    <VersionFields
      opportunityId={opportunityId} seed={seed} currency={currency}
      onCancel={() => setOpen(false)}
    />
  );
}

/** Every numeric field as the string the form holds, carried forward from the seed. */
function seedValues(seed: UnderwritingVersion | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of GROUPS) {
    for (const f of g.fields) {
      const v = seed?.[f.name];
      out[String(f.name)] = typeof v === "number" ? String(v) : "";
    }
  }
  return out;
}

function VersionFields({
  opportunityId, seed, currency, onCancel,
}: {
  opportunityId: string;
  seed: UnderwritingVersion | null;
  currency: Currency;
  onCancel: () => void;
}) {
  const [state, formAction] = useFormState(
    createVersionAction.bind(null, opportunityId), ACTION_IDLE);
  const [derive, dispatch] = useReducer(deriveReducer, seed, (s) => initDerive(seedValues(s)));
  const sym = currencySymbol(currency);

  const warnings = reconcile(derive.values, currency);
  const costsTouched = derive.touched.has("acquisitionCosts");

  return (
    <form action={formAction} className="max-w-4xl space-y-6">
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
            {g.fields.map((f) => {
              const name = String(f.name);
              return (
                <Field
                  key={name}
                  label={f.label}
                  name={name}
                  type="number"
                  step={f.kind === "money" || f.name === "depreciationYears" ? "1" : "0.01"}
                  prefix={f.kind === "money" ? sym : undefined}
                  suffix={f.kind === "percent" ? "%" : f.kind === "multiple" ? "x" : undefined}
                  value={derive.values[name] ?? ""}
                  calculated={isAutoFilled(derive, name)}
                  onValue={(raw) => dispatch({ type: "edit", name, raw })}
                  onBlur={() => dispatch({ type: "blur", name })}
                />
              );
            })}
            {g.title === "Cost" && (
              <div>
                <Field
                  label="Costs as % of price"
                  type="number"
                  step="0.01"
                  suffix="%"
                  value={derive.costsPctDraft}
                  onValue={(raw) => dispatch({ type: "costsPctDraft", raw })}
                  onBlur={() => dispatch({ type: "costsPctCommit" })}
                />
                {derive.costsPct !== "" && costsTouched && (
                  <p className="mt-1 text-2xs text-ink-faint">
                    Acquisition costs were entered directly, so {derive.costsPct}% is not
                    applied. Clear that field to use it.
                  </p>
                )}
              </div>
            )}
          </div>
          {g.title === "Debt" && <Warnings items={warnings.filter((w) => w.group === "sources")} />}
          {g.title === "Income" && <Warnings items={warnings.filter((w) => w.group === "income")} />}
          {g.title === "Value allocation" && (
            <>
              <Warnings items={warnings.filter((w) => w.group === "allocation")} />
              <p className="mt-2 text-2xs text-ink-faint">
                Enter one half and the other is filled as the remainder of the acquisition price. Building value is the
                depreciable base; the annual charge is worked out straight-line over this life and shown on the Asset
                Snapshot with its yen equivalent. It is an estimate, not tax advice.
              </p>
            </>
          )}
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

      <details className="rounded border border-line px-4 py-3" open={Boolean(seedRentRoll(seed))}>
        <summary className="cursor-pointer text-sm font-medium text-ink">Rent roll and model settings (for the Assessment tab)</summary>
        <label className="mt-3 block">
          <span className="eyebrow">Rent roll (CSV, one unit per row)</span>
          <textarea
            name="rentRoll"
            rows={6}
            defaultValue={seedRentRoll(seed)}
            placeholder={RENT_ROLL_COLUMNS.join(",")}
            spellCheck={false}
            className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 font-mono text-xs text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30"
          />
          <span className="mt-1 block text-2xs text-ink-faint">
            Header row first. Required: unit, use (office, retail, residential, industrial, hotel, other), area_sqft, rent_pa.
            Dates as yyyy-mm-dd; review_basis upward_only, open_market or none; renewal_pct 0-100. A guaranteed vacant unit
            carries its guaranteed rent in rent_pa and the end date in guarantee_until. Leave empty for the screening model.
          </span>
        </label>
        <label className="mt-3 block">
          <span className="eyebrow">Model settings (one per line, key = value)</span>
          <textarea
            name="modelSettings"
            rows={3}
            defaultValue={seedSettings(seed)}
            placeholder={"exitYieldPct = 6.5\npurchaseCostsPct = 1.8\nrentGrowthPct = 2"}
            spellCheck={false}
            className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 font-mono text-xs text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30"
          />
          <span className="mt-1 block text-2xs text-ink-faint">
            Overrides the assessment&apos;s market defaults for this version: startDate, holdYears, exitYieldPct, purchaseCostsPct,
            saleCostsPct, rentGrowthPct, voidMonths, rentFreeMonths, renewalPct, waultYears, ltvPct, debtRatePct, refiRatePct,
            taxRatePct, acqFeePct, amFeePct, promotePct, hurdlePct, hedgeRatioPct, fxExitSpot, groundRentPct, nonRecoverablePct,
            fixedCostsPa. Percentages as typed (6.5 means 6.5%).
          </span>
        </label>
      </details>

      <div className="flex items-center gap-2 border-t border-line pt-4">
        <button
          type="submit"
          className="rounded bg-purple px-4 py-2 text-xs font-semibold text-surface hover:bg-purple-70"
        >
          Create version
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
        <span className="text-2xs text-ink-faint">
          Total cost is computed from price, costs and capex. Fields marked
          calculated are filled in for you; type over one to keep your own figure.
        </span>
      </div>
      <ActionError message={state.error} />
    </form>
  );
}

function Warnings({ items }: { items: Warning[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1" role="status">
      {items.map((w) => (
        <li key={w.message} className="rounded border border-caution/40 bg-caution/10 px-3 py-1.5 text-xs text-ink">
          {w.message}
        </li>
      ))}
    </ul>
  );
}

function Field({
  label, name, type = "text", step, defaultValue, value, placeholder, prefix, suffix, required,
  calculated, onValue, onBlur,
}: {
  label: string;
  /** Omitted for a helper box that must not be posted with the form. */
  name?: string;
  type?: string;
  step?: string;
  defaultValue?: string;
  /** With onValue, makes the input controlled. */
  value?: string;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  required?: boolean;
  /** The value was filled in by the form, not typed. */
  calculated?: boolean;
  onValue?: (raw: string) => void;
  onBlur?: () => void;
}) {
  const controlled = value !== undefined;
  return (
    <label className="block">
      <span className="eyebrow">
        {label}
        {calculated && (
          <span className="ml-1.5 rounded bg-surface-sunken px-1 py-px text-2xs font-medium normal-case tracking-normal text-ink-muted">
            calculated
          </span>
        )}
      </span>
      <span className="mt-1 flex h-9 items-center rounded border border-line bg-surface-card focus-within:border-line-strong focus-within:ring-1 focus-within:ring-purple/30">
        {prefix && <span className="pl-2.5 text-2xs text-ink-faint">{prefix}</span>}
        <input
          name={name}
          type={type}
          step={step}
          required={required}
          {...(controlled
            ? { value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onValue?.(e.target.value) }
            : { defaultValue })}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`h-full w-full min-w-0 bg-transparent px-2.5 text-sm placeholder:text-ink-faint focus:outline-none ${
            calculated ? "italic text-ink-muted" : "text-ink"
          }`}
        />
        {suffix && <span className="pr-2.5 text-2xs text-ink-faint">{suffix}</span>}
      </span>
    </label>
  );
}

/** The seed's rent roll as CSV, carried forward like every other field. */
function seedRentRoll(seed: UnderwritingVersion | null): string {
  const parsed = RentRollSchema.safeParse(seed?.assumptions?.rentRoll);
  return parsed.success && parsed.data.length ? rentRollToCsv(parsed.data) : "";
}

function seedSettings(seed: UnderwritingVersion | null): string {
  return overridesToText(readOverrides(seed?.assumptions).overrides);
}
