"use client";

// ============================================================================
// Import: upload, confirm the mapping, preview, stage.
// ----------------------------------------------------------------------------
// One page, three sections — not a multi-page wizard. The user needs to see the
// mapping and its consequences at the same time, because the whole point of
// confirming a mapping is judging what it does to the data.
// ============================================================================
import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Upload, Loader2, AlertTriangle, Check, FileSpreadsheet, ChevronRight, Info,
} from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FIELDS, FIELD_BY_KEY, type FieldKey } from "@/lib/ingestion/fields";
import { parseUploadAction, confirmImportAction, type ParsePreview } from "@/app/actions/ingestion";

const CURRENCIES = ["GBP", "EUR", "USD", "JPY"] as const;

export function ImportPanel({ orgs }: { orgs: { orgId: string; name: string }[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [chosen, setChosen] = useState<Record<string, string | null>>({});

  const [orgId, setOrgId] = useState(orgs[0]?.orgId ?? "");
  const [currency, setCurrency] = useState<string>("GBP");
  const [country, setCountry] = useState<string>("");
  const [areaUnit, setAreaUnit] = useState<"sqft" | "sqm">("sqft");
  const [templateName, setTemplateName] = useState("");

  const upload = useCallback((file: File) => {
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("defaultCurrency", currency);
    formData.set("defaultAreaUnit", areaUnit);
    if (country) formData.set("defaultCountry", country);
    start(async () => {
      try {
        const result = await parseUploadAction(formData);
        setPreview(result);
        setChosen(Object.fromEntries(result.mappings.map((m) => [m.header, m.field])));
      } catch (e) {
        setError((e as Error).message);
        setPreview(null);
      }
    });
  }, [currency, areaUnit, country]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  };

  const confirm = () => {
    if (!preview) return;
    setError(null);
    start(async () => {
      try {
        const result = await confirmImportAction({
          orgId,
          fileName: preview.fileName,
          label: preview.fileName,
          mappings: chosen,
          grid: preview.grid,
          defaultCurrency: currency,
          defaultCountry: country || null,
          defaultAreaUnit: areaUnit,
          saveTemplateName: templateName || null,
        });
        router.push(`/inbox?batch=${result.batchId}`);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  // Which fields are already claimed, so the selects cannot double-assign one.
  const claimed = new Set(Object.values(chosen).filter(Boolean) as string[]);

  return (
    <div className="space-y-6 px-8 py-6">
      {error && (
        <div className="flex items-start gap-2 rounded border border-negative/30 bg-negative/5 px-4 py-3 text-xs text-negative">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ---- Upload ---------------------------------------------------- */}
      {!preview && (
        <Card>
          <CardHeader eyebrow="Step 1" title="Upload a broker list" />
          <CardBody>
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
              <Field label="Organisation">
                <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={SELECT}>
                  {orgs.map((o) => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
                </select>
              </Field>
              <Field label="Default currency"
                hint="Used only where a row does not state its own.">
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={SELECT}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Default country">
                <input value={country} onChange={(e) => setCountry(e.target.value)}
                  placeholder="United Kingdom" className={SELECT} />
              </Field>
              <Field label="Area unit" hint="For columns that state no unit.">
                <select value={areaUnit} onChange={(e) => setAreaUnit(e.target.value as "sqft" | "sqm")}
                  className={SELECT}>
                  <option value="sqft">sq ft</option>
                  <option value="sqm">sq m</option>
                </select>
              </Field>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded border border-dashed px-6 py-12 text-center transition-colors",
                dragging ? "border-gold bg-gold/5" : "border-line bg-surface hover:border-gold/50",
              )}
            >
              {pending ? (
                <Loader2 className="mb-3 h-6 w-6 animate-spin text-ink-muted" />
              ) : (
                <Upload className="mb-3 h-6 w-6 text-ink-faint" strokeWidth={1.5} />
              )}
              <div className="text-sm text-ink">
                {pending ? "Reading the file…" : "Drop a spreadsheet here, or click to choose"}
              </div>
              <div className="mt-1 text-2xs text-ink-faint">
                .xlsx, .xlsm, .csv or .tsv — up to 15MB. Legacy .xls must be re-saved as .xlsx first.
              </div>
              <input ref={inputRef} type="file" className="hidden"
                accept=".xlsx,.xlsm,.csv,.tsv,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            </div>
          </CardBody>
        </Card>
      )}

      {/* ---- Mapping + preview ----------------------------------------- */}
      {preview && (
        <>
          <Card>
            <CardHeader
              eyebrow="Step 2"
              title="Confirm the column mapping"
              action={
                <button onClick={() => { setPreview(null); setError(null); }}
                  className="text-2xs text-ink-faint hover:text-ink">Choose a different file</button>
              }
            />
            <CardBody>
              <div className="mb-4 flex flex-wrap items-center gap-3 text-2xs text-ink-muted">
                <span className="inline-flex items-center gap-1.5 text-ink">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> {preview.fileName}
                </span>
                <span>·</span>
                <span className="tabular">{preview.totalRows} rows</span>
                {preview.skippedLeadingRows > 0 && (
                  <>
                    <span>·</span>
                    <span>
                      header found on row {preview.skippedLeadingRows + 1};{" "}
                      {preview.skippedLeadingRows} title row
                      {preview.skippedLeadingRows === 1 ? "" : "s"} skipped
                    </span>
                  </>
                )}
                <span>·</span>
                <span className="tabular">{preview.summary.mapped} mapped</span>
                {preview.summary.needsConfirmation > 0 && (
                  <Badge tone="caution">{preview.summary.needsConfirmation} need confirming</Badge>
                )}
                {preview.summary.unmapped > 0 && (
                  <Badge tone="muted">{preview.summary.unmapped} kept, not mapped</Badge>
                )}
              </div>

              {preview.warnings.length > 0 && (
                <div className="mb-4 space-y-1 rounded border border-caution/30 bg-caution/5 px-3 py-2 text-2xs text-caution">
                  {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}

              {preview.summary.missingImportant.length > 0 && (
                <div className="mb-4 flex items-start gap-2 rounded border border-line bg-surface px-3 py-2 text-2xs text-ink-muted">
                  <Info className="mt-px h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  <span>
                    This file supplies no{" "}
                    <strong className="font-medium text-ink">
                      {preview.summary.missingImportant.map((f) => FIELD_BY_KEY[f].label).join(", ")}
                    </strong>
                    . Those fields stay empty — they are never inferred.
                  </span>
                </div>
              )}

              <div className="overflow-hidden rounded border border-line">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-surface-sunken">
                    <tr className="border-b border-line text-left">
                      <th className="eyebrow px-3 py-2 font-medium">Column in file</th>
                      <th className="eyebrow px-3 py-2 font-medium">Sample value</th>
                      <th className="eyebrow px-3 py-2 font-medium">Maps to</th>
                      <th className="eyebrow px-3 py-2 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.mappings.map((m) => {
                      const sample = preview.sampleRows.find(
                        (r) => r.cells[m.index] != null && String(r.cells[m.index]).trim() !== "");
                      const value = chosen[m.header] ?? "";
                      return (
                        <tr key={`${m.header}-${m.index}`} className="border-b border-line/60">
                          <td className="px-3 py-2 font-medium text-ink">{m.header}</td>
                          <td className="max-w-48 truncate px-3 py-2 text-ink-faint">
                            {sample ? String(sample.cells[m.index]) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={value}
                              onChange={(e) =>
                                setChosen((prev) => ({ ...prev, [m.header]: e.target.value || null }))}
                              className={cn(SELECT, "w-56",
                                !value && "text-ink-faint",
                                m.method === "ambiguous" && value && "border-caution/50")}
                            >
                              <option value="">Keep, do not map</option>
                              {FIELDS.map((f) => (
                                <option key={f.key} value={f.key}
                                  disabled={claimed.has(f.key) && chosen[m.header] !== f.key}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-2xs text-ink-muted">
                            {m.reason ?? (m.method === "exact" ? <Check className="h-3 w-3 text-positive" /> : null)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          {/* ---- Preview of what will actually import ------------------- */}
          <Card>
            <CardHeader eyebrow="Step 3" title="Preview"
              action={<span className="text-2xs text-ink-faint">
                First {preview.sampleRows.length} of {preview.totalRows} rows
              </span>} />
            <CardBody className="p-0">
              <div className="overflow-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-surface-sunken">
                    <tr className="border-b border-line text-left">
                      <th className="eyebrow px-3 py-2 font-medium">Property</th>
                      <th className="eyebrow px-3 py-2 font-medium">Location</th>
                      <th className="eyebrow px-3 py-2 text-right font-medium">Price</th>
                      <th className="eyebrow px-3 py-2 text-right font-medium">Income</th>
                      <th className="eyebrow px-3 py-2 text-right font-medium">Yield</th>
                      <th className="eyebrow px-3 py-2 font-medium">Broker</th>
                      <th className="eyebrow px-3 py-2 font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, i) => {
                      const errors = row.issues.filter((x) => x.severity === "error");
                      return (
                        <tr key={i} className={cn("border-b border-line/60",
                          errors.length > 0 && "bg-negative/[0.04]")}>
                          <td className="px-3 py-2 text-ink">{val(row.values, "property_name")}</td>
                          <td className="max-w-56 truncate px-3 py-2 text-ink-muted">
                            {val(row.values, "address")}
                          </td>
                          <td className="tabular px-3 py-2 text-right">{money(row.values, "asking_price")}</td>
                          <td className="tabular px-3 py-2 text-right">{money(row.values, "passing_income")}</td>
                          <td className="tabular px-3 py-2 text-right">{pct(row.values, "niy")}</td>
                          <td className="px-3 py-2 text-ink-muted">{val(row.values, "broker")}</td>
                          <td className="px-3 py-2">
                            {errors.length > 0 && (
                              <span className="text-2xs text-negative" title={errors.map((e) => e.message).join("\n")}>
                                {errors[0].message}
                              </span>
                            )}
                            {errors.length === 0 && !row.identityKey && (
                              <span className="text-2xs text-caution">No address — will need review</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          {/* ---- Commit ------------------------------------------------- */}
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Save this mapping as a template (optional)"
              className={cn(SELECT, "w-80")} />
            <button
              onClick={confirm}
              disabled={pending || !orgId}
              className="ml-auto inline-flex items-center gap-2 rounded bg-navy px-4 py-2 text-xs font-medium text-surface hover:bg-navy-50 disabled:opacity-60">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Import {preview.totalRows} rows to the Deal Inbox
            </button>
          </div>
          <p className="text-2xs text-ink-faint">
            Importing stages these rows for review. Nothing becomes an opportunity until you approve it,
            and every column — mapped or not — is kept against the source row.
          </p>
        </>
      )}
    </div>
  );
}

const SELECT =
  "w-full rounded border border-line bg-surface-card px-2.5 py-1.5 text-xs text-ink focus:border-gold/50 focus:outline-none";

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="eyebrow mb-1 block">{label}</label>
      {children}
      {hint && <p className="mt-1 text-2xs text-ink-faint">{hint}</p>}
    </div>
  );
}

type Values = Record<string, { value: unknown; confidence: number | null; notes: string[] }>;
const val = (v: Values, key: string) =>
  v[key]?.value == null ? <span className="text-ink-faint">—</span> : String(v[key].value);
const money = (v: Values, key: string) => {
  const raw = v[key]?.value;
  if (raw == null) return "—";
  const n = Number(raw);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}m`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString("en-GB");
};
const pct = (v: Values, key: string) =>
  v[key]?.value == null ? "—" : `${Number(v[key].value).toFixed(2)}%`;
