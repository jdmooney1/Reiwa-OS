// ============================================================================
// Deleting an investor organisation, and the guard that decides whether it may be.
// ----------------------------------------------------------------------------
// Everything cascades from investor_organizations, so the guard is the only protection. Each
// thing it checks is proved to block on its own, a never-used organisation is proved to delete
// cleanly, the concurrent case is proved, and a catalog test fails if a new table starts to
// cascade from an organisation without the guard knowing.
// Fixtures: ZZTEST organisations created here and removed afterwards.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { adminQuery } from "@/lib/db/client";
import {
  createInvestorOrganization, createInvestorContact, updateInvestorContact,
} from "@/lib/data/investor-portal";
import { createInvite } from "@/lib/data/investor-invites";
import { acceptInvite } from "@/lib/data/investor-invites";
import { deleteInvestorOrganization, getDeletionGuard, listNeverUsedOrgIds } from "@/lib/data/investor-delete";
import { GUARD_COVERAGE } from "@/lib/investor/deletion-guard";
import { provisionInvestorAuthUser } from "@/lib/supabase/investor-admin";
import { AppError } from "@/lib/errors";
import { adminSession } from "./helpers";

const created: string[] = [];
let publicationId = "";
let n = 0;

async function org(label: string): Promise<{ id: string; name: string }> {
  const name = `ZZTEST Delete ${label} ${++n}`;
  const id = await createInvestorOrganization(adminSession, { name });
  created.push(id);
  return { id, name };
}
const orgExists = async (id: string) =>
  (await adminQuery("select 1 from investor_organizations where investor_org_id = $1", [id])).length === 1;

async function contact(orgId: string, tag: string): Promise<string> {
  return createInvestorContact(adminSession, { investorOrgId: orgId, name: `ZZTEST ${tag}`, email: `zztest.delete.${tag}.${n}@example.invalid` });
}
async function refusal(work: () => Promise<unknown>): Promise<unknown> {
  try { await work(); } catch (e) { return e; }
  return null;
}
async function expectBlocked(o: { id: string; name: string }, mention: RegExp) {
  const e = await refusal(() => deleteInvestorOrganization(adminSession, o.id, o.name));
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).message).toMatch(mention);
  expect((e as AppError).message).toContain("Suspended or Closed");
  expect(await orgExists(o.id)).toBe(true);
}

beforeAll(async () => {
  const rows = await adminQuery<{ publication_id: string }>("select publication_id from investor_publications limit 1");
  publicationId = rows[0].publication_id;
});
afterAll(async () => {
  await adminQuery("delete from investor_organizations where investor_org_id = any($1::uuid[])", [created]);
});

describe("an organisation that has never been used", () => {
  it("passes the guard and is listed as never used", async () => {
    const o = await org("clean");
    const g = await getDeletionGuard(adminSession, o.id);
    expect(g!.allowed).toBe(true);
    expect(await listNeverUsedOrgIds(adminSession)).toContain(o.id);
  });

  it("deletes cleanly, taking its unprovisioned contacts and unaccepted invitations with it", async () => {
    const o = await org("cascade");
    const c = await contact(o.id, "cascade");
    await createInvite(adminSession, c);
    expect((await getDeletionGuard(adminSession, o.id))!.alsoDeleted).toEqual({ contacts: 1, unacceptedInvites: 1 });

    const done = await deleteInvestorOrganization(adminSession, o.id, o.name);
    expect(done.name).toBe(o.name);
    expect(await orgExists(o.id)).toBe(false);
    expect(await adminQuery("select 1 from investor_contacts where investor_org_id = $1", [o.id])).toHaveLength(0);
    expect(await adminQuery("select 1 from investor_invites where investor_contact_id = $1", [c])).toHaveLength(0);
  });

  it("will not delete without the exact name typed, and says so", async () => {
    const o = await org("confirm");
    for (const typed of ["", "wrong", o.name.toLowerCase()]) {
      const e = await refusal(() => deleteInvestorOrganization(adminSession, o.id, typed));
      expect((e as AppError).message).toContain("Type the organisation's name");
    }
    expect(await orgExists(o.id)).toBe(true);
    await deleteInvestorOrganization(adminSession, o.id, `  ${o.name}  `); // surrounding spaces are forgiven
    expect(await orgExists(o.id)).toBe(false);
  });

  it("says plainly when it is already gone", async () => {
    const e = await refusal(() => deleteInvestorOrganization(adminSession, "00000000-0000-0000-0000-000000000000", "x"));
    expect((e as AppError).message).toBe("That organisation no longer exists.");
  });
});

describe("each thing the guard checks blocks on its own", () => {
  it("a contact with a portal sign-in, even one who never logged in", async () => {
    const o = await org("provisioned");
    const c = await contact(o.id, "prov");
    const uid = await provisionInvestorAuthUser(`zztest.delete.auth.${n}@example.invalid`, "ZZTEST Auth");
    await updateInvestorContact(adminSession, c, { authUserId: uid });
    expect((await getDeletionGuard(adminSession, o.id))!.reasons).toEqual(["1 contact with a portal sign-in"]);
    await expectBlocked(o, /1 contact with a portal sign-in/);
    expect(await listNeverUsedOrgIds(adminSession)).not.toContain(o.id);
  });

  it("any portal activity event", async () => {
    const o = await org("events");
    const c = await contact(o.id, "ev");
    await adminQuery("insert into investor_activity_events(investor_contact_id, investor_org_id, event_type) values ($1,$2,'login')", [c, o.id]);
    await expectBlocked(o, /1 portal activity event/);
  });

  it("an entitlement row that is visible", async () => {
    const o = await org("ent-visible");
    await adminQuery("insert into publication_entitlements(investor_org_id, publication_id, is_visible) values ($1,$2,true)", [o.id, publicationId]);
    await expectBlocked(o, /1 publication entitlement/);
  });

  it("an entitlement row that is hidden or revoked", async () => {
    const o = await org("ent-hidden");
    await adminQuery("insert into publication_entitlements(investor_org_id, publication_id, is_visible) values ($1,$2,false)", [o.id, publicationId]);
    await expectBlocked(o, /1 publication entitlement \(hidden or revoked ones count\)/);
  });

  it("an investor request", async () => {
    const o = await org("req");
    const c = await contact(o.id, "req");
    await adminQuery("insert into investor_requests(investor_contact_id, investor_org_id, request_type) values ($1,$2,'information')", [c, o.id]);
    await expectBlocked(o, /1 investor request/);
  });

  it("an accepted invitation", async () => {
    const o = await org("invite");
    const c = await contact(o.id, "inv");
    const inv = await createInvite(adminSession, c);
    expect(await acceptInvite(inv.inviteId, c)).toBe(true);
    await expectBlocked(o, /1 accepted invitation/);
  });

  it("a saved opportunity", async () => {
    const o = await org("saved");
    const c = await contact(o.id, "sav");
    await adminQuery("insert into investor_saved(investor_contact_id, publication_id) values ($1,$2)", [c, publicationId]);
    await expectBlocked(o, /1 saved opportunity/);
  });

  it("reports every reason at once when there are several", async () => {
    const o = await org("several");
    const c = await contact(o.id, "sev");
    await adminQuery("insert into investor_activity_events(investor_contact_id, investor_org_id, event_type) values ($1,$2,'login')", [c, o.id]);
    await adminQuery("insert into publication_entitlements(investor_org_id, publication_id) values ($1,$2)", [o.id, publicationId]);
    const g = await getDeletionGuard(adminSession, o.id);
    expect(g!.reasons).toEqual(["1 portal activity event", "1 publication entitlement (hidden or revoked ones count)"]);
  });
});

describe("two things happening at once", () => {
  it("an entitlement committed while the delete waits is seen, and blocks it", async () => {
    const o = await org("race");
    // Session B inserts an entitlement and holds its transaction open: that takes a key-share
    // lock on the organisation row, which the delete's `for update` has to wait for.
    const b = new Client({ connectionString: process.env.DATABASE_URL });
    await b.connect();
    try {
      await b.query("begin");
      await b.query("insert into publication_entitlements(investor_org_id, publication_id) values ($1,$2)", [o.id, publicationId]);

      let settled = false;
      const attempt = refusal(() => deleteInvestorOrganization(adminSession, o.id, o.name)).finally(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // genuinely waiting on B

      await b.query("commit");
      const e = await attempt;
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).message).toMatch(/1 publication entitlement/);
      expect(await orgExists(o.id)).toBe(true);
    } finally {
      await b.query("rollback").catch(() => undefined);
      await b.end();
    }
  }, 30_000);

  it("a dependent row added after the delete has the lock fails its foreign key and leaves nothing behind", async () => {
    const o = await org("race2");
    const a = new Client({ connectionString: process.env.DATABASE_URL });
    await a.connect();
    try {
      await a.query("begin");
      await a.query("select 1 from investor_organizations where investor_org_id = $1 for update", [o.id]);
      const b = new Client({ connectionString: process.env.DATABASE_URL });
      await b.connect();
      try {
        const insert = b.query("insert into publication_entitlements(investor_org_id, publication_id) values ($1,$2)", [o.id, publicationId])
          .then(() => "inserted", (err: { code?: string }) => err.code);
        await new Promise((r) => setTimeout(r, 300));
        await a.query("delete from investor_organizations where investor_org_id = $1", [o.id]);
        await a.query("commit");
        expect(await insert).toBe("23503"); // foreign_key_violation
      } finally { await b.end(); }
    } finally {
      await a.query("rollback").catch(() => undefined);
      await a.end();
    }
    expect(await orgExists(o.id)).toBe(false);
    expect(await adminQuery("select 1 from publication_entitlements where investor_org_id = $1", [o.id])).toHaveLength(0);
  }, 30_000);
});

describe("the guard knows every table that hangs off an organisation or a contact", () => {
  async function referencing(table: string): Promise<string[]> {
    const rows = await adminQuery<{ child: string }>(
      `select distinct c.conrelid::regclass::text as child
         from pg_constraint c
        where c.contype = 'f' and c.confrelid = ('public.' || $1)::regclass`, [table]);
    return rows.map((r) => r.child.replace(/^public\./, ""));
  }

  it("every table with a foreign key to investor_organizations or investor_contacts is accounted for", async () => {
    const known = new Set<string>([...GUARD_COVERAGE.blockers, ...GUARD_COVERAGE.cascades]);
    const found = new Set([...(await referencing("investor_organizations")), ...(await referencing("investor_contacts"))]);
    const unknown = [...found].filter((t) => !known.has(t));
    // A failure here means a new table now cascades from an investor organisation or contact.
    // Decide whether its rows mean "this organisation was used" (add a check to
    // src/lib/data/investor-delete.ts and GUARD_COVERAGE.blockers) or are safe to lose with a
    // never-used organisation (GUARD_COVERAGE.cascades), then update this list.
    expect(unknown, `unguarded tables cascading from an investor organisation: ${unknown.join(", ")}`).toEqual([]);
    expect([...known].filter((t) => !found.has(t))).toEqual([]); // and the guard does not name a table that is gone
  });
});
