// ============================================================================
// Deleting an investor organisation, guarded. SERVER-ONLY.
// ----------------------------------------------------------------------------
// The rules and wording live in lib/investor/deletion-guard (pure). This file is the query that
// counts, and the transaction that deletes.
//
// The order inside the transaction matters. The organisation row is LOCKED first, in its own
// statement; the counts are read AFTER, in a second statement. In READ COMMITTED a statement's
// snapshot is taken when it starts, so counts read in the same statement as the lock would not
// see a row a concurrent session committed while we waited for it. Reading them after the lock
// does. And once the lock is held, anyone adding a dependent row (an entitlement, an activity
// event) waits on the organisation's key, then fails its foreign key when the delete commits.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import {
  evaluateGuard, blockedMessage, type DeletionGuard, type GuardCounts,
} from "@/lib/investor/deletion-guard";

/** The counts, for one organisation (`where o.investor_org_id = $1`) or for all of them. */
function countsSql(where: string): string {
  return `
    select o.investor_org_id, o.name,
      (select count(*) from investor_contacts c where c.investor_org_id = o.investor_org_id)                                as contacts,
      (select count(*) from investor_contacts c where c.investor_org_id = o.investor_org_id and c.auth_user_id is not null) as provisioned,
      (select count(*) from investor_activity_events e where e.investor_org_id = o.investor_org_id)                         as events,
      (select count(*) from publication_entitlements p where p.investor_org_id = o.investor_org_id)                         as entitlements,
      (select count(*) from investor_requests r where r.investor_org_id = o.investor_org_id)                                as requests,
      (select count(*) from investor_invites i join investor_contacts c using (investor_contact_id)
        where c.investor_org_id = o.investor_org_id and i.accepted_at is not null)                                          as accepted_invites,
      (select count(*) from investor_invites i join investor_contacts c using (investor_contact_id)
        where c.investor_org_id = o.investor_org_id and i.accepted_at is null)                                              as unaccepted_invites,
      (select count(*) from investor_saved s join investor_contacts c using (investor_contact_id)
        where c.investor_org_id = o.investor_org_id)                                                                        as saved
    from investor_organizations o ${where}`;
}

function toCounts(r: Record<string, unknown>): GuardCounts {
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    contacts: n("contacts"), provisioned: n("provisioned"), events: n("events"),
    entitlements: n("entitlements"), requests: n("requests"),
    acceptedInvites: n("accepted_invites"), saved: n("saved"),
    unacceptedInvites: n("unaccepted_invites"),
  };
}

async function readGuard(tx: Queryable, investorOrgId: string): Promise<{ name: string; guard: DeletionGuard } | null> {
  const { rows } = await tx.query<Record<string, unknown>>(countsSql("where o.investor_org_id = $1"), [investorOrgId]);
  if (!rows[0]) return null;
  return { name: rows[0].name as string, guard: evaluateGuard(toCounts(rows[0])) };
}

/** What the confirmation panel shows. The delete re-checks; this is never trusted. */
export async function getDeletionGuard(session: Session, investorOrgId: string): Promise<DeletionGuard | null> {
  return withSession(session, async (tx) => (await readGuard(tx, investorOrgId))?.guard ?? null);
}

/** The organisations that have never been used, for the "Never used" tag on the list. */
export async function listNeverUsedOrgIds(session: Session): Promise<string[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(countsSql(""));
    return rows.filter((r) => evaluateGuard(toCounts(r)).allowed).map((r) => r.investor_org_id as string);
  });
}

export interface DeletedOrganisation {
  investorOrgId: string;
  name: string;
  counts: GuardCounts;
}

/**
 * Delete an investor organisation that has never been used. Refuses, in plain words, any that
 * has. `typedName` must equal the organisation's name: the confirmation is enforced here as
 * well as on screen.
 */
export async function deleteInvestorOrganization(
  session: Session, investorOrgId: string, typedName: string,
): Promise<DeletedOrganisation> {
  return withSession(session, async (tx) => {
    // 1. Lock the row. Its own statement: see the note at the top of the file.
    const locked = await tx.query("select 1 from investor_organizations where investor_org_id = $1 for update", [investorOrgId]);
    if (locked.rows.length === 0) throw new AppError("That organisation no longer exists.");

    // 2. Count, now that nothing can be added behind us.
    const read = await readGuard(tx, investorOrgId);
    if (!read) throw new AppError("That organisation no longer exists.");
    if (!read.guard.allowed) throw new AppError(blockedMessage(read.guard));

    if (typedName.trim() !== read.name) {
      throw new AppError("Type the organisation's name exactly as shown to confirm the deletion.");
    }

    const gone = await tx.query("delete from investor_organizations where investor_org_id = $1 returning investor_org_id", [investorOrgId]);
    if (gone.rows.length !== 1) throw new AppError("That organisation could not be deleted.");

    const counts: GuardCounts = {
      contacts: read.guard.alsoDeleted.contacts, provisioned: 0, events: 0, entitlements: 0,
      requests: 0, acceptedInvites: 0, saved: 0, unacceptedInvites: read.guard.alsoDeleted.unacceptedInvites,
    };
    // There is no audit table to write to, so the server log is the record of who removed what.
    console.info("[reiwa] investor.organisation.deleted", {
      investorOrgId, name: read.name, by: session.userId,
      contactsDeleted: counts.contacts, invitationsDeleted: counts.unacceptedInvites,
    });
    return { investorOrgId, name: read.name, counts };
  });
}
