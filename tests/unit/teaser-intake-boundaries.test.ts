// ============================================================================
// Where the teaser intake may not reach.
// ----------------------------------------------------------------------------
// The model's reading goes to a person, and only the person's reviewed version reaches the
// database, through the same seedDeal() the command-line loader uses. These hold that by
// reading the source: the model call holds no database handle, the actions write no
// publication or investor row, and nothing the browser loads is server-only.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const code = (r: string) => read(r).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const imports = (r: string) => [...code(r).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

const EXTRACT = "src/lib/teaser-intake/extract.ts";
const ACTIONS = "src/app/actions/teaser-intake.ts";
const DATA = "src/lib/data/teaser-intake.ts";
const STORE = "src/lib/teaser-intake/intake-store.ts";
const CLIENT = "src/components/opportunities/teaser-intake.tsx";
const PURE = ["src/lib/teaser-intake/schema.ts", "src/lib/teaser-intake/files.ts", "src/lib/teaser-intake/prompt.ts"];

describe("the model call cannot write", () => {
  it("imports no database, session or data module", () => {
    for (const i of imports(EXTRACT)) expect(i, i).not.toMatch(/db\/|auth\/|data\/|supabase|storage/);
    expect(code(EXTRACT)).toContain('import "server-only"');
  });
});

describe("the actions create a draft and publish nothing", () => {
  const a = code(ACTIONS);
  it("are staff-only, every one of them", () => {
    const exported = [...a.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThanOrEqual(5);
    for (const fn of exported) {
      const body = a.slice(a.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 400), fn).toMatch(/await requireStaffSession\(\)/);
    }
  });
  it("write no publication, entitlement, share or investor table, and import no portal writer", () => {
    expect(a).not.toMatch(/insert into (investor_|publication|deal_shares)|update (investor_|publication|deal_shares)/i);
    for (const i of imports(ACTIONS)) expect(i, i).not.toMatch(/publication|portal-access|deal-share|invitations|admin-portal/);
  });
  it("create the deal only through createIntakeDeal, after the schema and the parser have accepted the reviewed record", () => {
    expect(a).toContain("createIntakeDeal(tx,");
    expect(a).not.toMatch(/insert into opportunities|insert into properties|insert into investment_cases|insert into opportunity_documents/i);
    expect(a.indexOf("TeaserExtractionSchema.safeParse(")).toBeLessThan(a.indexOf("parseDealSeed("));
    expect(a.indexOf("parseDealSeed(")).toBeLessThan(a.indexOf("createIntakeDeal(tx,"));
  });
});

describe("the deal is made by the loader's own seedDeal, with the teaser in the same commit", () => {
  const d = code(DATA);
  it("calls seedDeal and writes no opportunity or property itself", () => {
    expect(d).toContain("seedDeal(tx,");
    expect(d).not.toMatch(/insert into (opportunities|properties)|update (opportunities|properties)/i);
  });
  it("writes underwriting only as version 1 of a deal it has just created, filling blanks", () => {
    expect(d).toMatch(/if \(input\.underwriting && outcome === "created"\)/);
    const fn = d.slice(d.indexOf("async function seedUnderwriting"), d.indexOf("// ---- Reading it back"));
    expect(fn).toContain("version = 1");
    expect(fn).toMatch(/values \(\$1,\$2,1,'current'/);
    const upd = fn.slice(fn.indexOf("update investment_cases set"), fn.indexOf("where case_id = $1"));
    for (const line of upd.split("\n").filter((x) => /=/.test(x) && !/update investment_cases/.test(x))) {
      expect(line, line.trim()).toMatch(/coalesce\(|\|\| assumptions/);
    }
    expect(fn).toMatch(/status !== "current" && c\.status !== "draft"\) return/);
  });
  it("writes nothing when the deal is held", () => {
    const held = d.indexOf('if (seeded.outcome === "held") return');
    expect(held).toBeGreaterThan(-1);
    for (const w of ["insert into deal_load_batches", "recordDocumentOn(", "fileIt("]) expect(d.indexOf(w), w).toBeGreaterThan(held);
  });
  it("files the teaser as an internal document (no access level is ever passed)", () => {
    expect(d).toContain("recordDocumentOn(tx,");
    expect(d).not.toMatch(/accessLevel/);
  });
  it("writes no publication, entitlement, share or investor table", () => {
    expect(d).not.toMatch(/investor_|publication|deal_shares|entitlement/i);
  });
});

describe("the intake store only touches its owner's intake folder", () => {
  const s = code(STORE);
  it("checks the owner before every read, copy or delete of an intake object", () => {
    for (const fn of ["readIntakeObject", "promoteIntakeObject", "removeIntakeObject"]) {
      const body = s.slice(s.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 300), fn).toMatch(/isIntakePathFor\(userId, path\)/);
    }
  });
  it("never mints a read URL for an intake object", () => {
    expect(s).not.toMatch(/createSignedUrl\(|getPublicUrl\(/);
  });
});

describe("the browser loads nothing server-only", () => {
  it("the client component imports only client-safe modules and server actions", () => {
    for (const i of imports(CLIENT)) {
      expect(i, i).not.toMatch(/intake-store|teaser-intake\/extract|db\/|supabase\/admin|run-action/);
    }
    for (const p of PURE) expect(imports(p).every((i) => i === "zod"), p).toBe(true);
  });
});
