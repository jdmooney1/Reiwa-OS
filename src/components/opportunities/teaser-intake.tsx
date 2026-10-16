"use client";

// ============================================================================
// New deal from a teaser: drop -> read -> review -> create.
// ----------------------------------------------------------------------------
// The browser's part is small on purpose: it sends the file straight to the
// private bucket on a URL the server minted, asks the server to read it, shows
// the reading for a person to correct, and sends the corrected reading back.
// Every rule (types, size, ownership of the file, the schema, the seed parser,
// the duplicate hold) is enforced on the server again; nothing here is a control.
// ============================================================================
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, AlertTriangle, ExternalLink, X } from "lucide-react";
import {
  prepareTeaserUploadAction, readTeaserAction, createDealFromTeaserAction, attachTeaserToDealAction,
  discardTeaserAction, type PossibleMatch,
} from "@/app/actions/teaser-intake";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ActionError } from "@/components/workspace/primitives";
import { useFileDrop, dropZoneClass } from "@/lib/ui/use-file-drop";
import { cn } from "@/lib/utils";
import { INTAKE_ACCEPT, MAX_INTAKE_BYTES, MAX_INTAKE_IMAGE_BYTES, declaredIntakeType, maxBytesFor, tooLargeMessage } from "@/lib/teaser-intake/files";
import {
  REVIEW_FIELDS, fieldPath, type ReviewField, type TeaserExtraction, type EvidenceItem,
} from "@/lib/teaser-intake/schema";

type Org = { orgId: string; name: string };
type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "reading"; fileName: string; path: string }
  | { kind: "review"; fileName: string; path: string };

const MB = 1024 * 1024;

export function TeaserIntake({ orgs }: { orgs: Org[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string>();
  const [extraction, setExtraction] = useState<TeaserExtraction | null>(null);
  const [readError, setReadError] = useState<string>();
  const [matches, setMatches] = useState<PossibleMatch[]>([]);
  const [held, setHeld] = useState<PossibleMatch[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [orgId, setOrgId] = useState(orgs[0]?.orgId ?? "");
  const [busy, setBusy] = useState<"create" | "attach" | null>(null);

  const reset = () => {
    setPhase({ kind: "idle" }); setError(undefined); setExtraction(null); setReadError(undefined);
    setMatches([]); setHeld(null); setProblems([]); setBusy(null);
    if (input.current) input.current.value = "";
  };

  async function start(file: File) {
    reset();
    const type = declaredIntakeType(file.name, file.type);
    if (!type) { setError("Drop a PDF, PNG or JPEG of the teaser."); return; }
    if (file.size > maxBytesFor(type)) { setError(tooLargeMessage(type)); return; }
    setPhase({ kind: "uploading", fileName: file.name });
    const prep = await prepareTeaserUploadAction(file.name, file.type, file.size).catch(() => ({ error: "The upload could not be prepared. Try again." }));
    if (prep.error || !("path" in prep) || !prep.path || !prep.signedUrl) { setError(prep.error ?? "The upload could not be prepared."); setPhase({ kind: "idle" }); return; }

    try {
      // Re-labelled with the type the server agreed to, so a PDF a mail client handed over with
      // no type is not refused by the bucket as application/octet-stream.
      const typed = new File([file], file.name, { type });
      const body = new FormData();
      body.append("cacheControl", "3600");
      body.append("", typed);
      const res = await fetch(prep.signedUrl, { method: "PUT", body, headers: { "x-upsert": "false" } });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setError("The file could not be uploaded. Check your connection and try again.");
      setPhase({ kind: "idle" });
      return;
    }

    setPhase({ kind: "reading", fileName: file.name, path: prep.path });
    const read = await readTeaserAction(prep.path).catch(() => ({ error: "The teaser could not be read. Try again." } as const));
    if ("error" in read && read.error) { setError(read.error); setPhase({ kind: "idle" }); void discardTeaserAction(prep.path).catch(() => undefined); return; }
    if (!("extraction" in read) || !read.extraction) { setError("The teaser could not be read."); setPhase({ kind: "idle" }); void discardTeaserAction(prep.path).catch(() => undefined); return; }
    setExtraction(read.extraction);
    setReadError(read.readError);
    setMatches(read.matches ?? []);
    setPhase({ kind: "review", fileName: file.name, path: prep.path });
  }

  const drop = useFileDrop((files) => { if (files[0]) void start(files[0]); }, { disabled: phase.kind !== "idle" });

  async function create(allowExisting: boolean) {
    if (phase.kind !== "review" || !extraction) return;
    setBusy("create"); setError(undefined); setProblems([]); setHeld(null);
    const r = await createDealFromTeaserAction({
      path: phase.path, fileName: phase.fileName, orgId, extraction, allowExisting,
    }).catch(() => ({ error: "The deal could not be created. Try again." }));
    setBusy(null);
    if (r.error) { setError(r.error); return; }
    if ("problems" in r && r.problems?.length) { setProblems(r.problems); return; }
    if ("held" in r && r.held) { setHeld(r.held); return; }
    if ("opportunityId" in r && r.opportunityId) router.push(`/opportunities/${r.opportunityId}`);
  }

  async function attach(opportunityId: string) {
    if (phase.kind !== "review") return;
    setBusy("attach"); setError(undefined);
    const r = await attachTeaserToDealAction(phase.path, phase.fileName, opportunityId)
      .catch(() => ({ error: "The teaser could not be filed. Try again." }));
    setBusy(null);
    if (r.error) { setError(r.error); return; }
    router.push(`/opportunities/${opportunityId}/documents`);
  }

  async function startAgain() {
    if (phase.kind === "review" || phase.kind === "reading") void discardTeaserAction(phase.path).catch(() => undefined);
    reset();
  }

  // ---- Drop zone ----
  if (phase.kind !== "review" || !extraction) {
    const working = phase.kind === "uploading" || phase.kind === "reading";
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <div {...drop.bind}
          className={cn("flex flex-col items-center justify-center rounded-lg px-6 py-14 text-center", dropZoneClass(drop.over))}>
          {working ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-purple" />
              <p className="mt-3 text-sm text-ink">{phase.kind === "uploading" ? "Uploading" : "Reading"} {phase.fileName}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {phase.kind === "reading" ? "Reading the teaser takes up to a minute or two for a long IM. Keep this page open." : "Sending the file to Reiwa's private store."}
              </p>
            </>
          ) : (
            <>
              <FileUp className="h-6 w-6 text-ink-faint" />
              <p className="mt-3 text-sm text-ink">Drop a teaser or IM here</p>
              <p className="mt-1 text-xs text-ink-muted">PDF up to {Math.round(MAX_INTAKE_BYTES / MB)} MB, or a PNG / JPEG up to {(MAX_INTAKE_IMAGE_BYTES / MB).toFixed(1)} MB</p>
              <button type="button" onClick={() => input.current?.click()}
                className="mt-4 rounded border border-line px-3 py-1.5 text-xs font-medium text-ink hover:border-line-strong">
                Choose a file
              </button>
              <input ref={input} type="file" accept={INTAKE_ACCEPT} className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void start(f); }} />
            </>
          )}
        </div>
        <ActionError message={error} />
        <p className="text-2xs leading-relaxed text-ink-faint">
          Only drop material Reiwa Capital received in its own right. The file is read by an AI model to pre-fill the form; you check every field before anything is saved.
        </p>
      </div>
    );
  }

  // ---- Review ----
  const ev = evidenceByField(extraction.evidence);
  const set = (f: ReviewField, v: unknown) => setExtraction((x) => x && ({ ...x, [f.section]: { ...x[f.section], [f.key]: v } }));
  const sections: { key: ReviewField["section"]; title: string }[] = [
    { key: "opportunity", title: "Deal" }, { key: "deal_terms", title: "Terms" }, { key: "asset_snapshot", title: "Building and income" },
  ];
  const notMaterial = !extraction.document.is_property_investment_material;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
        <span className="truncate">Read from <span className="text-ink">{phase.fileName}</span>. Check each field; empty means the teaser did not say.</span>
        <button type="button" onClick={startAgain} className="flex shrink-0 items-center gap-1 hover:text-ink"><X className="h-3.5 w-3.5" /> Start again</button>
      </div>

      {readError && <Banner tone="caution">{readError} Fill in the deal below by hand, and the file will still be filed on it.</Banner>}
      {notMaterial && <Banner tone="caution">This does not look like property investment material{extraction.document.note ? `: ${extraction.document.note}` : "."}</Banner>}
      {!notMaterial && extraction.document.note && <Banner tone="muted">{extraction.document.note}</Banner>}
      {matches.length > 0 && !held && (
        <Banner tone="caution">
          <div>Possibly already in the pipeline:</div>
          <MatchList matches={matches} onAttach={attach} busy={busy} />
        </Banner>
      )}

      <Card>
        <CardHeader eyebrow="Review" title={extraction.opportunity.name || "Untitled deal"} />
        <CardBody className="space-y-6">
          {orgs.length > 1 && (
            <label className="block max-w-sm">
              <span className="eyebrow">Organisation</span>
              <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={INPUT}>
                {orgs.map((o) => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
              </select>
            </label>
          )}
          {sections.map((s) => (
            <section key={s.key}>
              <h3 className="eyebrow mb-2">{s.title}</h3>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {REVIEW_FIELDS.filter((f) => f.section === s.key).map((f) => (
                  <Field key={fieldPath(f)} field={f} value={(extraction[f.section] as Record<string, unknown>)[f.key]}
                    evidence={ev.get(fieldPath(f))} onChange={(v) => set(f, v)} />
                ))}
              </div>
            </section>
          ))}

          <KeptFacts x={extraction} />
        </CardBody>
        <div className="space-y-3 border-t border-line px-5 py-3">
          {problems.length > 0 && (
            <div role="alert" className="border-l-2 border-negative pl-3 text-xs leading-relaxed text-negative">
              <div className="font-medium">Fix these before the deal can be created:</div>
              <ul className="mt-1 list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {held && (
            <Banner tone="caution">
              <div>Held: this looks like a deal already in the pipeline. Nothing was created.</div>
              <MatchList matches={held} onAttach={attach} busy={busy} />
              <button type="button" disabled={busy !== null} onClick={() => create(true)}
                className="mt-2 text-xs font-medium text-ink underline underline-offset-2 disabled:opacity-60">
                It is a different building: create it anyway
              </button>
            </Banner>
          )}
          <ActionError message={error} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-2xs text-ink-faint">Creates a draft at stage New, untriaged and unowned. The teaser is filed under Documents as internal.</p>
            <div className="flex items-center gap-2">
              <Link href="/pipeline" onClick={() => { void discardTeaserAction(phase.path).catch(() => undefined); }}
                className="rounded px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink">Cancel</Link>
              <button type="button" disabled={busy !== null || !orgId} onClick={() => create(false)}
                className="flex items-center gap-1.5 rounded bg-purple px-4 py-2 text-xs font-semibold text-surface hover:bg-purple-70 disabled:opacity-60">
                {busy === "create" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create Draft Deal
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

const INPUT = "mt-1 h-9 w-full rounded border border-line bg-surface-card px-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30";

function Field({ field, value, evidence, onChange }: {
  field: ReviewField; value: unknown; evidence?: EvidenceItem[]; onChange: (v: unknown) => void;
}) {
  const label = `${field.label}${field.unit ? ` (${field.unit})` : ""}${field.required ? " *" : ""}`;
  let control: React.ReactNode;
  if (field.kind === "enum") {
    control = (
      <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} className={INPUT}>
        <option value="">Not stated</option>
        {field.options!.map((o) => <option key={o} value={o}>{enumLabel(o)}</option>)}
      </select>
    );
  } else if (field.kind === "boolean") {
    control = (
      <select value={value === true ? "yes" : value === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "yes" ? true : e.target.value === "no" ? false : null)} className={INPUT}>
        <option value="">Not stated</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
    );
  } else if (field.kind === "number") {
    control = (
      <input type="number" step="any" min={0} value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => { const t = e.target.value.trim(); const n = Number(t); onChange(t === "" || !Number.isFinite(n) ? null : n); }}
        className={cn(INPUT, "tabular")} />
    );
  } else {
    control = <input type="text" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} className={INPUT} />;
  }
  const empty = value === null || value === undefined || value === "";
  return (
    <label className="block">
      <span className={cn("eyebrow", field.required && empty && "text-negative")}>{label}</span>
      {control}
      {evidence?.[0] && (
        <span className="mt-1 block truncate text-2xs text-ink-faint" title={evidence.map((e) => `${e.page ? `p.${e.page}: ` : ""}${e.quote}`).join("\n")}>
          {evidence[0].page ? `p.${evidence[0].page} ` : ""}“{evidence[0].quote}”
        </span>
      )}
    </label>
  );
}

function KeptFacts({ x }: { x: TeaserExtraction }) {
  if (!x.tenants.length && !x.highlights.length && !x.other_facts.length && !x.data_completeness) return null;
  return (
    <section className="space-y-3 border-t border-line pt-4">
      <h3 className="eyebrow">Also kept on the deal, as read</h3>
      {x.tenants.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-left text-ink-faint"><tr><th className="py-1 font-normal">Tenant</th><th className="font-normal">Area (sq ft)</th><th className="font-normal">Rent pa</th><th className="font-normal">Expiry</th><th className="font-normal">Break</th></tr></thead>
          <tbody className="text-ink">
            {x.tenants.map((t, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{t.name}</td><td className="tabular">{fmt(t.area_sq_ft)}</td><td className="tabular">{fmt(t.rent_pa)}</td>
                <td>{t.lease_expiry ?? "-"}</td><td>{t.break_option ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {x.highlights.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink">{x.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>}
      {x.other_facts.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {x.other_facts.map((f, i) => <div key={i} className="flex gap-2"><dt className="shrink-0 text-ink-faint">{f.label}</dt><dd className="text-ink">{f.value}</dd></div>)}
        </dl>
      )}
      {x.data_completeness && <p className="text-xs text-ink-muted">Not in the teaser: {x.data_completeness}</p>}
    </section>
  );
}

function MatchList({ matches, onAttach, busy }: { matches: PossibleMatch[]; onAttach: (id: string) => void; busy: string | null }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {matches.map((m) => (
        <li key={m.opportunityId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={`/opportunities/${m.opportunityId}`} target="_blank" className="flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline">
            {m.name}<ExternalLink className="h-3 w-3" />
          </Link>
          <span className="text-ink-faint">
            {[m.reference, m.brokerName, m.price !== null ? `${m.currency ?? ""} ${fmt(m.price)}`.trim() : null, m.why === "same_property" ? "same building" : "similar name"].filter(Boolean).join(" · ")}
          </span>
          <button type="button" disabled={busy !== null} onClick={() => onAttach(m.opportunityId)}
            className="text-xs font-medium text-purple hover:underline disabled:opacity-60">
            {busy === "attach" ? "Filing…" : "File the teaser on this deal instead"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Banner({ tone, children }: { tone: "caution" | "muted"; children: React.ReactNode }) {
  return (
    <div className={cn("flex gap-2 rounded border px-3 py-2 text-xs leading-relaxed",
      tone === "caution" ? "border-caution/40 bg-caution/5 text-ink" : "border-line text-ink-muted")}>
      {tone === "caution" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-caution" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function evidenceByField(items: EvidenceItem[]): Map<string, EvidenceItem[]> {
  const m = new Map<string, EvidenceItem[]>();
  for (const e of items) { const k = e.field.trim(); m.set(k, [...(m.get(k) ?? []), e]); }
  return m;
}

const fmt = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-GB"));
const enumLabel = (o: string) => o === "early_dialogue" ? "Early dialogue" : o === "under_offer" ? "Under offer"
  : o.length <= 3 ? o : o.charAt(0).toUpperCase() + o.slice(1).replace(/_/g, " ");
