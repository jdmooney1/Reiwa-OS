"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  ChevronLeft, Star, ArrowUp, ArrowDown, EyeOff, Eye, Plus, X, Pencil, Loader2,
} from "lucide-react";
import type { InvestorContact, AssignedPublication } from "@/lib/data/investor-portal";
import type { PublicationOption } from "@/lib/data/admin-portal";
import type { InvestorInvite } from "@/lib/data/investor-invites";
import {
  updateInvestorOrgAction, createInvestorContactAction, updateInvestorContactAction,
  setContactActiveAction, assignPublicationAction, setEntitlementPlacementAction,
  setEntitlementVisibilityAction, revokeEntitlementAction, setEntitlementAccessAction,
  saveEntitlementNoteAction, reorderSecondaryAction,
} from "@/app/actions/admin-portal";
import {
  provisionContactAccessAction, createInviteForContactAction, revokeInviteAction,
  type CreatedInvite,
} from "@/app/actions/admin-invites";
import {
  INVESTOR_ORG_STATUS_LABEL, INVESTOR_ORG_STATUS_TONE, WORKFLOW_LABEL, WORKFLOW_TONE,
} from "@/lib/portal-labels";
import { formatDate } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Org {
  investorOrgId: string;
  name: string;
  status: "active" | "suspended" | "closed";
  linkedInternalOrganizationName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function InvestorOrgDetail({
  org, contacts, assignments, publicationOptions, invites = [],
}: {
  org: Org;
  contacts: InvestorContact[];
  assignments: AssignedPublication[];
  publicationOptions: PublicationOption[];
  invites?: InvestorInvite[];
}) {
  const [pending, start] = useTransition();
  const titles = useMemo(
    () => new Map(publicationOptions.map((o) => [o.publicationId, o.title])),
    [publicationOptions]);

  const featured = assignments.filter((a) => a.entitlement.isVisible && a.entitlement.placement === "featured");
  const secondary = assignments
    .filter((a) => a.entitlement.isVisible && a.entitlement.placement === "secondary")
    .sort((a, b) => a.entitlement.sortOrder - b.entitlement.sortOrder);
  const hidden = assignments.filter((a) => !a.entitlement.isVisible);
  const assignedIds = new Set(assignments.map((a) => a.publication.publicationId));
  const assignable = publicationOptions.filter((o) => !assignedIds.has(o.publicationId));

  const moveSecondary = (index: number, delta: -1 | 1) => {
    const order = secondary.map((a) => a.entitlement.entitlementId);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    start(() => reorderSecondaryAction(org.investorOrgId, order));
  };

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-line bg-surface-card px-8 py-5">
        <Link href="/admin/investors"
          className="mb-2 inline-flex items-center gap-1 text-2xs text-ink-faint hover:text-ink">
          <ChevronLeft className="h-3 w-3" /> Investor Organisations
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-serif text-2xl text-ink">{org.name}</h1>
          <Badge tone={INVESTOR_ORG_STATUS_TONE[org.status]} dot>
            {INVESTOR_ORG_STATUS_LABEL[org.status]}
          </Badge>
        </div>
        <div className="mt-1 text-sm text-ink-muted">
          {contacts.filter((c) => c.isActive).length} active contact{contacts.filter((c) => c.isActive).length === 1 ? "" : "s"}
          {" · "}{featured.length + secondary.length} visible opportunit{featured.length + secondary.length === 1 ? "y" : "ies"}
          {org.linkedInternalOrganizationName ? ` · linked to ${org.linkedInternalOrganizationName}` : ""}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-3">
        {/* ---- Assigned opportunities (the investor's portal) ---- */}
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader
              eyebrow="Investor Portal"
              title="Assigned Opportunities"
              action={<span className="text-2xs text-ink-faint">What this organisation sees, in order</span>}
            />
            <CardBody className="space-y-5">
              {/* Featured slot */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 text-gold-deep" strokeWidth={1.75} />
                  <span className="eyebrow">Featured</span>
                  <span className="text-2xs text-ink-faint">— one visible featured opportunity per organisation</span>
                </div>
                {featured.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-line py-5 text-center text-2xs text-ink-faint">
                    No featured opportunity. Promote one below — featuring another later replaces it automatically.
                  </div>
                ) : featured.map((a) => (
                  <AssignmentRow key={a.entitlement.entitlementId} a={a} org={org}
                    fallbackTitle={titles.get(a.publication.publicationId)}
                    pending={pending} start={start} featured />
                ))}
              </div>

              {/* Secondary list */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="eyebrow">Also Available</span>
                  <span className="text-2xs text-ink-faint">— shown after the featured opportunity</span>
                </div>
                {secondary.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-line py-5 text-center text-2xs text-ink-faint">
                    Nothing else is visible to this organisation.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {secondary.map((a, i) => (
                      <AssignmentRow key={a.entitlement.entitlementId} a={a} org={org}
                        fallbackTitle={titles.get(a.publication.publicationId)}
                        pending={pending} start={start}
                        onMoveUp={i > 0 ? () => moveSecondary(i, -1) : undefined}
                        onMoveDown={i < secondary.length - 1 ? () => moveSecondary(i, 1) : undefined} />
                    ))}
                  </div>
                )}
              </div>

              {/* Hidden / revoked */}
              {hidden.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <EyeOff className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} />
                    <span className="eyebrow">Hidden / Revoked</span>
                    <span className="text-2xs text-ink-faint">— the record is kept, the investor sees nothing</span>
                  </div>
                  <div className="space-y-2">
                    {hidden.map((a) => (
                      <AssignmentRow key={a.entitlement.entitlementId} a={a} org={org}
                        fallbackTitle={titles.get(a.publication.publicationId)}
                        pending={pending} start={start} hidden />
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Assign a publication */}
          <Card>
            <CardHeader eyebrow="Assignment" title="Assign a Publication" />
            <CardBody>
              {assignable.length === 0 ? (
                <p className="text-xs text-ink-faint">
                  Every existing publication is already assigned to this organisation.
                  Create publications from internal opportunities under{" "}
                  <Link href="/admin/publications" className="text-gold-deep hover:underline">Publications</Link>.
                </p>
              ) : (
                <form action={assignPublicationAction.bind(null, org.investorOrgId)}
                  className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <label className="block md:col-span-2">
                    <span className="eyebrow">Publication</span>
                    <select name="publicationId" required defaultValue=""
                      className="mt-1 h-9 w-full rounded border border-line bg-surface px-2.5 text-sm text-ink focus:border-gold focus:outline-none">
                      <option value="" disabled>Choose a publication…</option>
                      {assignable.map((o) => (
                        <option key={o.publicationId} value={o.publicationId}>
                          {o.title}{o.status !== "published" ? ` (${WORKFLOW_LABEL[o.status]})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="eyebrow">Placement</span>
                    <select name="placement" defaultValue="secondary"
                      className="mt-1 h-9 w-full rounded border border-line bg-surface px-2.5 text-sm text-ink focus:border-gold focus:outline-none">
                      <option value="secondary">Also Available</option>
                      <option value="featured">Featured (replaces current)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="eyebrow">Document access</span>
                    <select name="documentAccessLevel" defaultValue="standard"
                      className="mt-1 h-9 w-full rounded border border-line bg-surface px-2.5 text-sm text-ink focus:border-gold focus:outline-none">
                      <option value="standard">Standard</option>
                      <option value="diligence">Diligence</option>
                    </select>
                  </label>
                  <label className="block md:col-span-2 xl:col-span-3">
                    <span className="eyebrow">Investor note (optional)</span>
                    <input name="investorNote" placeholder="A line the investor sees against this opportunity"
                      className="mt-1 h-9 w-full rounded border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30" />
                  </label>
                  <div className="flex items-end justify-between gap-3 md:col-span-2 xl:col-span-1">
                    <label className="flex items-center gap-2 pb-2 text-xs text-ink">
                      <input type="checkbox" name="isVisible" defaultChecked className="accent-gold" />
                      Visible immediately
                    </label>
                    <button type="submit"
                      className="rounded bg-navy px-4 py-2 text-xs font-semibold text-surface hover:bg-navy-50">
                      Assign
                    </button>
                  </div>
                </form>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ---- Right column: organisation + contacts ---- */}
        <div className="space-y-6">
          <Card>
            <CardHeader eyebrow="Organisation" title="Overview" />
            <CardBody>
              <form action={updateInvestorOrgAction.bind(null, org.investorOrgId)} className="space-y-4">
                <label className="block">
                  <span className="eyebrow">Name</span>
                  <input name="name" defaultValue={org.name} required
                    className="mt-1 h-9 w-full rounded border border-line bg-surface px-3 text-sm text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30" />
                </label>
                <label className="block">
                  <span className="eyebrow">Status</span>
                  <select name="status" defaultValue={org.status}
                    className="mt-1 h-9 w-full rounded border border-line bg-surface px-2.5 text-sm text-ink focus:border-gold focus:outline-none">
                    <option value="active">Active</option>
                    <option value="suspended">Suspended — portal access paused</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label className="block">
                  <span className="eyebrow">Notes (internal)</span>
                  <textarea name="notes" rows={3} defaultValue={org.notes ?? ""}
                    className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30" />
                </label>
                <div className="flex items-center justify-between">
                  <span className="text-2xs text-ink-faint">Created {formatDate(org.createdAt)}</span>
                  <button type="submit"
                    className="rounded bg-navy px-4 py-2 text-xs font-semibold text-surface hover:bg-navy-50">
                    Save
                  </button>
                </div>
              </form>
            </CardBody>
          </Card>

          <ContactsCard org={org} contacts={contacts} invites={invites}
            pending={pending} start={start} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// One assigned opportunity
// ============================================================================
function AssignmentRow({
  a, org, fallbackTitle, pending, start, featured = false, hidden = false, onMoveUp, onMoveDown,
}: {
  a: AssignedPublication;
  org: Org;
  fallbackTitle?: string;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
  featured?: boolean;
  hidden?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const [editingNote, setEditingNote] = useState(false);
  const e = a.entitlement;
  const v = a.activeVersion;
  const title = v?.title ?? fallbackTitle ?? "Untitled publication";
  const live = a.publication.status === "published" && !!v;

  return (
    <div className={cn(
      "rounded-lg border px-4 py-3",
      featured ? "border-gold/40 bg-gold/5" : "border-line bg-surface",
      hidden && "opacity-70",
    )}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/publications/${a.publication.publicationId}`}
              className="truncate text-sm font-medium text-ink hover:text-gold-deep">
              {title}
            </Link>
            <Badge tone={WORKFLOW_TONE[a.publication.status]} dot>
              {WORKFLOW_LABEL[a.publication.status]}
            </Badge>
            <Badge tone={e.documentAccessLevel === "diligence" ? "gold" : "neutral"}>
              {e.documentAccessLevel === "diligence" ? "Diligence docs" : "Standard docs"}
            </Badge>
          </div>
          <div className="mt-0.5 text-2xs text-ink-faint">
            {[v?.city ?? v?.market, v?.strategy, v?.assetType].filter(Boolean).join(" · ") || "No published content yet"}
          </div>
          {!live && !hidden && (
            <div className="mt-1 text-2xs font-medium text-caution">
              Not live — the investor sees nothing until a version is published.
            </div>
          )}
          {e.investorNote && !editingNote && (
            <div className="mt-1.5 text-xs italic text-ink-muted">“{e.investorNote}”</div>
          )}
          {editingNote && (
            <form
              action={async (fd) => {
                await saveEntitlementNoteAction(e.entitlementId, org.investorOrgId, fd);
                setEditingNote(false);
              }}
              className="mt-2 flex items-center gap-2"
            >
              <input name="investorNote" defaultValue={e.investorNote ?? ""} autoFocus
                placeholder="A line the investor sees against this opportunity"
                className="h-8 w-72 rounded border border-line bg-surface-card px-2.5 text-xs text-ink focus:border-gold focus:outline-none" />
              <button type="submit" className="rounded bg-navy px-2.5 py-1.5 text-2xs font-semibold text-surface">Save</button>
              <button type="button" onClick={() => setEditingNote(false)} className="text-2xs text-ink-faint hover:text-ink">Cancel</button>
            </form>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-faint" />}
          {onMoveUp && <IconBtn label="Move up" onClick={onMoveUp} disabled={pending}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>}
          {onMoveDown && <IconBtn label="Move down" onClick={onMoveDown} disabled={pending}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>}
          {!hidden && (
            <>
              {!featured ? (
                <SmallBtn disabled={pending} title="Featuring replaces the current featured opportunity"
                  onClick={() => start(() => setEntitlementPlacementAction(e.entitlementId, org.investorOrgId, "featured"))}>
                  <Star className="h-3 w-3" /> Feature
                </SmallBtn>
              ) : (
                <SmallBtn disabled={pending}
                  onClick={() => start(() => setEntitlementPlacementAction(e.entitlementId, org.investorOrgId, "secondary"))}>
                  Make secondary
                </SmallBtn>
              )}
              <SmallBtn disabled={pending}
                onClick={() => start(() => setEntitlementAccessAction(
                  e.entitlementId, org.investorOrgId,
                  e.documentAccessLevel === "standard" ? "diligence" : "standard"))}>
                {e.documentAccessLevel === "standard" ? "Grant diligence" : "Standard only"}
              </SmallBtn>
              <SmallBtn disabled={pending} onClick={() => setEditingNote((v) => !v)}>
                <Pencil className="h-3 w-3" /> Note
              </SmallBtn>
              <SmallBtn tone="negative" disabled={pending}
                title="The investor loses sight of this opportunity immediately; the record is kept"
                onClick={() => start(() => revokeEntitlementAction(e.entitlementId, org.investorOrgId))}>
                <EyeOff className="h-3 w-3" /> Revoke
              </SmallBtn>
            </>
          )}
          {hidden && (
            <SmallBtn disabled={pending}
              onClick={() => start(() => setEntitlementVisibilityAction(e.entitlementId, org.investorOrgId, true))}>
              <Eye className="h-3 w-3" /> Restore (as Also Available)
            </SmallBtn>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Contacts
// ============================================================================
function ContactsCard({
  org, contacts, invites, pending, start,
}: {
  org: Org;
  contacts: InvestorContact[];
  invites: InvestorInvite[];
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Raw invitation links exist only here, in this admin's browser, until the
  // page is left — the server stores hashes alone.
  const [issued, setIssued] = useState<Record<string, CreatedInvite>>({});

  const latestInviteFor = (contactId: string): InvestorInvite | undefined =>
    invites.find((i) => i.investorContactId === contactId); // newest first

  return (
    <Card>
      <CardHeader
        eyebrow="People"
        title="Contacts"
        action={
          <button onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 rounded border border-line px-2.5 py-1.5 text-2xs font-medium text-ink-muted hover:border-gold/40 hover:text-ink">
            {adding ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {adding ? "Cancel" : "Add contact"}
          </button>
        }
      />
      <CardBody className="p-0">
        {adding && (
          <form action={async (fd) => {
            await createInvestorContactAction(org.investorOrgId, fd);
            setAdding(false);
          }} className="space-y-3 border-b border-line bg-surface-sunken/50 px-5 py-4">
            <ContactFields />
            <div className="flex justify-end">
              <button type="submit" className="rounded bg-navy px-3.5 py-2 text-2xs font-semibold text-surface hover:bg-navy-50">
                Add Contact
              </button>
            </div>
          </form>
        )}
        {contacts.length === 0 && !adding ? (
          <div className="px-5 py-8 text-center text-xs text-ink-faint">
            No contacts yet. Add the people who will use this organisation’s portal.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {contacts.map((c) => (
              <li key={c.investorContactId} className={cn("px-5 py-3", !c.isActive && "opacity-60")}>
                {editingId === c.investorContactId ? (
                  <form action={async (fd) => {
                    await updateInvestorContactAction(c.investorContactId, org.investorOrgId, fd);
                    setEditingId(null);
                  }} className="space-y-3">
                    <ContactFields contact={c} />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditingId(null)}
                        className="text-2xs text-ink-faint hover:text-ink">Cancel</button>
                      <button type="submit" className="rounded bg-navy px-3 py-1.5 text-2xs font-semibold text-surface">Save</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink">{c.name}</span>
                          {!c.isActive && <Badge tone="muted">Inactive</Badge>}
                        </div>
                        <div className="mt-0.5 truncate text-2xs text-ink-faint">
                          {c.email}{c.title ? ` · ${c.title}` : ""}
                        </div>
                        <div className="mt-1">
                          {c.authUserId
                            ? <Badge tone="positive" dot>Sign-in provisioned</Badge>
                            : <Badge tone="muted" dot>No portal account yet</Badge>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <SmallBtn disabled={pending} onClick={() => setEditingId(c.investorContactId)}>
                          <Pencil className="h-3 w-3" /> Edit
                        </SmallBtn>
                        <SmallBtn tone={c.isActive ? "negative" : undefined} disabled={pending}
                          onClick={() => start(() => setContactActiveAction(c.investorContactId, org.investorOrgId, !c.isActive))}>
                          {c.isActive ? "Deactivate" : "Reactivate"}
                        </SmallBtn>
                      </div>
                    </div>
                    <ContactAccess
                      contact={c}
                      org={org}
                      invite={latestInviteFor(c.investorContactId)}
                      issued={issued[c.investorContactId]}
                      onIssued={(created) =>
                        setIssued((prev) => ({ ...prev, [c.investorContactId]: created }))}
                      pending={pending}
                      start={start}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Portal access controls for one contact (P3): provision the passwordless
 * sign-in, mint/revoke the invitation link, show its state. The raw link is
 * displayed exactly once, straight from the action's response.
 */
function ContactAccess({
  contact, org, invite, issued, onIssued, pending, start,
}: {
  contact: InvestorContact;
  org: Org;
  invite: InvestorInvite | undefined;
  issued: CreatedInvite | undefined;
  onIssued: (created: CreatedInvite) => void;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
}) {
  if (!contact.isActive) return null;

  if (!contact.authUserId) {
    return (
      <div className="mt-2 flex items-center justify-between gap-3 rounded border border-dashed border-line px-3 py-2">
        <span className="text-2xs text-ink-faint">
          Provision the sign-in to enable invitations. The account is OTP-only — no password exists.
        </span>
        <SmallBtn disabled={pending}
          onClick={() => start(() => provisionContactAccessAction(contact.investorContactId, org.investorOrgId))}>
          Provision sign-in
        </SmallBtn>
      </div>
    );
  }

  const stateBadge = invite && (
    invite.state === "active" ? <Badge tone="gold" dot>Invite active until {formatDate(invite.expiresAt)}</Badge>
    : invite.state === "accepted" ? <Badge tone="positive" dot>Invite accepted {formatDate(invite.acceptedAt)}</Badge>
    : invite.state === "expired" ? <Badge tone="caution" dot>Invite expired {formatDate(invite.expiresAt)}</Badge>
    : <Badge tone="muted" dot>Invite revoked</Badge>
  );

  return (
    <div className="mt-2 rounded border border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {stateBadge ?? <span className="text-2xs text-ink-faint">No invitation issued yet.</span>}
        </div>
        <div className="flex items-center gap-1">
          {invite?.state === "active" && (
            <SmallBtn tone="negative" disabled={pending}
              title="The link stops working immediately"
              onClick={() => start(() => revokeInviteAction(invite.inviteId, org.investorOrgId))}>
              Revoke
            </SmallBtn>
          )}
          <SmallBtn disabled={pending}
            title={invite?.state === "active"
              ? "Revokes the current link and issues a new one"
              : "Issues a new invitation link"}
            onClick={() => start(async () => {
              const created = await createInviteForContactAction(contact.investorContactId, org.investorOrgId);
              onIssued(created);
            })}>
            {invite ? "Regenerate invite" : "Create invite link"}
          </SmallBtn>
        </div>
      </div>
      {issued && (
        <div className="mt-2 rounded border border-gold/40 bg-gold/5 px-3 py-2">
          <div className="eyebrow mb-1">Invitation link — shown once, copy it now</div>
          <input readOnly
            value={typeof window !== "undefined" ? `${window.location.origin}${issued.path}` : issued.path}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-line bg-surface-card px-2 py-1.5 font-mono text-2xs text-ink" />
          <div className="mt-1 text-2xs text-ink-faint">
            Valid until {formatDate(issued.expiresAt)}. Only the link identifies the invitation — the
            server keeps a hash, so it cannot be recovered later.
          </div>
        </div>
      )}
    </div>
  );
}

function ContactFields({ contact }: { contact?: InvestorContact }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <label className="block">
        <span className="eyebrow">Name</span>
        <input name="name" required defaultValue={contact?.name ?? ""}
          className="mt-1 h-8 w-full rounded border border-line bg-surface-card px-2.5 text-xs text-ink focus:border-gold focus:outline-none" />
      </label>
      <label className="block">
        <span className="eyebrow">Title</span>
        <input name="title" defaultValue={contact?.title ?? ""}
          className="mt-1 h-8 w-full rounded border border-line bg-surface-card px-2.5 text-xs text-ink focus:border-gold focus:outline-none" />
      </label>
      <label className="block md:col-span-2">
        <span className="eyebrow">Email</span>
        <input name="email" type="email" required defaultValue={contact?.email ?? ""}
          className="mt-1 h-8 w-full rounded border border-line bg-surface-card px-2.5 text-xs text-ink focus:border-gold focus:outline-none" />
      </label>
    </div>
  );
}

// ---- Small controls ---------------------------------------------------------
function SmallBtn({
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
        "flex items-center gap-1 rounded border border-line px-2 py-1 text-2xs font-medium text-ink-muted transition-colors disabled:opacity-50",
        tone === "negative" ? "hover:border-negative/40 hover:text-negative" : "hover:border-gold/40 hover:text-ink",
      )}>
      {children}
    </button>
  );
}

function IconBtn({
  children, onClick, disabled, label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="rounded border border-line p-1 text-ink-muted hover:border-gold/40 hover:text-ink disabled:opacity-50">
      {children}
    </button>
  );
}
