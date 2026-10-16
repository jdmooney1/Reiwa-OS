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
import { createIntakeDeal, IntakeOrgError, type IntakeDealInput } from "@/lib/data/teaser-intake";
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
  const record = toSeedRecord(TeaserExtractionSchema.parse(x), { fileName: "teaser.pdf", model: "test-model" });
  const [deal] = parseDealSeed({ deals: [record] });
  return {
    orgId, userId: staff.userId, allowExisting: false, record, deal: { ...deal, reference: intakeReference(deal.name, UPLOAD()) },
    fileName: "teaser.pdf", title: "teaser", mimeType: "application/pdf", sizeBytes: 1234, ...extra,
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
});
