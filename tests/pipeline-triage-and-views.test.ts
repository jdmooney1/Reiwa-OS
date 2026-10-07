// ============================================================================
// Triage decisions and saved pipeline views (migration 0037), against real Postgres.
// ----------------------------------------------------------------------------
// Triage: Pursue, Watch and Pass write the agreed status, priority and note together; only an
// untriaged deal can be decided (a second decision never overwrites the first); undo reverses only
// your own decision; and the database's row policy, not the app, decides who may write.
//
// Saved views: a person's own named filter sets. Create, rename, replace, delete; one name per person;
// nobody else can see or touch them; a junk definition is reduced to a valid view; the table's own CHECKs
// hold; and with the table absent the list answers "not available" instead of failing.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withSession } from "@/lib/db/client";
import { seedDeal, type SeedContext } from "@/lib/data/deal-seed";
import { parseDealSeed, type SeedDeal } from "@/lib/ingestion/deal-seed";
import { recordTriage, undoTriage } from "@/lib/data/triage";
import { listSavedViews, createSavedView, updateSavedView, deleteSavedView, MAX_SAVED_VIEWS } from "@/lib/data/pipeline-views";
import { REASON_MAX } from "@/lib/pipeline/triage";
import { adminSession, orgUserSession, viewerSession, orgIdByName, seededUserId } from "./helpers";

let orgId: string;
let ctx: SeedContext;
let analyst: Awaited<ReturnType<typeof orgUserSession>>;
let n = 0;
const RUN = String(Date.now()).slice(-6);
const letters = (k: number) => [...`${RUN}${String(k).padStart(2, "0")}`].map((c) => "abcdefghij"[Number(c)]).join("");

const parse = (d: unknown): SeedDeal => parseDealSeed({ note: "fixture", deals: [d] })[0];
async function newDeal(): Promise<string> {
  const tag = `ZZTEST${letters(++n)}`;
  const deal = parse({
    opportunity: { name: `${tag} Hall`, address: `${tag} Hall, 1 ${tag} Street`, market: "London", asset_type: "Mixed Use", off_market: false, deal_stage: "guided", sourcing: "Broker email, Example Partners (Pat Example)" },
    asset_snapshot: { size_sq_ft: 1000 }, deal_terms: { guide_price_gbp: 5_000_000, niy_percent: 6, currency: "GBP" }, data_completeness: "full",
  });
  const r = await withSession(adminSession, (tx) => seedDeal(tx, ctx, deal));
  return r.opportunityId!;
}
const opp = async (id: string) => (await adminQuery<Record<string, any>>("select * from opportunities where opportunity_id = $1", [id]))[0];

beforeAll(async () => {
  orgId = await orgIdByName("Meiji Shipping");
  ctx = { orgId, userId: adminSession.userId, allowExisting: false };
  analyst = orgUserSession([orgId]);
});

describe("triage decisions", () => {
  it("Pursue is live with no priority", async () => {
    const id = await newDeal();
    const r = await recordTriage(adminSession, id, "pursue", "Strong location");
    expect(r).toEqual({ triageStatus: "live", triagePriority: null, triageNote: "Strong location" });
    const o = await opp(id);
    expect(o).toMatchObject({ triage_status: "live", triage_priority: null, triage_note: "Strong location", triaged_by: adminSession.userId });
    expect(o.triaged_at).not.toBeNull();
  });

  it("Watch is live at P3 and the note says it is being watched", async () => {
    const id = await newDeal();
    await recordTriage(adminSession, id, "watch", "Price may drop");
    expect(await opp(id)).toMatchObject({ triage_status: "live", triage_priority: "P3", triage_note: "Watching: Price may drop" });
    const bare = await newDeal();
    await recordTriage(adminSession, bare, "watch", "");
    expect(await opp(bare)).toMatchObject({ triage_status: "live", triage_priority: "P3", triage_note: "Watching" });
  });

  it("Pass is dead, keeps its reason, and carries no priority", async () => {
    const id = await newDeal();
    await recordTriage(adminSession, id, "pass", "Yield too thin");
    expect(await opp(id)).toMatchObject({ triage_status: "dead", triage_priority: null, triage_note: "Yield too thin" });
    const bare = await newDeal();
    await recordTriage(adminSession, bare, "pass", undefined);
    expect(await opp(bare)).toMatchObject({ triage_status: "dead", triage_note: null });
  });

  it("changes nothing else about the deal: not its stage, status, owner or figures", async () => {
    const id = await newDeal();
    const before = await opp(id);
    await recordTriage(adminSession, id, "pass", "x");
    const after = await opp(id);
    for (const k of ["stage", "status", "owner_user_id", "name", "reference", "property_id", "archived_at"]) expect(after[k], k).toEqual(before[k]);
  });

  it("caps and cleans the reason", async () => {
    const id = await newDeal();
    await recordTriage(adminSession, id, "pursue", `  ${"y".repeat(REASON_MAX + 200)}  `);
    expect((await opp(id)).triage_note).toHaveLength(REASON_MAX);
  });

  it("refuses anything that is not one of the three decisions", async () => {
    const id = await newDeal();
    for (const bad of ["live", "dead", "reference", "", null, 7, "PURSUE"]) {
      await expect(recordTriage(adminSession, id, bad, "x"), String(bad)).rejects.toThrow(/not a triage decision/);
    }
    expect((await opp(id)).triage_status).toBe("untriaged");
  });
});

describe("only an untriaged deal can be decided", () => {
  it("a second decision does not overwrite the first, and says so", async () => {
    const id = await newDeal();
    await recordTriage(adminSession, id, "pursue", "first");
    await expect(recordTriage(analyst, id, "pass", "second")).rejects.toThrow(/already triaged/);
    expect(await opp(id)).toMatchObject({ triage_status: "live", triage_note: "first", triaged_by: adminSession.userId });
  });

  it("a deal that does not exist is a plain refusal, not a crash", async () => {
    await expect(recordTriage(adminSession, "00000000-0000-4000-8000-000000000000", "pursue", "")).rejects.toThrow(/could not be found/);
  });
});

describe("undo", () => {
  it("puts the deal back to untriaged and clears everything the decision wrote", async () => {
    const id = await newDeal();
    await recordTriage(adminSession, id, "watch", "later");
    await undoTriage(adminSession, id);
    expect(await opp(id)).toMatchObject({ triage_status: "untriaged", triage_priority: null, triage_note: null, triaged_at: null, triaged_by: null });
    // ...and it can be decided again.
    await recordTriage(adminSession, id, "pass", "now no");
    expect((await opp(id)).triage_status).toBe("dead");
  });

  it("will not undo somebody else's decision, or a deal that is untriaged already", async () => {
    const id = await newDeal();
    await recordTriage(adminSession, id, "pursue", "mine");
    await expect(undoTriage(analyst, id)).rejects.toThrow(/cannot be undone/);
    expect((await opp(id)).triage_status).toBe("live");
    const fresh = await newDeal();
    await expect(undoTriage(adminSession, fresh)).rejects.toThrow(/cannot be undone/);
  });
});

describe("who may triage is the database's decision", () => {
  it("a member of the deal's organisation with write scope can", async () => {
    const id = await newDeal();
    await recordTriage(analyst, id, "pursue", "");
    expect((await opp(id)).triaged_by).toBe(seededUserId("analyst"));
  });

  it("a person with no scope on the deal's organisation cannot, and nothing changes", async () => {
    const id = await newDeal();
    const outsider = orgUserSession([], seededUserId("analyst"));
    await expect(recordTriage(outsider, id, "pursue", "")).rejects.toThrow(/could not be found, or you cannot triage/);
    expect((await opp(id)).triage_status).toBe("untriaged");
  });

  it("a read-only viewer cannot", async () => {
    const id = await newDeal();
    await expect(recordTriage(viewerSession([orgId]), id, "pursue", "")).rejects.toThrow(/could not be found, or you cannot triage/);
    expect((await opp(id)).triage_status).toBe("untriaged");
  });
});

describe("saved views", () => {
  const VIEW = { filters: { market: "London", priceMin: "5", priceMax: "15", yieldMin: "6" }, sort: { key: "entryYield", dir: "desc" }, layout: "table" };
  const tag = () => `ZZTEST view ${++n}`;

  it("creates, lists, renames, replaces the filters of, and deletes a view", async () => {
    const name = tag();
    const made = await createSavedView(analyst, name, VIEW);
    expect(made.name).toBe(name);
    expect(made.state).toEqual({
      filters: expect.objectContaining({ market: "London", priceMin: "5", priceMax: "15", yieldMin: "6" }),
      sort: { key: "entryYield", dir: "desc" }, layout: "table",
    });

    const listed = await listSavedViews(analyst);
    expect(listed.available).toBe(true);
    expect(listed.views.map((v) => v.name)).toContain(name);

    const renamed = await updateSavedView(analyst, made.viewId, { name: `${name} (renamed)` });
    expect(renamed.name).toBe(`${name} (renamed)`);
    expect(renamed.state).toEqual(made.state);                       // renaming leaves the filters alone

    const replaced = await updateSavedView(analyst, made.viewId, { state: { filters: { yieldMin: "7" }, sort: null, layout: "board" } });
    expect(replaced.name).toBe(`${name} (renamed)`);                 // replacing the filters leaves the name alone
    expect(replaced.state.filters.yieldMin).toBe("7");
    expect(replaced.state.filters.market).toBe("");
    expect(replaced.state.layout).toBe("board");

    await deleteSavedView(analyst, made.viewId);
    expect((await listSavedViews(analyst)).views.map((v) => v.viewId)).not.toContain(made.viewId);
  });

  it("stores only a valid view, whatever it is handed", async () => {
    const made = await createSavedView(analyst, tag(), {
      filters: { market: "London", priceMin: "abc", yieldMin: "1e9", triageStatus: "bogus", evil: "<script>" }, sort: "nope", layout: "<x>", extra: 1,
    });
    expect(made.state.filters.market).toBe("London");
    expect(made.state.filters.priceMin).toBe("");
    expect(made.state.filters.yieldMin).toBe("");
    expect(made.state.filters.triageStatus).toBe("");
    expect(made.state.sort).toBeNull();
    expect(made.state.layout).toBe("board");
    const stored = (await adminQuery<{ definition: Record<string, unknown> }>("select definition from pipeline_saved_views where view_id = $1", [made.viewId]))[0].definition;
    expect(Object.keys(stored).sort()).toEqual(["filters", "layout", "sort"]);
    expect(JSON.stringify(stored)).not.toMatch(/evil|script|extra/);
    await deleteSavedView(analyst, made.viewId);
  });

  it("one name per person, ignoring case and spaces; two people may share a name", async () => {
    const name = tag();
    const a = await createSavedView(analyst, name, VIEW);
    await expect(createSavedView(analyst, `  ${name.toUpperCase()}  `, VIEW)).rejects.toThrow(/already have a view with that name/);
    const b = await createSavedView(adminSession, name, VIEW);          // a different person: fine
    await deleteSavedView(analyst, a.viewId);
    await deleteSavedView(adminSession, b.viewId);
  });

  it("a view is private: nobody else can see, change or delete it", async () => {
    const mine = await createSavedView(analyst, tag(), VIEW);
    expect((await listSavedViews(adminSession)).views.map((v) => v.viewId)).not.toContain(mine.viewId);      // not even an administrator
    await expect(updateSavedView(adminSession, mine.viewId, { name: "stolen" })).rejects.toThrow(/could not be found/);
    await expect(deleteSavedView(adminSession, mine.viewId)).rejects.toThrow(/could not be found/);
    // and the database agrees when asked directly
    const seen = await withSession(adminSession, (tx) => tx.query("select view_id from pipeline_saved_views where view_id = $1", [mine.viewId]));
    expect(seen.rows).toHaveLength(0);
    expect((await listSavedViews(analyst)).views.map((v) => v.viewId)).toContain(mine.viewId);
    await deleteSavedView(analyst, mine.viewId);
  });

  it("a read-only viewer cannot save one", async () => {
    await expect(createSavedView(viewerSession([orgId]), tag(), VIEW)).rejects.toThrow();
    expect((await listSavedViews(viewerSession([orgId]))).views).toEqual([]);
  });

  it("refuses an empty or over-long name, and a change that changes nothing", async () => {
    await expect(createSavedView(analyst, "   ", VIEW)).rejects.toThrow(/Give the view a name/);
    await expect(createSavedView(analyst, "x".repeat(81), VIEW)).rejects.toThrow(/80 characters/);
    const made = await createSavedView(analyst, tag(), VIEW);
    await expect(updateSavedView(analyst, made.viewId, {})).rejects.toThrow(/Nothing to change/);
    await deleteSavedView(analyst, made.viewId);
  });

  it(`keeps at most ${MAX_SAVED_VIEWS} per person`, async () => {
    const mine = (await listSavedViews(analyst)).views;
    for (const v of mine) await deleteSavedView(analyst, v.viewId);
    const ids: string[] = [];
    for (let i = 0; i < MAX_SAVED_VIEWS; i++) ids.push((await createSavedView(analyst, `ZZTEST cap ${RUN} ${i}`, VIEW)).viewId);
    await expect(createSavedView(analyst, `ZZTEST cap ${RUN} over`, VIEW)).rejects.toThrow(/up to 50 saved views/);
    for (const id of ids) await deleteSavedView(analyst, id);
  });

  it("the table refuses a definition that is not a small object", async () => {
    const uid = seededUserId("analyst");
    await expect(adminQuery("insert into pipeline_saved_views(user_id, name, definition) values ($1,'ZZTEST bad','[]'::jsonb)", [uid])).rejects.toThrow(/check constraint/);
    await expect(adminQuery("insert into pipeline_saved_views(user_id, name, definition) values ($1,'ZZTEST big', jsonb_build_object('x', repeat('y', 5000)))", [uid])).rejects.toThrow(/check constraint/);
    await expect(adminQuery("insert into pipeline_saved_views(user_id, name, definition) values ($1,'  ','{}'::jsonb)", [uid])).rejects.toThrow(/check constraint/);
  });

  it("with the table absent (migration not applied yet) the list says so instead of failing, and a write explains why", async () => {
    await adminQuery("alter table pipeline_saved_views rename to pipeline_saved_views_hidden");
    try {
      expect(await listSavedViews(analyst)).toEqual({ available: false, views: [] });
      await expect(createSavedView(analyst, tag(), VIEW)).rejects.toThrow(/not available yet/);
      await expect(deleteSavedView(analyst, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/not available yet/);
    } finally {
      await adminQuery("alter table pipeline_saved_views_hidden rename to pipeline_saved_views");
    }
    expect((await listSavedViews(analyst)).available).toBe(true);
  });

  it("only the owner's role may write: the policy, not the app, refuses an outsider's insert", async () => {
    await expect(withSession(viewerSession([orgId]), (tx) =>
      tx.query("insert into pipeline_saved_views(user_id, name, definition) values ($1, 'ZZTEST sneaky', '{}'::jsonb)", [seededUserId("viewer")])))
      .rejects.toThrow(/row-level security/);
    // writing as somebody else is refused even by an internal role
    await expect(withSession(analyst, (tx) =>
      tx.query("insert into pipeline_saved_views(user_id, name, definition) values ($1, 'ZZTEST impersonate', '{}'::jsonb)", [adminSession.userId])))
      .rejects.toThrow(/row-level security/);
  });
});
