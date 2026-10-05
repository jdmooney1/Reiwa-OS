// ============================================================================
// Memos (migration 0023): immutability in the database, the data layer over it,
// and the composition boundary - against real Postgres.
// ----------------------------------------------------------------------------
// The rule being proved is the one an approved investment case already lives
// under: a final memo is the document a decision was made on, so the DATABASE
// refuses to change it, whatever the application does. Seeded data (Meiji
// Shipping): 16 Conduit Street and Herengracht 472 have an approved underwriting
// version; 58 Queens Gate has none at all.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, withInvestorSession, type Session } from "@/lib/db/client";
import {
  loadMemoSource, createMemoDraft, recomposeDraft, setOverride, finalizeMemo,
  listMemos, latestMemo, composeLive,
} from "@/lib/data/memos";
import { createVersion } from "@/lib/data/underwriting";
import { composeMemo, resolveSection } from "@/lib/memo/compose";
import { MEMO_SECTIONS } from "@/lib/memo/sections";
import { investorAuthUserId, orgIdByName, orgUserSession, viewerSession, profileIdByEmail } from "./helpers";

let meiji: string;
let aoyama: string;
let analyst: string;
let writer: Session;
let viewer: Session;
let otherOrg: Session;
let approvedOpp: string;
let thinOpp: string;
const memoIds: string[] = [];

const oppByName = async (name: string) =>
  (await adminQuery<{ opportunity_id: string }>("select opportunity_id from opportunities where name = $1", [name]))[0].opportunity_id;

/** A memo row inserted directly, as the privileged connection (no RLS, no data layer). */
async function raw(opportunityId: string, version: number, status: "draft" | "final" = "draft") {
  const stamp = status === "final" ? `, ${"'" + analyst + "'"}, now()` : ", null, null";
  const r = await adminQuery<{ memo_id: string }>(
    `insert into memos (org_id, opportunity_id, version, status, content, overrides, created_by, finalized_by, finalized_at)
     values ($1, $2, $3, $4, '{"currency":"GBP","sections":{}}'::jsonb, '{}'::jsonb, $5 ${stamp}) returning memo_id`,
    [meiji, opportunityId, version, status, analyst]);
  memoIds.push(r[0].memo_id);
  return r[0].memo_id;
}

async function clearOpp(id: string) {
  await adminQuery("alter table memos disable trigger trg_memos_guard");
  await adminQuery("delete from memos where opportunity_id = $1", [id]);
  await adminQuery("alter table memos enable trigger trg_memos_guard");
}

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  aoyama = await orgIdByName("Aoyama Holdings");
  analyst = await profileIdByEmail("analyst@meiji.com");
  writer = orgUserSession([meiji], analyst);
  viewer = viewerSession([meiji], await profileIdByEmail("viewer@meiji.com"));
  otherOrg = orgUserSession([aoyama], await profileIdByEmail("user@aoyama.com"));
  approvedOpp = await oppByName("Herengracht 472");
  thinOpp = await oppByName("58 Queens Gate");
});

afterAll(async () => {
  // The guard refuses to delete a final memo, so the tidy-up steps outside it.
  await adminQuery("alter table memos disable trigger trg_memos_guard");
  await adminQuery("delete from memos where opportunity_id = any($1::uuid[])", [[approvedOpp, thinOpp]]);
  await adminQuery("alter table memos enable trigger trg_memos_guard");
  await adminQuery("delete from investment_cases where opportunity_id = $1", [thinOpp]);
});

describe("a final memo is immutable, enforced by the database", () => {
  let opp: string;
  beforeAll(async () => { opp = approvedOpp; await clearOpp(opp); });

  it("a draft may change its content and overrides", async () => {
    const id = await raw(opp, 1);
    await adminQuery(`update memos set overrides = '{"executive_summary":"x"}'::jsonb, content = '{"currency":"GBP","sections":{"a":1}}'::jsonb where memo_id = $1`, [id]);
    const r = await adminQuery<{ overrides: Record<string, string> }>("select overrides from memos where memo_id = $1", [id]);
    expect(r[0].overrides.executive_summary).toBe("x");
  });

  it("a draft cannot change its identity (opportunity, version, organisation, author)", async () => {
    const id = (await adminQuery<{ memo_id: string }>("select memo_id from memos where opportunity_id = $1", [opp]))[0].memo_id;
    for (const sql of [
      "update memos set version = 9 where memo_id = $1",
      "update memos set opportunity_id = '" + thinOpp + "' where memo_id = $1",
      "update memos set created_by = '" + (await profileIdByEmail("admin@reiwa.com")) + "' where memo_id = $1",
    ]) {
      await expect(adminQuery(sql, [id]), sql).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("identity cannot be altered") });
    }
  });

  it("finalising changes the stamp and NOTHING else: a finalise that also edits the content is refused", async () => {
    const id = (await adminQuery<{ memo_id: string }>("select memo_id from memos where opportunity_id = $1", [opp]))[0].memo_id;
    await expect(adminQuery(
      `update memos set status = 'final', finalized_by = $2, finalized_at = now(), overrides = '{"x":"sneaked"}'::jsonb where memo_id = $1`,
      [id, analyst])).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("without changing its content") });
  });

  it("a final row cannot be updated in any column, even to the same value", async () => {
    const id = (await adminQuery<{ memo_id: string }>("select memo_id from memos where opportunity_id = $1", [opp]))[0].memo_id;
    await adminQuery("update memos set status = 'final', finalized_by = $2, finalized_at = now() where memo_id = $1", [id, analyst]);
    for (const sql of [
      `update memos set content = '{"currency":"GBP","sections":{"tampered":1}}'::jsonb where memo_id = $1`,
      `update memos set overrides = '{"executive_summary":"rewritten"}'::jsonb where memo_id = $1`,
      "update memos set composed_at = now() where memo_id = $1",
      "update memos set status = 'draft', finalized_by = null, finalized_at = null where memo_id = $1",
      "update memos set version = version where memo_id = $1",
    ]) {
      await expect(adminQuery(sql, [id]), sql).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("is final and cannot be altered") });
    }
  });

  it("a final row cannot be deleted", async () => {
    const id = (await adminQuery<{ memo_id: string }>("select memo_id from memos where opportunity_id = $1", [opp]))[0].memo_id;
    await expect(adminQuery("delete from memos where memo_id = $1", [id]))
      .rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("is final and cannot be deleted") });
  });

  it("through a signed-in session too: RLS lets the statement in and the trigger refuses it", async () => {
    const id = (await adminQuery<{ memo_id: string }>("select memo_id from memos where opportunity_id = $1", [opp]))[0].memo_id;
    await expect(setOverride(writer, id, "executive_summary", "late edit")).rejects.toThrow(/Only a draft memo can be edited/);
    await expect(recomposeDraft(writer, id, composeMemo((await loadMemoSource(writer, opp))!))).rejects.toThrow(/Only a draft memo can be recomposed/);
    await expect(finalizeMemo(writer, id)).rejects.toThrow(/Only a draft memo can be finalised/);
  });

  it("final means stamped and draft means not: the two cannot disagree", async () => {
    await expect(adminQuery(
      `insert into memos (org_id, opportunity_id, version, status, content, created_by) values ($1, $2, 90, 'final', '{}', $3)`,
      [meiji, opp, analyst])).rejects.toMatchObject({ code: "23514" });
    await expect(adminQuery(
      `insert into memos (org_id, opportunity_id, version, status, content, created_by, finalized_by, finalized_at) values ($1, $2, 91, 'draft', '{}', $3, $3, now())`,
      [meiji, opp, analyst])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("versions", () => {
  it("one draft per opportunity, and a version number is used once", async () => {
    await clearOpp(thinOpp);
    await raw(thinOpp, 1);
    await expect(raw(thinOpp, 2)).rejects.toMatchObject({ code: "23505" });           // second draft
    await adminQuery("alter table memos disable trigger trg_memos_guard");
    await adminQuery("update memos set status = 'final', finalized_by = $2, finalized_at = now() where opportunity_id = $1", [thinOpp, analyst]);
    await adminQuery("alter table memos enable trigger trg_memos_guard");
    await expect(raw(thinOpp, 1)).rejects.toMatchObject({ code: "23505" });           // version reuse
    await raw(thinOpp, 2);                                                            // next draft is fine
  });

  it("the guard function is a trigger only: nobody can call it, and EXECUTE is revoked", async () => {
    const r = await adminQuery<Record<string, boolean>>(
      `select has_function_privilege('public', 'app.guard_memo()', 'execute') as pub,
              has_function_privilege('anon', 'app.guard_memo()', 'execute') as anon,
              has_function_privilege('authenticated', 'app.guard_memo()', 'execute') as auth`);
    expect(r[0]).toEqual({ pub: false, anon: false, auth: false });
  });
});

describe("the data layer: draft, hand-written text, finalise, revise", () => {
  let id: string;
  beforeAll(async () => { await clearOpp(approvedOpp); });

  it("composes from an opportunity with an approved underwriting version, with no fabricated content", async () => {
    const live = (await composeLive(writer, approvedOpp))!;
    expect(live.basis.kind).toBe("approved");
    expect(live.sections.key_metrics.status).toBe("composed");
    expect(live.sections.key_metrics.flags).toEqual([]);
    expect(live.sections.executive_summary.status).toBe("empty");
    id = await createMemoDraft(writer, approvedOpp, live);
    const m = (await latestMemo(writer, approvedOpp))!;
    expect(m).toMatchObject({ memoId: id, version: 1, status: "draft", overrides: {} });
    expect(m.content.sections.key_metrics.blocks.length).toBeGreaterThan(0);
  });

  it("a second draft is refused, in words", async () => {
    await expect(createMemoDraft(writer, approvedOpp, (await composeLive(writer, approvedOpp))!)).rejects.toThrow(/already has a draft/);
  });

  it("an override is stored apart from the composed content, wins when resolved, and can be cleared", async () => {
    await setOverride(writer, id, "executive_summary", "  Hand-written summary.\r\nSecond line.  ");
    let m = (await latestMemo(writer, approvedOpp))!;
    expect(m.overrides.executive_summary).toBe("Hand-written summary.\nSecond line.");
    expect(m.content.sections.executive_summary.status).toBe("empty");              // the record still says what was composed
    expect(resolveSection(m.content.sections.executive_summary, m.overrides.executive_summary, "teaser").state).toBe("edited");
    await setOverride(writer, id, "executive_summary", "");
    m = (await latestMemo(writer, approvedOpp))!;
    expect(m.overrides).toEqual({});
  });

  it("refuses a key that is not a section, and absurd text", async () => {
    await expect(setOverride(writer, id, "not_a_section" as never, "x")).rejects.toThrow(/not a section/);
    await expect(setOverride(writer, id, "key_metrics", "x".repeat(20_001))).rejects.toThrow(/longer than/);
  });

  it("a read-only session can read the memo but cannot change it", async () => {
    expect((await listMemos(viewer, approvedOpp)).length).toBe(1);
    await expect(setOverride(viewer, id, "key_metrics", "nope")).rejects.toThrow(/Only a draft memo can be edited/);
    await expect(createMemoDraft(viewer, thinOpp, (await composeLive(viewer, thinOpp))!)).rejects.toBeTruthy();
  });

  it("finalising locks it; the next version carries the human text forward and is a NEW row", async () => {
    await setOverride(writer, id, "key_metrics", "Our own metrics paragraph.");
    await finalizeMemo(writer, id);
    const final = (await latestMemo(writer, approvedOpp))!;
    expect(final).toMatchObject({ status: "final", version: 1 });
    expect(final.finalizedAt).not.toBeNull();

    const next = await createMemoDraft(writer, approvedOpp, (await composeLive(writer, approvedOpp))!);
    expect(next).not.toBe(id);
    const all = await listMemos(writer, approvedOpp);
    expect(all.map((m) => [m.version, m.status])).toEqual([[2, "draft"], [1, "final"]]);
    expect(all[0].overrides.key_metrics).toBe("Our own metrics paragraph.");        // carried
    expect(all[1].overrides.key_metrics).toBe("Our own metrics paragraph.");        // original untouched
  });
});

describe("a finalised memo does not move when the underwriting does", () => {
  it("holds its own copy of the figures: a later underwriting revision changes the live composition and not the memo", async () => {
    await clearOpp(thinOpp);
    // 58 Queens Gate has no underwriting in the seed; start from that every time.
    await adminQuery("delete from investment_cases where opportunity_id = $1", [thinOpp]);
    const v1 = await createVersion(writer, thinOpp, { acquisitionPrice: 50_000_000, targetIrr: 12, changeRationale: "first" });
    expect(v1).toBeTruthy();
    const first = (await composeLive(writer, thinOpp))!;
    expect(first.basis.kind).toBe("working");
    const id = await createMemoDraft(writer, thinOpp, first);
    await finalizeMemo(writer, id);

    await createVersion(writer, thinOpp, { acquisitionPrice: 70_000_000, targetIrr: 9, changeRationale: "repriced" });
    const live = (await composeLive(writer, thinOpp))!;
    const price = (m: typeof live) => JSON.stringify(m.sections.key_metrics.blocks[0]);
    expect(price(live)).toContain("70000000");

    const stored = (await latestMemo(writer, thinOpp))!;
    expect(stored.status).toBe("final");
    expect(price(stored.content)).toContain("50000000");
    expect(price(stored.content)).not.toContain("70000000");
    expect(stored.content.basis.version).toBe(1);
    await adminQuery("delete from investment_cases where opportunity_id = $1", [thinOpp]);
  });
});

describe("an opportunity early in its life still gets a memo", () => {
  it("with NO underwriting row at all: all seventeen sections, key metrics empty, nothing fabricated", async () => {
    const bare = await adminQuery<{ opportunity_id: string; n: string }>(
      "select o.opportunity_id, (select count(*)::text from investment_cases c where c.opportunity_id = o.opportunity_id) n from opportunities o where o.org_id = $1 and o.name = 'Magna Plaza'", [meiji]);
    expect(bare[0].n).toBe("0");
    const live = (await composeLive(writer, bare[0].opportunity_id))!;
    expect(live.basis).toEqual({ kind: "none", caseId: null, version: null, caseStatus: null });
    expect(Object.keys(live.sections)).toHaveLength(MEMO_SECTIONS.length);
    expect(live.sections.key_metrics.status).toBe("empty");
    const id = await createMemoDraft(writer, bare[0].opportunity_id, live);
    expect((await latestMemo(writer, bare[0].opportunity_id))!.memoId).toBe(id);
    await adminQuery("delete from memos where memo_id = $1", [id]);
  });
});

describe("what a memo is allowed to carry", () => {
  it("the source copies a whitelist: the opportunity's address, coordinates, broker and vendor never enter it", async () => {
    const o = (await adminQuery<{ opportunity_id: string; address: string | null; broker_name: string | null; vendor_name: string | null; city: string | null }>(
      `select o.opportunity_id, p.address, o.broker_name, o.vendor_name, p.city
         from opportunities o join properties p on p.property_id = o.property_id
        where o.org_id = $1 and p.address is not null limit 1`, [meiji]))[0];
    expect(o).toBeTruthy();
    await adminQuery(
      "update opportunities set broker_name = 'Secret Broker LLP', vendor_name = 'Distressed Vendor Ltd' where opportunity_id = $1", [o.opportunity_id]);
    await adminQuery("update properties set latitude = 51.123456, longitude = -0.123456 where property_id = (select property_id from opportunities where opportunity_id = $1)", [o.opportunity_id]);
    const src = JSON.stringify(await loadMemoSource(writer, o.opportunity_id));
    const memo = JSON.stringify(composeMemo((await loadMemoSource(writer, o.opportunity_id))!));
    for (const text of [o.address!, "Secret Broker LLP", "Distressed Vendor Ltd", "51.123456", "-0.123456"]) {
      expect(src, text).not.toContain(text);
      expect(memo, text).not.toContain(text);
    }
  });
});

describe("tenancy and investors", () => {
  it("another organisation sees no memo of this one", async () => {
    expect(await listMemos(otherOrg, approvedOpp)).toEqual([]);
    expect(await composeLive(otherOrg, approvedOpp)).toBeNull();
  });

  it("an investor session reads no memo and cannot write one, at any tier", async () => {
    for (const email of ["principal@kitano-fo.example", "partner@sakura-cap.example"]) {
      const uid = await investorAuthUserId(email);
      const n = await withInvestorSession(uid, (tx) => tx.query("select count(*)::int as n from memos"));
      expect((n.rows[0] as { n: number }).n, email).toBe(0);
      await expect(withInvestorSession(uid, (tx) => tx.query(
        "insert into memos (org_id, opportunity_id, version, content, created_by) values ($1, $2, 99, '{}', $3)", [meiji, approvedOpp, analyst]))).rejects.toBeTruthy();
    }
  });

  it("the only policies are the staff organisation rule, and anon holds nothing", async () => {
    const pol = await adminQuery<{ policyname: string; qual: string | null }>("select policyname, qual from pg_policies where tablename = 'memos' order by 1");
    expect(pol.map((p) => p.policyname)).toEqual(["memos_delete", "memos_insert", "memos_select", "memos_update"]);
    for (const p of pol) expect(p.qual === null || p.qual.includes("has_org")).toBe(true);
    const anon = await adminQuery<{ n: string }>("select count(*)::text n from information_schema.role_table_grants where table_name = 'memos' and grantee in ('anon', 'PUBLIC')");
    expect(anon[0].n).toBe("0");
  });
});
