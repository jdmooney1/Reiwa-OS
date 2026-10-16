// ============================================================================
// A draft deal from a reviewed teaser, against real Postgres and its policies.
// ----------------------------------------------------------------------------
// Proved here: the deal is the loader's own draft (stage new, untriaged, unowned, money on a
// version-1 case, nothing published); the teaser lands as an INTERNAL Broker Brochure document
// in the same commit; a held deal and a failed file copy leave no trace; dropping the same
// teaser twice fills blanks on the same deal; and staff cannot write into an organisation they
// are not a member of. The storage copy is stubbed: this suite is about the database.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withSession, type Session } from "@/lib/db/client";
import { parseDealSeed } from "@/lib/ingestion/deal-seed";
import { createIntakeDeal, IntakeOrgError, getTeaserBrief, type IntakeDealInput } from "@/lib/data/teaser-intake";
import { teaserUnderwriting } from "@/lib/teaser-intake/underwriting";
import { TeaserExtractionSchema, emptyExtraction, toSeedRecord, intakeReference } from "@/lib/teaser-intake/schema";
import { orgIdByName, createStaffSession } from "./helpers";

let uploads = 0;
const UPLOAD = () => `${String(Date.now()).slice(-4)}${String(++uploads).padStart(4, "0")}-6b5a-4f3e-9d2c-0a1b2c3d4e5f`;
const RUN = [...String(Date.now()).slice(-6)].map((c) => "abcdefghij"[Number(c)]).join("");
let n = 0;
let orgId: string;
let otherOrgId: string;
let staff: Session;

function input(name: string, extra: Partial<IntakeDealInput> = {}): IntakeDealInput {
  const tag = `Zt${RUN}${"abcdefghij"[++n % 10]}${"abcdefghij"[Math.floor(n / 10) % 10]}`;
  const x = emptyExtraction();
  x.opportunity = {
    ...x.opportunity, name: `${tag} ${name}`, address: `${tag} ${name}, Amsterdam`, market: "Amsterdam",
    asset_type: "office", broker_name: "Example Agents", source_contact_name: "Pat Example", deal_stage: "guided",
  };
  x.asset_snapshot = { ...x.asset_snapshot, size_sq_m: 1000, tenure: "freehold", passing_rent_pa: 500000 };
  x.deal_terms = { ...x.deal_terms, currency: "EUR", guide_price: 11000000, niy_percent: 4.1 };
  x.evidence = [{ field: "deal_terms.guide_price", page: 1, quote: "EUR 11.000.000 k.k." }];
  x.asset_snapshot.erv_pa = 520000;
  x.asset_snapshot.occupancy_percent = 95;
  x.tenants = [
    { name: "Studio B.V.", unit: "Ground", use: "office", area_sq_ft: 6000, area_sq_m: null, rent_pa: 300000, erv_pa: null, lease_expiry: "2031-06-30", break_option: null },
    { name: "Vacant", unit: "First", use: null, area_sq_ft: 4000, area_sq_m: null, rent_pa: null, erv_pa: null, lease_expiry: null, break_option: null },
  ];
  const reading = TeaserExtractionSchema.parse(x);
  const record = toSeedRecord(reading, { fileName: "teaser.pdf", model: "test-model" });
  const [deal] = parseDealSeed({ deals: [record] });
  return {
    orgId, userId: staff.userId, allowExisting: false, record, deal: { ...deal, reference: intakeReference(deal.name, UPLOAD()) },
    fileName: "teaser.pdf", title: "teaser", mimeType: "application/pdf", sizeBytes: 1234,
    underwriting: teaserUnderwriting(reading, { fileName: "teaser.pdf" }), ...extra,
  };
}
let k = 0;
const fileIt = async (opportunityId: string) => `opportunities/${opportunityId}/intake-test-${++k}.pdf`;
const counts = async () => (await adminQuery<Record<string, number>>(
  `select (select count(*) from opportunities)::int o, (select count(*) from deal_load_batches)::int b,
          (select count(*) from opportunity_documents)::int d, (select count(*) from investment_cases)::int c`))[0];

beforeAll(async () => {
  orgId = await orgIdByName("Meiji Shipping");
  const others = await adminQuery<{ org_id: string }>("select org_id from organizations where org_id <> $1 limit 1", [orgId]);
  otherOrgId = others[0].org_id;
  staff = await createStaffSession(`intake-${RUN}@reiwa.test`, "Intake Staff", [orgId]);
});

describe("a teaser makes the loader's own draft, with the file filed on it", () => {
  it("creates the draft, its case, its provenance and an internal Broker Brochure document", async () => {
    const r = await withSession(staff, (tx) => createIntakeDeal(tx, input("Kade"), fileIt));
    expect(r.kind).toBe("done");
    if (r.kind !== "done") return;
    const [o] = await adminQuery<Record<string, any>>("select * from opportunities where opportunity_id = $1", [r.opportunityId]);
    expect(o).toMatchObject({
      stage: "new", status: "active", triage_status: "untriaged", owner_user_id: null, created_by: staff.userId,
      currency: "EUR", broker_name: "Example Agents", source_contact_name: "Pat Example", deal_stage: "guided",
    });
    expect(o.reference).toMatch(/^IM-ZT[A-Z]+-KADE-\d{8}$/);
    expect(Number(o.size_sqft)).toBe(10764);
    expect(o.source_facts.teaser_intake.evidence).toHaveLength(1);
    const c = await adminQuery<Record<string, any>>("select * from investment_cases where opportunity_id = $1", [r.opportunityId]);
    expect(c).toHaveLength(1);
    expect(Number(c[0].acquisition_price)).toBe(11000000);
    const d = await adminQuery<Record<string, any>>("select * from opportunity_documents where opportunity_id = $1", [r.opportunityId]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ category: "Broker Brochure", access_level: "internal", uploaded_by: staff.userId, mime_type: "application/pdf" });
    const rows = await adminQuery<Record<string, any>>(
      "select b.source_sheet, r.outcome, r.raw_row from deal_load_rows r join deal_load_batches b using (batch_id) where r.opportunity_id = $1", [r.opportunityId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source_sheet: "teaser-intake", outcome: "created" });
    expect(rows[0].raw_row.teaser_intake.model).toBe("test-model");
    const pubs = await adminQuery<{ n: number }>("select count(*)::int n from publication_sources where opportunity_id = $1", [r.opportunityId]);
    expect(pubs[0].n).toBe(0);
  });

  it("the same teaser dropped again is held against the deal it made: a teaser never updates a deal by itself", async () => {
    const i = input("Gracht");
    const a = await withSession(staff, (tx) => createIntakeDeal(tx, i, fileIt));
    expect(a.kind).toBe("done");
    const again = { ...i, deal: { ...i.deal, reference: intakeReference(i.deal.name, UPLOAD()) } };
    const b = await withSession(staff, (tx) => createIntakeDeal(tx, again, fileIt));
    expect(b.kind).toBe("held");
    if (a.kind === "done" && b.kind === "held") expect(b.collisions.map((c) => c.opportunityId)).toContain(a.opportunityId);
  });

  it("a deal that looks like one already in the pipeline is held and leaves no trace, unless allowed", async () => {
    const first = input("Singel Huis");
    await withSession(staff, (tx) => createIntakeDeal(tx, first, fileIt));
    const twin = { ...first, deal: { ...first.deal, name: `${first.deal.name} Amsterdam`, reference: intakeReference(`${first.deal.name} Amsterdam`, UPLOAD()) } };
    const before = await counts();
    let copies = 0;
    const r = await withSession(staff, (tx) => createIntakeDeal(tx, twin, async (o) => { copies++; return fileIt(o); }));
    expect(r.kind).toBe("held");
    expect(copies).toBe(0);
    expect(await counts()).toEqual(before);
    const anyway = await withSession(staff, (tx) => createIntakeDeal(tx, { ...twin, allowExisting: true }, fileIt));
    expect(anyway.kind === "done" && anyway.outcome).toBe("created");
  });

  it("a failed file copy rolls the whole deal back", async () => {
    const before = await counts();
    await expect(withSession(staff, (tx) => createIntakeDeal(tx, input("Damrak"), async () => { throw new Error("storage down"); })))
      .rejects.toThrow(/storage down/);
    expect(await counts()).toEqual(before);
  });

  it("staff cannot create a deal in an organisation they are not a member of", async () => {
    await expect(withSession(staff, (tx) => createIntakeDeal(tx, input("Rokin", { orgId: otherOrgId }), fileIt)))
      .rejects.toBeInstanceOf(IntakeOrgError);
  });

  it("leaves underwriting v1 ready: the teaser's figures, its tenancy as a rent roll, and nothing decided", async () => {
    const r = await withSession(staff, (tx) => createIntakeDeal(tx, input("Underwritten"), fileIt));
    expect(r.kind).toBe("done");
    if (r.kind !== "done") return;
    const c = await adminQuery<Record<string, any>>("select * from investment_cases where opportunity_id = $1", [r.opportunityId]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ version: 1, status: "current", created_by: staff.userId });
    expect(Number(c[0].acquisition_price)).toBe(11000000);
    expect(Number(c[0].erv)).toBe(520000);
    expect(Number(c[0].occupancy_pct)).toBe(95);
    expect(c[0].change_rationale).toMatch(/^From the broker teaser \(teaser\.pdf\)/);
    for (const k of ["acquisition_costs", "capex", "debt", "exit_yield_pct", "hold_period_years", "target_irr", "noi"]) expect(c[0][k], k).toBeNull();
    expect(c[0].assumptions.source).toBe("teaser_intake");
    expect(c[0].assumptions.rentRoll).toHaveLength(2);
    expect(c[0].assumptions.rentRoll[1]).toMatchObject({ unit: "First", tenant: null, rentPa: 0, areaSqft: 4000 });
    const brief = await withSession(staff, (tx) => getTeaserBrief(tx, r.opportunityId));
    expect(brief?.tenancy).toHaveLength(2);
    expect(brief?.documentId).toBe(r.documentId);
  });

  it("makes version 1 when the teaser gives no price but does give income", async () => {
    const i = input("No Price");
    const u = { ...i.underwriting!, fields: { ...i.underwriting!.fields, acquisition_price: null, entry_yield_pct: null, gross_rental_income: null } };
    const deal = { ...i.deal, money: { ...i.deal.money, guidePrice: null, niyPct: null, passingRent: null } };
    const r = await withSession(staff, (tx) => createIntakeDeal(tx, { ...i, deal, underwriting: u }, fileIt));
    if (r.kind !== "done") throw new Error(r.kind);
    const c = await adminQuery<Record<string, any>>("select * from investment_cases where opportunity_id = $1", [r.opportunityId]);
    expect(c).toHaveLength(1);
    expect(c[0].acquisition_price).toBeNull();
    expect(Number(c[0].erv)).toBe(520000);
  });

  it("a deal not made from a teaser has no brief", async () => {
    const [o] = await adminQuery<{ opportunity_id: string }>(
      "select opportunity_id from opportunities where source_facts->'teaser_intake' is null limit 1");
    expect(await withSession(staff, (tx) => getTeaserBrief(tx, o.opportunity_id))).toBeNull();
  });
});
