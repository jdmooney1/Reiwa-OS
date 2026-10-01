// ============================================================================
// The two trigger guards still fire after their EXECUTE grants were withdrawn.
// ----------------------------------------------------------------------------
// Migration 0022 revokes EXECUTE on app.guard_deal_load_raw() and
// app.guard_email_thread_link() from PUBLIC, anon and authenticated. Postgres
// checks that privilege when a trigger is CREATED, not when it fires, so the
// guards must keep working for an ordinary signed-in writer. These tests run the
// guards' own failure cases through withSession(), i.e. as `authenticated` with
// real RLS, which is exactly the role whose grant was withdrawn.
//
// No existing test exercised either guard, so each is shown here refusing and
// allowing, otherwise "still fires" would be an assumption.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { adminQuery, withSession, type Session } from "@/lib/db/client";
import { orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

let org: string;
let user: string;
let session: Session;
let opportunityId: string;
const batches: string[] = [];
const threads: string[] = [];

beforeAll(async () => {
  org = await orgIdByName("Meiji Shipping");
  user = await profileIdByEmail("analyst@meiji.com");
  session = orgUserSession([org], user);
  const o = await adminQuery<{ opportunity_id: string }>(
    "select opportunity_id from opportunities where org_id = $1 limit 1", [org]);
  if (!o[0]) throw new Error("the seed has no opportunity for Meiji Shipping");
  opportunityId = o[0].opportunity_id;
});

afterAll(async () => {
  // Cascades remove the rows and links created below.
  if (batches.length) await adminQuery("delete from deal_load_batches where batch_id = any($1::uuid[])", [batches]);
  if (threads.length) await adminQuery("delete from email_threads where email_thread_id = any($1::uuid[])", [threads]);
});

describe("the function privileges 0022 sets", () => {
  const FNS = ["app.guard_deal_load_raw()", "app.guard_email_thread_link()"];

  it("PUBLIC, anon and authenticated cannot execute them; the owner can", async () => {
    for (const fn of FNS) {
      const r = await adminQuery<Record<string, boolean>>(
        `select has_function_privilege('public', $1, 'execute') as pub,
                has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('postgres', $1, 'execute') as owner`, [fn]);
      expect(r[0], fn).toEqual({ pub: false, anon: false, auth: false, owner: true });
    }
  });

  it("a signed-in session cannot call either one directly", async () => {
    for (const fn of FNS) {
      await expect(withSession(session, (tx) => tx.query(`select ${fn}`)), fn).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("deal_load_rows.raw_row stays immutable (app.guard_deal_load_raw)", () => {
  let rowId: string;

  beforeAll(async () => {
    const b = await adminQuery<{ batch_id: string }>(
      "insert into deal_load_batches (org_id, source_file, created_by) values ($1, 'guard-test.xlsx', $2) returning batch_id", [org, user]);
    batches.push(b[0].batch_id);
    const r = await adminQuery<{ load_row_id: string }>(
      `insert into deal_load_rows (org_id, batch_id, reference, raw_row, outcome)
       values ($1, $2, 'GUARD-001', '{"Asset": "Original"}'::jsonb, 'created') returning load_row_id`, [org, b[0].batch_id]);
    rowId = r[0].load_row_id;
  });

  it("refuses to change the source row, for an ordinary writer", async () => {
    await expect(withSession(session, (tx) => tx.query(
      "update deal_load_rows set raw_row = '{\"Asset\": \"Tampered\"}'::jsonb where load_row_id = $1", [rowId])))
      .rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("raw_row is immutable") });
    const kept = await adminQuery<{ raw_row: { Asset: string } }>("select raw_row from deal_load_rows where load_row_id = $1", [rowId]);
    expect(kept[0].raw_row.Asset).toBe("Original");
  });

  it("still allows every other column to change, and an update that leaves raw_row alone", async () => {
    await withSession(session, (tx) => tx.query(
      "update deal_load_rows set reason = 'checked', raw_row = raw_row where load_row_id = $1", [rowId]));
    const r = await adminQuery<{ reason: string }>("select reason from deal_load_rows where load_row_id = $1", [rowId]);
    expect(r[0].reason).toBe("checked");
  });
});

describe("a thread recorded as not a deal cannot be linked (app.guard_email_thread_link)", () => {
  async function thread(classification: string, subject: string): Promise<string> {
    const t = await adminQuery<{ email_thread_id: string }>(
      `insert into email_threads (org_id, gmail_thread_id, subject, classification, created_by)
       values ($1, $2, $3, $4, $5) returning email_thread_id`, [org, `guard-${randomUUID()}`, subject, classification, user]);
    threads.push(t[0].email_thread_id);
    return t[0].email_thread_id;
  }
  const link = (threadId: string) => withSession(session, (tx) => tx.query(
    `insert into opportunity_email_threads (org_id, opportunity_id, email_thread_id, linked_by)
     values ($1, $2, $3, $4)`, [org, opportunityId, threadId, user]));

  it("refuses the link, naming the thread, for an ordinary writer", async () => {
    const id = await thread("not_a_deal", "Google security alert");
    await expect(link(id)).rejects.toMatchObject({
      code: "P0001", message: expect.stringContaining('Thread "Google security alert" is recorded as not a deal'),
    });
    const n = await adminQuery<{ n: string }>("select count(*)::text n from opportunity_email_threads where email_thread_id = $1", [id]);
    expect(n[0].n).toBe("0");
  });

  it("refuses it on UPDATE too, when a link is re-pointed at such a thread", async () => {
    const good = await thread("deal", "Real deal thread");
    const bad = await thread("not_a_deal", "16 Conduit Street");
    await link(good);
    await expect(withSession(session, (tx) => tx.query(
      "update opportunity_email_threads set email_thread_id = $3 where opportunity_id = $1 and email_thread_id = $2",
      [opportunityId, good, bad]))).rejects.toMatchObject({ code: "P0001" });
  });

  it("still allows a link to an ordinary thread", async () => {
    const id = await thread("firm_level", "Several deals");
    await link(id);
    const n = await adminQuery<{ n: string }>("select count(*)::text n from opportunity_email_threads where email_thread_id = $1", [id]);
    expect(n[0].n).toBe("1");
  });
});
