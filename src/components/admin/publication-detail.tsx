"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  ChevronLeft, AlertTriangle, Loader2, Send, Undo2, CheckCircle2, FilePlus2,
  Archive, Plus, X, Trash2, Pencil, Lock, RefreshCw,
} from "lucide-react";
import type {
  Publication, PublicationVersion, PublicationDocument, InvestorOrganization,
} from "@/lib/data/investor-portal";
import type {
  PublicationSourcePanel, VersionDrift, PublicationEntitlementRow, WorkflowState,
} from "@/lib/data/admin-portal";
import {
  submitForReviewAction, returnToDraftAction, publishVersionAction, withdrawPublicationAction,
  startDraftFromVersionAction, startDraftFromSourceAction, updateDraftVersionAction,
  addDocumentAction, updateDocumentAction, removeDocumentAction,
  grantAccessAction, setEntitlementVisibilityAction, revokeEntitlementAction,
  setEntitlementPlacementAction, setEntitlementAccessAction,
} from "@/app/actions/admin-portal";
import {
  WORKFLOW_LABEL, WORKFLOW_TONE, VERSION_STATUS_LABEL, VERSION_STATUS_TONE,
  DOC_CATEGORY_LABEL, DOC_LEVEL_LABEL, DOC_LEVEL_TONE, PLACEMENT_LABEL,
  INVESTOR_ORG_STATUS_LABEL, INVESTOR_ORG_STATUS_TONE,
} from "@/lib/portal-labels";
import { UPLOAD_ACCEPT } from "@/lib/documents/constraints";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { formatDate, formatMoneyCompact, formatPct, formatMultiple, formatArea } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AssetType, Strategy, Currency } from "@/types/database";

export function PublicationDetail({
  publication, versions, working, active, workingDocuments, activeDocuments,
  source, drift, entitlements, investorOrgs,
}: {
  publication: Publication;
  versions: PublicationVersion[];
  working: PublicationVersion | null;
  active: PublicationVersion | null;
  workingDocuments: PublicationDocument[];
  activeDocuments: PublicationDocument[];
  source: PublicationSourcePanel | null;
  drift: VersionDrift[];
  entitlements: PublicationEntitlementRow[];
  investorOrgs: InvestorOrganization[];
}) {
  const [pending, start] = useTransition();
  const id = publication.publicationId;

  const driftMap = useMemo(() => new Map(drift.map((d) => [d.versionId, d])), [drift]);
  const display = working ?? active ?? versions[0] ?? null;
  const displayDrift = display ? driftMap.get(display.versionId) : undefined;
  const state: WorkflowState = working?.status === "in_review" ? "in_review" : publication.status;

  return (
    <div className="min-h-full">
      {/* ---- Header: this is the INVESTOR side of the boundary ---- */}
      <div className="border-b border-line bg-surface-card px-8 py-6 text-ink">
        <Link href="/admin/publications"
          className="mb-2 inline-flex items-center gap-1 text-2xs text-ink-faint hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Publications
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow mb-1">Investor Publication</div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl">{display?.title ?? "Untitled publication"}</h1>
              <Badge tone={WORKFLOW_TONE[state]} dot>{WORKFLOW_LABEL[state]}</Badge>
              {active && (
                <span className="text-2xs text-ink-faint">
                  Live: v{active.versionNumber}{working ? ` · Editing: v${working.versionNumber}` : ""}
                </span>
              )}
              {!active && working && (
                <span className="text-2xs text-ink-faint">Working on v{working.versionNumber} — nothing live yet</span>
              )}
            </div>
            <p className="mt-1.5 max-w-2xl text-xs text-ink-faint">
              An independent snapshot prepared for investors. It never mirrors the internal
              opportunity — content moves only when a new version is drafted, reviewed and published.
            </p>
          </div>

          {/* Workflow actions */}
          <div className="flex flex-wrap items-center gap-2">
            {pending && <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />}
            {working?.status === "draft" && (
              <HeaderBtn primary disabled={pending}
                onClick={() => start(() => submitForReviewAction(working.versionId, id))}>
                <Send className="h-3.5 w-3.5" /> Submit for Review
              </HeaderBtn>
            )}
            {working?.status === "in_review" && (
              <>
                <HeaderBtn primary disabled={pending}
                  onClick={() => start(() => publishVersionAction(working.versionId, id))}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {active ? `Publish v${working.versionNumber} (replaces v${active.versionNumber})` : "Publish"}
                </HeaderBtn>
                <HeaderBtn disabled={pending}
                  onClick={() => start(() => returnToDraftAction(working.versionId, id))}>
                  <Undo2 className="h-3.5 w-3.5" /> Return to Draft
                </HeaderBtn>
              </>
            )}
            {!working && active && (
              <>
                <HeaderBtn primary disabled={pending}
                  onClick={() => start(() => startDraftFromVersionAction(active.versionId, id))}>
                  <FilePlus2 className="h-3.5 w-3.5" /> New Draft (edit)
                </HeaderBtn>
                <HeaderBtn disabled={pending} danger
                  onClick={() => start(() => withdrawPublicationAction(id))}>
                  <Archive className="h-3.5 w-3.5" /> Withdraw
                </HeaderBtn>
              </>
            )}
            {!working && !active && versions[0] && publication.status === "withdrawn" && (
              <HeaderBtn primary disabled={pending}
                onClick={() => start(() => startDraftFromVersionAction(versions[0].versionId, id))}>
                <FilePlus2 className="h-3.5 w-3.5" /> New Draft from v{versions[0].versionNumber}
              </HeaderBtn>
            )}
          </div>
        </div>
      </div>

      {/* ---- Source drift warning ---- */}
      {displayDrift?.changed && (
        <div className="flex items-start gap-2.5 border-b border-caution/30 bg-caution/10 px-8 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-caution" />
          <div className="text-xs text-ink">
            <span className="font-semibold">Internal opportunity has changed since this publication
            version was created.</span>{" "}
            <span className="text-ink-muted">
              The publication is never refreshed automatically — review the Source tab and, if the
              changes should reach investors, start a new draft from the internal data.
            </span>
          </div>
        </div>
      )}

      <Tabs defaultValue="publication">
        <TabsList>
          <TabsTrigger value="publication">Publication</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="access">Investor Access</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        {/* ================= Publication ================= */}
        <TabsContent value="publication" className="px-8 py-6">
          {!display ? (
            <EmptyState text="This publication has no versions yet." />
          ) : working?.status === "draft" ? (
            <DraftEditor version={working} publicationId={id} />
          ) : (
            <div className="space-y-6">
              {working?.status === "in_review" && (
                <div className="flex items-center gap-2 rounded-lg border border-caution/30 bg-caution/5 px-4 py-3 text-xs text-ink">
                  <Lock className="h-3.5 w-3.5 text-caution" />
                  Version {working.versionNumber} is in review — content is frozen until it is
                  published or returned to draft.
                </div>
              )}
              {!working && (
                <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-card px-4 py-3 text-xs text-ink-muted">
                  <Lock className="h-3.5 w-3.5 text-ink-faint" />
                  {publication.status === "published"
                    ? `Version ${display.versionNumber} is published and immutable. Editing creates a new draft version; investors keep seeing v${display.versionNumber} until the new version is published.`
                    : "This publication is withdrawn — investors see nothing. Start a new draft to re-publish."}
                </div>
              )}
              <VersionContent version={display} />
            </div>
          )}
        </TabsContent>

        {/* ================= Source ================= */}
        <TabsContent value="source" className="px-8 py-6">
          <SourceTab publicationId={id} source={source} display={display}
            displayDrift={displayDrift} working={working} pending={pending} start={start} />
        </TabsContent>

        {/* ================= Documents ================= */}
        <TabsContent value="documents" className="px-8 py-6">
          <div className="space-y-6">
            {working && (
              <DocumentsCard
                title={`Version ${working.versionNumber} (${VERSION_STATUS_LABEL[working.status]})`}
                documents={workingDocuments}
                editable={working.status === "draft"}
                versionId={working.versionId}
                publicationId={id}
                note={working.status === "draft"
                  ? "Documents are part of this version's snapshot — attach them before publishing."
                  : "Content is frozen while in review."}
              />
            )}
            {active && active.versionId !== working?.versionId && (
              <DocumentsCard
                title={`Version ${active.versionNumber} (Live)`}
                documents={activeDocuments}
                editable={false}
                versionId={active.versionId}
                publicationId={id}
                note="Published documents are an immutable part of the live snapshot."
              />
            )}
            {!working && !active && (
              <EmptyState text="No version to attach documents to." />
            )}
            <p className="text-2xs text-ink-faint">
              File storage is not wired in this phase: entries reserve a private storage path and
              carry the metadata investors will see. Uploads and signed downloads arrive with the
              investor-facing portal build.
            </p>
          </div>
        </TabsContent>

        {/* ================= Investor Access ================= */}
        <TabsContent value="access" className="px-8 py-6">
          <AccessTab publicationId={id} entitlements={entitlements}
            investorOrgs={investorOrgs} live={publication.status === "published"}
            pending={pending} start={start} />
        </TabsContent>

        {/* ================= Versions ================= */}
        <TabsContent value="versions" className="px-8 py-6">
          <VersionsTab publication={publication} versions={versions} driftMap={driftMap}
            working={working} pending={pending} start={start} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Draft editor
// ============================================================================
function DraftEditor({ version, publicationId }: { version: PublicationVersion; publicationId: string }) {
  return (
    <form action={updateDraftVersionAction.bind(null, version.versionId, publicationId)}
      className="mx-auto max-w-4xl space-y-6">
      <Card>
        <CardHeader eyebrow={`Draft — version ${version.versionNumber}`} title="Positioning" />
        <CardBody className="space-y-4">
          <Field label="Title" name="title" defaultValue={version.title} required />
          <Field label="Headline" name="headline" defaultValue={version.headline ?? ""}
            placeholder="One line that positions the opportunity" />
          <label className="block">
            <span className="eyebrow">Overview</span>
            <textarea name="overview" rows={5} defaultValue={version.overview ?? ""}
              className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30" />
          </label>
          <label className="block">
            <span className="eyebrow">Highlights — one per line</span>
            <textarea name="highlights" rows={3} defaultValue={version.highlights.join("\n")}
              className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30" />
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader eyebrow="Draft" title="Location & Profile" />
        <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Market" name="market" defaultValue={version.market ?? ""} />
          <Field label="Submarket" name="submarket" defaultValue={version.submarket ?? ""} />
          <Field label="City" name="city" defaultValue={version.city ?? ""} />
          <Field label="Country" name="country" defaultValue={version.country ?? ""} />
          <Field label="Asset type" name="assetType" defaultValue={version.assetType ?? ""} />
          <Field label="Strategy" name="strategy" defaultValue={version.strategy ?? ""} />
          <Field label="Currency" name="currency" defaultValue={version.currency} />
          <Field label="Hold period (yrs)" name="holdPeriodYears" type="number" step="0.5"
            defaultValue={version.holdPeriodYears ?? ""} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader eyebrow="Draft" title="Headline Figures" />
        <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field label="Headline price" name="headlinePrice" type="number"
            defaultValue={version.headlinePrice ?? ""} />
          <Field label="Target NIY %" name="targetNiy" type="number" step="0.01"
            defaultValue={version.targetNiy ?? ""} />
          <Field label="Target IRR %" name="targetIrr" type="number" step="0.1"
            defaultValue={version.targetIrr ?? ""} />
          <Field label="Equity multiple" name="targetEquityMultiple" type="number" step="0.01"
            defaultValue={version.targetEquityMultiple ?? ""} />
          <Field label="Size (sq ft)" name="sizeSqft" type="number" defaultValue={version.sizeSqft ?? ""} />
          <Field label="Size (sq m)" name="sizeSqm" type="number" defaultValue={version.sizeSqm ?? ""} />
        </CardBody>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-2xs text-ink-faint">
          Investors never see drafts — this version goes live only when it is reviewed and published.
        </span>
        <button type="submit"
          className="rounded bg-purple px-4 py-2 text-xs font-semibold text-ink hover:bg-purple-70">
          Save Draft
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Read-only investor content (what a portal user would see)
// ============================================================================
function VersionContent({ version: v }: { version: PublicationVersion }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <CardHeader eyebrow={`Version ${v.versionNumber} — investor view`} title={v.title}
          action={<Badge tone={VERSION_STATUS_TONE[v.status]} dot>{VERSION_STATUS_LABEL[v.status]}</Badge>} />
        <CardBody className="space-y-4">
          {v.headline && <p className="text-lg text-ink">{v.headline}</p>}
          <div className="text-sm text-ink-muted">
            {[v.city ?? v.market,
              v.assetType ? (ASSET_TYPE_LABEL[v.assetType as AssetType] ?? v.assetType) : null,
              v.strategy ? (STRATEGY_LABEL[v.strategy as Strategy] ?? v.strategy) : null,
            ].filter(Boolean).join(" · ")}
          </div>
          {v.overview && <p className="text-sm leading-relaxed text-ink/90">{v.overview}</p>}
          {v.highlights.length > 0 && (
            <ul className="space-y-1.5">
              {v.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink/90">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-purple" /> {h}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader eyebrow="Investor view" title="Headline Figures" />
        <CardBody className="p-0">
          <dl className="grid grid-cols-2 divide-x divide-y divide-line md:grid-cols-4">
            <Figure k="Headline price" v={formatMoneyCompact(v.headlinePrice, v.currency as Currency)} />
            <Figure k="Target NIY" v={formatPct(v.targetNiy, 1)} />
            <Figure k="Target IRR" v={formatPct(v.targetIrr, 1)} />
            <Figure k="Equity multiple" v={formatMultiple(v.targetEquityMultiple)} />
            <Figure k="Hold period" v={v.holdPeriodYears != null ? `${v.holdPeriodYears} yrs` : "—"} />
            <Figure k="Size" v={v.sizeSqft != null ? formatArea(v.sizeSqft, "sqft") : formatArea(v.sizeSqm, "sqm")} />
            <Figure k="Published" v={formatDate(v.publishedAt)} />
            <Figure k="Currency" v={v.currency} />
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

// ============================================================================
// Source tab — the admin-only side of the boundary
// ============================================================================
function SourceTab({
  publicationId, source, display, displayDrift, working, pending, start,
}: {
  publicationId: string;
  source: PublicationSourcePanel | null;
  display: PublicationVersion | null;
  displayDrift: VersionDrift | undefined;
  working: PublicationVersion | null;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
}) {
  if (!source) return <EmptyState text="No internal opportunity is linked to this publication." />;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <CardHeader eyebrow="Admin only" title="Internal Source"
          action={<Badge tone="muted">Never shown to investors</Badge>} />
        <CardBody className="p-0">
          <dl className="divide-y divide-line">
            <SourceRow k="Internal opportunity"
              v={
                <Link href={`/opportunities/${source.opportunityId}`}
                  className="text-sm font-medium text-ink-muted hover:underline">
                  {source.opportunityName ?? "View opportunity"}
                </Link>
              } />
            <SourceRow k="Internal stage / status"
              v={<span className="text-sm text-ink">{[source.opportunityStage, source.opportunityStatus].filter(Boolean).join(" · ") || "—"}</span>} />
            <SourceRow k="Linked" v={<span className="tabular text-sm text-ink">{formatDate(source.linkedAt)}</span>} />
            <SourceRow k={`Snapshot captured (v${display?.versionNumber ?? "—"})`}
              v={<span className="tabular text-sm text-ink">{formatDate(displayDrift?.capturedAt ?? null)}</span>} />
            <SourceRow k="Source fingerprint"
              v={displayDrift?.changed
                ? <span className="flex items-center gap-1.5 text-sm font-medium text-caution">
                    <AlertTriangle className="h-3.5 w-3.5" /> Internal opportunity has changed since this version was created
                  </span>
                : <span className="text-sm text-positive">Matches the current internal data</span>} />
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader eyebrow="Boundary" title="Refreshing From the Source" />
        <CardBody className="space-y-3">
          <p className="text-xs leading-relaxed text-ink-muted">
            The publication was prefilled once, through the approved field whitelist — confidential
            internal fields (counterparties, probability, internal economics) never carry over.
            After that it is an independent record: <span className="font-medium text-ink">editing
            the internal opportunity never changes what investors see.</span> Bringing fresh internal
            data across is always an explicit step that creates a new draft for review.
          </p>
          {working ? (
            <p className="text-2xs text-ink-faint">
              Finish or discard the open v{working.versionNumber} {VERSION_STATUS_LABEL[working.status].toLowerCase()} first —
              refreshing starts a new draft, and this publication already has one open.
            </p>
          ) : (
            <button disabled={pending}
              onClick={() => start(() => startDraftFromSourceAction(publicationId))}
              className="flex items-center gap-1.5 rounded border border-line px-3.5 py-2 text-xs font-medium text-ink-muted hover:border-line hover:text-ink disabled:opacity-60">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Start New Draft From Current Internal Data
            </button>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ============================================================================
// Documents
// ============================================================================
function DocumentsCard({
  title, documents, editable, versionId, publicationId, note,
}: {
  title: string;
  documents: PublicationDocument[];
  editable: boolean;
  versionId: string;
  publicationId: string;
  note: string;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader eyebrow="Documents" title={title}
        action={editable ? (
          <button onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 rounded border border-line px-2.5 py-1.5 text-2xs font-medium text-ink-muted hover:border-line hover:text-ink">
            {adding ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {adding ? "Cancel" : "Add document"}
          </button>
        ) : <Lock className="h-3.5 w-3.5 text-ink-faint" />} />
      <CardBody className="p-0">
        {adding && editable && (
          <form action={async (fd) => {
            const result = await addDocumentAction(versionId, publicationId, {}, fd);
            setUploadError(result.error ?? null);
            if (result.ok) setAdding(false);
          }} className="grid grid-cols-1 gap-3 border-b border-line bg-surface-sunken/50 px-5 py-4 md:grid-cols-4">
            <label className="block md:col-span-2">
              <span className="eyebrow">Title</span>
              <input name="title" required
                className="mt-1 h-8 w-full rounded border border-line bg-surface-card px-2.5 text-xs text-ink focus:border-line-strong focus:outline-none" />
            </label>
            <DocSelects />
            <label className="block md:col-span-3">
              <span className="eyebrow">File</span>
              <input name="file" type="file" required accept={UPLOAD_ACCEPT}
                className="mt-1 block w-full rounded border border-line bg-surface-card px-2.5 py-1.5 text-xs text-ink file:mr-3 file:rounded file:border-0 file:bg-purple file:px-2.5 file:py-1 file:text-2xs file:font-semibold file:text-ink focus:border-line-strong focus:outline-none" />
            </label>
            <div className="flex items-end justify-end">
              <button type="submit" className="rounded bg-purple px-3.5 py-2 text-2xs font-semibold text-ink hover:bg-purple-70">
                Upload Document
              </button>
            </div>
            {uploadError && (
              <p role="alert" className="md:col-span-4 flex items-center gap-1.5 text-2xs text-negative">
                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> {uploadError}
              </p>
            )}
            <p className="md:col-span-4 text-2xs text-ink-faint">
              Stored privately at a server-generated path. Investors receive a short-lived signed
              link, never the file&rsquo;s location.
            </p>
          </form>
        )}
        {documents.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-ink-faint">
            {editable ? "No documents attached to this version yet." : "This version has no documents."}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {documents.map((d) => (
              <li key={d.documentId} className="px-5 py-3">
                {editingId === d.documentId && editable ? (
                  <form action={async (fd) => {
                    await updateDocumentAction(d.documentId, publicationId, fd);
                    setEditingId(null);
                  }} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <label className="block md:col-span-2">
                      <span className="eyebrow">Title</span>
                      <input name="title" required defaultValue={d.title}
                        className="mt-1 h-8 w-full rounded border border-line bg-surface-card px-2.5 text-xs text-ink focus:border-line-strong focus:outline-none" />
                    </label>
                    <DocSelects category={d.category} accessLevel={d.accessLevel} />
                    <div className="flex items-end justify-end gap-2 md:col-span-4">
                      <button type="button" onClick={() => setEditingId(null)}
                        className="text-2xs text-ink-faint hover:text-ink">Cancel</button>
                      <button type="submit" className="rounded bg-purple px-3 py-1.5 text-2xs font-semibold text-ink">Save</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{d.title}</span>
                        <Badge tone="neutral">{DOC_CATEGORY_LABEL[d.category]}</Badge>
                        <Badge tone={DOC_LEVEL_TONE[d.accessLevel]}>
                          {DOC_LEVEL_LABEL[d.accessLevel]}
                          {d.accessLevel === "internal" && " — never investor-visible"}
                        </Badge>
                      </div>
                      {/* The object path is never rendered — not even for staff. */}
                      <div className="mt-0.5 truncate text-2xs text-ink-faint">
                        {d.fileName ?? "Stored document"}
                        {d.sizeBytes != null && ` · ${Math.max(1, Math.round(d.sizeBytes / 1024))} KB`}
                      </div>
                    </div>
                    {editable && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => setEditingId(d.documentId)}
                          className="rounded border border-line p-1.5 text-ink-muted hover:border-line hover:text-ink">
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button disabled={pending}
                          onClick={() => start(() => removeDocumentAction(d.documentId, publicationId))}
                          className="rounded border border-line p-1.5 text-ink-muted hover:border-negative/40 hover:text-negative disabled:opacity-50">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line px-5 py-2.5 text-2xs text-ink-faint">{note}</div>
      </CardBody>
    </Card>
  );
}

function DocSelects({ category, accessLevel }: { category?: string; accessLevel?: string }) {
  return (
    <>
      <label className="block">
        <span className="eyebrow">Category</span>
        <select name="category" defaultValue={category ?? "other"}
          className="mt-1 h-8 w-full rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none">
          {Object.entries(DOC_CATEGORY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="eyebrow">Access tier</span>
        <select name="accessLevel" defaultValue={accessLevel ?? "standard"}
          className="mt-1 h-8 w-full rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none">
          <option value="standard">Standard</option>
          <option value="diligence">Diligence</option>
          <option value="internal">Internal (never investor-visible)</option>
        </select>
      </label>
    </>
  );
}

// ============================================================================
// Investor access
// ============================================================================
function AccessTab({
  publicationId, entitlements, investorOrgs, live, pending, start,
}: {
  publicationId: string;
  entitlements: PublicationEntitlementRow[];
  investorOrgs: InvestorOrganization[];
  live: boolean;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
}) {
  const [granting, setGranting] = useState(false);
  const entitledIds = new Set(entitlements.map((e) => e.investorOrgId));
  const grantable = investorOrgs.filter((o) => !entitledIds.has(o.investorOrgId));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {!live && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-card px-4 py-3 text-xs text-ink-muted">
          <AlertTriangle className="h-3.5 w-3.5 text-ink-faint" />
          This publication is not live — entitlements can be prepared now, but investors see nothing
          until a version is published.
        </div>
      )}
      <Card>
        <CardHeader eyebrow="Entitlements" title="Investor Organisations"
          action={grantable.length > 0 ? (
            <button onClick={() => setGranting((v) => !v)}
              className="flex items-center gap-1 rounded border border-line px-2.5 py-1.5 text-2xs font-medium text-ink-muted hover:border-line hover:text-ink">
              {granting ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {granting ? "Cancel" : "Grant access"}
            </button>
          ) : undefined} />
        <CardBody className="p-0">
          {granting && (
            <form action={async (fd) => {
              await grantAccessAction(publicationId, fd);
              setGranting(false);
            }} className="grid grid-cols-1 gap-3 border-b border-line bg-surface-sunken/50 px-5 py-4 md:grid-cols-4">
              <label className="block md:col-span-2">
                <span className="eyebrow">Investor organisation</span>
                <select name="investorOrgId" required defaultValue=""
                  className="mt-1 h-8 w-full rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none">
                  <option value="" disabled>Choose an organisation…</option>
                  {grantable.map((o) => (
                    <option key={o.investorOrgId} value={o.investorOrgId}>{o.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="eyebrow">Placement</span>
                <select name="placement" defaultValue="secondary"
                  className="mt-1 h-8 w-full rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none">
                  <option value="secondary">Also Available</option>
                  <option value="featured">Featured (replaces current)</option>
                </select>
              </label>
              <label className="block">
                <span className="eyebrow">Document access</span>
                <select name="documentAccessLevel" defaultValue="standard"
                  className="mt-1 h-8 w-full rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-line-strong focus:outline-none">
                  <option value="standard">Standard</option>
                  <option value="diligence">Diligence</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-ink md:col-span-2">
                <input type="checkbox" name="isVisible" defaultChecked className="accent-purple" />
                Visible immediately
              </label>
              <div className="flex items-end justify-end md:col-span-2">
                <button type="submit" className="rounded bg-purple px-3.5 py-2 text-2xs font-semibold text-ink hover:bg-purple-70">
                  Grant Access
                </button>
              </div>
            </form>
          )}
          {entitlements.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-ink-faint">
              No investor organisation has access to this publication yet.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {entitlements.map((e) => (
                <li key={e.entitlementId} className={cn("flex flex-wrap items-center justify-between gap-3 px-5 py-3", !e.isVisible && "opacity-70")}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/investors/${e.investorOrgId}`}
                        className="text-sm font-medium text-ink hover:text-ink-muted">
                        {e.investorOrgName}
                      </Link>
                      <Badge tone={INVESTOR_ORG_STATUS_TONE[e.investorOrgStatus]}>
                        {INVESTOR_ORG_STATUS_LABEL[e.investorOrgStatus]}
                      </Badge>
                      {e.isVisible
                        ? <Badge tone={e.placement === "featured" ? "accent" : "neutral"} dot>{PLACEMENT_LABEL[e.placement]}</Badge>
                        : <Badge tone="muted" dot>Hidden</Badge>}
                      <Badge tone={e.documentAccessLevel === "diligence" ? "accent" : "neutral"}>
                        {e.documentAccessLevel === "diligence" ? "Diligence docs" : "Standard docs"}
                      </Badge>
                    </div>
                    {e.investorNote && (
                      <div className="mt-1 text-2xs italic text-ink-muted">“{e.investorNote}”</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {e.isVisible ? (
                      <>
                        <MiniBtn disabled={pending}
                          title={e.placement === "featured" ? undefined : "Replaces the organisation's current featured opportunity"}
                          onClick={() => start(() => setEntitlementPlacementAction(
                            e.entitlementId, e.investorOrgId,
                            e.placement === "featured" ? "secondary" : "featured"))}>
                          {e.placement === "featured" ? "Make secondary" : "Feature"}
                        </MiniBtn>
                        <MiniBtn disabled={pending}
                          onClick={() => start(() => setEntitlementAccessAction(
                            e.entitlementId, e.investorOrgId,
                            e.documentAccessLevel === "standard" ? "diligence" : "standard"))}>
                          {e.documentAccessLevel === "standard" ? "Grant diligence" : "Standard only"}
                        </MiniBtn>
                        <MiniBtn tone="negative" disabled={pending}
                          onClick={() => start(() => revokeEntitlementAction(e.entitlementId, e.investorOrgId))}>
                          Revoke
                        </MiniBtn>
                      </>
                    ) : (
                      <MiniBtn disabled={pending}
                        onClick={() => start(() => setEntitlementVisibilityAction(e.entitlementId, e.investorOrgId, true))}>
                        Restore (as Also Available)
                      </MiniBtn>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ============================================================================
// Version history
// ============================================================================
function VersionsTab({
  publication, versions, driftMap, working, pending, start,
}: {
  publication: Publication;
  versions: PublicationVersion[];
  driftMap: Map<string, VersionDrift>;
  working: PublicationVersion | null;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <Card>
        <CardHeader eyebrow="History" title="Versions"
          action={<span className="text-2xs text-ink-faint">Published versions are immutable; publishing a new one supersedes the old</span>} />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <Vth>Version</Vth>
                <Vth>Status</Vth>
                <Vth>Created</Vth>
                <Vth>Published</Vth>
                <Vth>Superseded</Vth>
                <Vth>Source</Vth>
                <Vth className="text-right">Actions</Vth>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {versions.map((v) => {
                const d = driftMap.get(v.versionId);
                const isLive = publication.activeVersionId === v.versionId;
                return (
                  <tr key={v.versionId} className={cn(isLive && "bg-surface-sunken")}>
                    <td className="tabular px-5 py-3 font-medium text-ink">
                      v{v.versionNumber}{isLive && <span className="ml-1.5 text-2xs font-semibold text-ink-muted">LIVE</span>}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={VERSION_STATUS_TONE[v.status]} dot>{VERSION_STATUS_LABEL[v.status]}</Badge>
                    </td>
                    <td className="tabular px-5 py-3 text-2xs text-ink-muted">{formatDate(v.createdAt)}</td>
                    <td className="tabular px-5 py-3 text-2xs text-ink-muted">{formatDate(v.publishedAt)}</td>
                    <td className="tabular px-5 py-3 text-2xs text-ink-muted">{formatDate(v.supersededAt)}</td>
                    <td className="px-5 py-3">
                      {d?.changed
                        ? <span className="flex items-center gap-1 text-2xs font-medium text-caution"><AlertTriangle className="h-3 w-3" /> Changed</span>
                        : <span className="text-2xs text-ink-faint">In step</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {v.status === "draft" && (
                        <MiniBtn disabled={pending}
                          onClick={() => start(() => submitForReviewAction(v.versionId, publication.publicationId))}>
                          Submit for review
                        </MiniBtn>
                      )}
                      {v.status === "in_review" && (
                        <span className="inline-flex gap-1">
                          <MiniBtn disabled={pending}
                            onClick={() => start(() => publishVersionAction(v.versionId, publication.publicationId))}>
                            Publish
                          </MiniBtn>
                          <MiniBtn disabled={pending}
                            onClick={() => start(() => returnToDraftAction(v.versionId, publication.publicationId))}>
                            Return to draft
                          </MiniBtn>
                        </span>
                      )}
                      {(v.status === "published" || v.status === "superseded") && !working && (
                        <MiniBtn disabled={pending}
                          onClick={() => start(() => startDraftFromVersionAction(v.versionId, publication.publicationId))}>
                          New draft from v{v.versionNumber}
                        </MiniBtn>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

// ---- Shared bits ------------------------------------------------------------
function HeaderBtn({
  children, onClick, disabled, primary, danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 rounded px-3.5 py-2 text-xs font-semibold transition-colors disabled:opacity-60",
        primary && "bg-purple text-ink hover:bg-surface-sunken",
        !primary && !danger && "border border-line text-ink-muted hover:bg-surface-sunken hover:text-ink",
        danger && "border border-negative/40 text-rose-200 hover:bg-negative/20",
      )}>
      {children}
    </button>
  );
}

function Field({
  label, name, defaultValue, type = "text", step, required, placeholder,
}: {
  label: string; name: string; defaultValue?: string | number;
  type?: string; step?: string; required?: boolean; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input name={name} type={type} step={step} required={required}
        defaultValue={defaultValue} placeholder={placeholder}
        className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30" />
    </label>
  );
}

function Figure({ k, v }: { k: string; v: string }) {
  return (
    <div className="px-5 py-3.5">
      <dt className="eyebrow">{k}</dt>
      <dd className="tabular mt-1 text-base text-ink">{v}</dd>
    </div>
  );
}

function SourceRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <dt className="text-2xs uppercase tracking-label text-ink-faint">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}

function Vth({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn("px-5 py-2.5 text-2xs font-medium uppercase tracking-label text-ink-faint", className)}>
      {children}
    </th>
  );
}

function MiniBtn({
  children, onClick, disabled, tone, title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "negative";
  title?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={cn(
        "rounded border border-line px-2 py-1 text-2xs font-medium text-ink-muted transition-colors disabled:opacity-50",
        tone === "negative" ? "hover:border-negative/40 hover:text-negative" : "hover:border-line hover:text-ink",
      )}>
      {children}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line py-16 text-center text-sm text-ink-muted">
      {text}
    </div>
  );
}
