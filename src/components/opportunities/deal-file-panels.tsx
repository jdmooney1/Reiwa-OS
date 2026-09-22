"use client";

import { useTransition } from "react";
import { FileText, Trash2, UserRound } from "lucide-react";
import type {
  DealContact, DealDocument, DecisionEntry, DecisionType,
} from "@/lib/data/deal-file-types";
import { DOC_CATEGORIES, DECISION_TYPES } from "@/lib/data/deal-file-types";
import {
  addContactAction, deleteContactAction,
  addDocumentAction, deleteDocumentAction,
  addDecisionAction,
} from "@/app/actions/deal-file";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

const DECISION_TYPE_LABEL: Record<DecisionType, string> = {
  screening: "Screening",
  investment_committee: "Investment Committee",
  bid: "Bid",
  exclusivity: "Exclusivity",
  legal: "Legal",
  completion: "Completion",
  abort: "Abort",
  other: "Other",
};

const field =
  "h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink " +
  "placeholder:text-ink-faint focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20";

const submit =
  "rounded bg-plum px-4 py-2 text-xs font-semibold text-surface transition-colors " +
  "hover:bg-plum-50 disabled:opacity-60";

function Label({ children }: { children: React.ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

function DeleteButton({ onDelete, label }: { onDelete: () => Promise<void>; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={label}
      disabled={pending}
      onClick={() => start(() => { void onDelete(); })}
      className="shrink-0 rounded p-1.5 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-flag disabled:opacity-50"
    >
      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-8 text-center text-sm text-ink-muted">{children}</div>;
}

// ---- Contacts --------------------------------------------------------------

export function ContactsPanel({
  opportunityId, contacts, canWrite,
}: {
  opportunityId: string;
  contacts: DealContact[];
  canWrite: boolean;
}) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader eyebrow="Counterparties" title={`${contacts.length} contact${contacts.length === 1 ? "" : "s"}`} />
        <CardBody className="p-0">
          {contacts.length === 0 ? (
            <Empty>No contacts recorded for this opportunity.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {contacts.map((c) => (
                <li key={c.contactId} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="flex min-w-0 gap-3">
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <div className="text-sm text-ink">{c.name}</div>
                      <div className="mt-0.5 text-2xs text-ink-muted">
                        {[c.role, c.company].filter(Boolean).join(" · ") || "—"}
                      </div>
                      {(c.email || c.phone) && (
                        <div className="mt-1 text-2xs text-ink-muted">
                          {[c.email, c.phone].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {c.notes && <p className="mt-1 text-xs text-ink-muted">{c.notes}</p>}
                    </div>
                  </div>
                  {canWrite && (
                    <DeleteButton
                      label={`Remove ${c.name}`}
                      onDelete={() => deleteContactAction(opportunityId, c.contactId)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader eyebrow="Add" title="New Contact" />
          <CardBody>
            <form action={addContactAction.bind(null, opportunityId)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block"><Label>Name</Label>
                  <input name="name" required className={`mt-1 ${field}`} /></label>
                <label className="block"><Label>Role</Label>
                  <input name="role" placeholder="Agent, vendor, solicitor…" className={`mt-1 ${field}`} /></label>
                <label className="block"><Label>Company</Label>
                  <input name="company" className={`mt-1 ${field}`} /></label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block"><Label>Email</Label>
                  <input name="email" type="email" className={`mt-1 ${field}`} /></label>
                <label className="block"><Label>Phone</Label>
                  <input name="phone" className={`mt-1 ${field}`} /></label>
              </div>
              <label className="block"><Label>Notes</Label>
                <input name="notes" className={`mt-1 ${field}`} /></label>
              <div className="flex justify-end">
                <button type="submit" className={submit}>Add contact</button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ---- Documents -------------------------------------------------------------

export function DocumentsPanel({
  opportunityId, documents, canWrite,
}: {
  opportunityId: string;
  documents: DealDocument[];
  canWrite: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-line bg-surface-sunken px-5 py-3 text-xs leading-relaxed text-ink-muted">
        This is a register of what Reiwa holds, not a file store. Uploading the
        document itself, and extracting data from it, arrives in a later phase —
        until then nothing here is read, parsed or inferred.
      </div>

      <Card>
        <CardHeader eyebrow="Deal file" title={`${documents.length} document${documents.length === 1 ? "" : "s"}`} />
        <CardBody className="p-0">
          {documents.length === 0 ? (
            <Empty>No documents recorded for this opportunity.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {documents.map((d) => (
                <li key={d.documentId} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="flex min-w-0 gap-3">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-ink">{d.fileName}</div>
                      <div className="mt-0.5 text-2xs text-ink-muted">
                        Recorded {formatDate(d.uploadedAt)}
                      </div>
                      {d.notes && <p className="mt-1 text-xs text-ink-muted">{d.notes}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="neutral">{d.category}</Badge>
                    {canWrite && (
                      <DeleteButton
                        label={`Remove ${d.fileName}`}
                        onDelete={() => deleteDocumentAction(opportunityId, d.documentId)}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader eyebrow="Add" title="Record a Document" />
          <CardBody>
            <form action={addDocumentAction.bind(null, opportunityId)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block"><Label>File name</Label>
                  <input name="fileName" required className={`mt-1 ${field}`} /></label>
                <label className="block"><Label>Category</Label>
                  <select name="category" defaultValue="Offering Memorandum" className={`mt-1 ${field}`}>
                    {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <label className="block"><Label>Notes</Label>
                <input name="notes" className={`mt-1 ${field}`} /></label>
              <div className="flex justify-end">
                <button type="submit" className={submit}>Record document</button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ---- Decision log ----------------------------------------------------------

export function DecisionLogPanel({
  opportunityId, decisions, canWrite,
}: {
  opportunityId: string;
  decisions: DecisionEntry[];
  canWrite: boolean;
}) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          eyebrow="Record"
          title={`${decisions.length} decision${decisions.length === 1 ? "" : "s"}`}
        />
        <CardBody className="p-0">
          {decisions.length === 0 ? (
            <Empty>No decisions recorded. Every material call on this opportunity belongs here.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {decisions.map((d) => (
                <li key={d.decisionId} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="emphasis">{DECISION_TYPE_LABEL[d.decisionType]}</Badge>
                    <span className="tabular text-2xs text-ink-muted">{formatDate(d.decisionDate)}</span>
                    {d.author && <span className="text-2xs text-ink-muted">· {d.author}</span>}
                  </div>
                  <div className="mt-2 text-sm text-ink">{d.decision}</div>
                  {d.rationale && (
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{d.rationale}</p>
                  )}
                  {d.nextSteps && (
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                      <span className="eyebrow mr-1.5">Next</span>{d.nextSteps}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader eyebrow="Add" title="Record a Decision" />
          <CardBody>
            <form action={addDecisionAction.bind(null, opportunityId)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block"><Label>Type</Label>
                  <select name="decisionType" defaultValue="screening" className={`mt-1 ${field}`}>
                    {DECISION_TYPES.map((t) => (
                      <option key={t} value={t}>{DECISION_TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                </label>
                <label className="block"><Label>Date</Label>
                  <input name="decisionDate" type="date" className={`mt-1 ${field}`} /></label>
                <label className="block"><Label>Author</Label>
                  <input name="author" className={`mt-1 ${field}`} /></label>
              </div>
              <label className="block"><Label>Decision</Label>
                <input name="decision" required className={`mt-1 ${field}`} /></label>
              <label className="block"><Label>Rationale</Label>
                <textarea name="rationale" rows={3}
                  className="mt-1 w-full rounded border border-line bg-surface-card px-3 py-2 text-sm text-ink focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20" />
              </label>
              <label className="block"><Label>Next steps</Label>
                <input name="nextSteps" className={`mt-1 ${field}`} /></label>
              <div className="flex justify-end">
                <button type="submit" className={submit}>Record decision</button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
