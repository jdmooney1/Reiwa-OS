// ============================================================================
// Import a test set of investor_organizations rows from JD's capital-pipeline
// pack (imports/targets/data/organisations.json — not committed, see
// .gitignore; the pack also ships CLAUDE_CODE_BRIEF.md, which describes a
// much larger future CRM module and is NOT followed here — this script does
// only what was asked in chat).
//
//   npx tsx scripts/import-capital-pipeline-test-orgs.ts --file <path>
//   npx tsx scripts/import-capital-pipeline-test-orgs.ts --file <path> --write
//
// DRY BY DEFAULT: prints the mapping (first 10 rows + total count + the
// investor_type table) and touches no database. Nothing is written without
// --write.
//
// Scope, exactly as asked — nothing wider:
//   - Organisations only. contacts.json, channels.json, mandates.json and
//     anything "confidential" are never read or imported. meiji-shipping is
//     refused explicitly, twice over (it is register = 'client' and
//     confidential = true, so the filter below already excludes it — the id
//     check is a second, independent guard against a future pack where that
//     stops being true).
//   - Filter: register = 'capital' AND is_category is not true AND
//     confidential is not true. "is_category is not true" (not "is false")
//     is deliberate: ~43 of the pack's capital rows (individual Japanese
//     shipping companies under the Shipping Cluster wedge) have no
//     is_category key at all rather than a literal false — treating an
//     absent key as "not a category" is what gets the expected ~78 rows;
//     requiring a literal `false` gives only 35.
//   - No investor_contacts, no auth.users, no invitations: this script
//     inserts into investor_organizations and platform_settings alone.
//     Confirmed in code, not just asserted: migration 0005 defines no
//     trigger on investor_organizations (grep `on investor_organizations`
//     across supabase/migrations/*.sql — only the unique index and two RLS
//     SELECT policies), and no function in src/lib that sends mail, an OTP
//     or an invite ever reads or writes this table. Every email/OTP/invite
//     code path in this codebase is reached through
//     investor_contacts.auth_user_id, which this script never touches.
//   - No deal link: no deal_investor row is written.
//
// NOTES EXPOSURE (fixed after review): RLS restricts which ROWS a policy
// returns, never which COLUMNS — investor_organizations_self (0005) matches
// a row by investor_org_id alone, so once ANY investor_contacts row is ever
// linked to one of these test orgs, that investor's own portal session could
// select every column of that row, notes included. Nothing creates that link
// today, but "nothing imports a contact" is a fact about this script, not a
// structural guarantee — a later, unrelated admin action could add one. So
// `notes` holds ONLY the inert tag below, never the pipeline metadata: an
// investor session who somehow matched the row would read a meaningless
// bracketed string, nothing about tier, score, intro route or strategy.
//
// The metadata lives instead in `platform_settings` (0051/0052), keyed by
// the same tag string. That table's own SELECT policy is a staff-role
// allowlist (reiwa_admin/org_user/ic_member/investor_viewer) with no path
// for a portal investor at all — see tests/investor-rls.test.ts's existing
// coverage, extended by this change (an investor session reads neither the
// real metadata in notes nor the platform_settings row for a linked org).
//
// Idempotent, keyed on the pack's `id` (not `name` — two different ids could
// plausibly share a display name, and `name` is this table's own unique key
// for a different reason). The id is embedded in the tag —
// `[test-import:capital-pipeline:<id>]` — used as both the
// investor_organizations.notes value (verbatim, nothing appended) and the
// platform_settings.key for that row's metadata. Re-running updates both in
// place rather than duplicating. Removal is a separate script
// (scripts/remove-capital-pipeline-import.ts) — it has to check for
// deal_investor/contact/entitlement links before deleting anything, which a
// one-line DELETE cannot do safely.
// ============================================================================
import { readFileSync } from "node:fs";
import { requireEnv } from "./env";
import { adminQuery, closePool } from "@/lib/db/client";
import { TAG_PREFIX } from "./lib/capital-pipeline-import-tag";

interface PackOrg {
  id: string;
  name: string;
  register?: string;
  type?: string;
  wedge?: string;
  tier?: string;
  phase?: string;
  composite?: number;
  intro_route?: string;
  trigger?: string;
  next_action?: string;
  notes?: string;
  reputational_flag?: string;
  is_category?: boolean;
  confidential?: boolean;
}

/**
 * type/wedge -> investor_type. Explicit per distinct `type` string in the
 * pack (not a keyword heuristic) so the mapping is exactly what gets shown
 * before anything is written, and so a type the pack has never used before
 * falls through to the wedge-based fallback with a warning, rather than
 * silently guessing.
 */
const TYPE_MAP: Record<string, "individual" | "corporate" | "family_office" | "institutional" | "other"> = {
  "": "corporate", // blank type, always wedge = Shipping Cluster in this pack — individually named shipping companies
  "Developer": "corporate",
  "Insurance": "institutional",
  "Insurance / AM": "institutional",
  "Life insurer": "institutional",
  "Family office": "family_office",
  "Trading house": "corporate",
  "Trust bank / AM": "institutional",
  "Private corporate": "corporate",
  "Hotel operator": "corporate",
  "Hotel operator (and owner)": "corporate",
  "Budget hotel operator": "corporate",
  "Luxury hotel operator": "corporate",
  "Listed major": "corporate",
  "Listed corporate": "corporate",
  "Listed corporate (RE arm)": "corporate",
  "Listed contractor": "corporate",
  "Rail": "corporate",
  "Owner-family shipowners": "family_office",
  "Private dynasty": "family_office",
  "Family RE company": "family_office",
  "Family office (RE lineage)": "family_office",
  "Private office (London-linked)": "family_office",
  "Founder family vehicle": "family_office",
  "Policy bank": "institutional",
  "Leasing": "corporate",
  "Public Fund": "institutional",
  "Pension": "institutional",
};

/** Used only when `type` is blank or genuinely new to the pack. */
function mapByWedge(wedge: string): "individual" | "corporate" | "family_office" | "institutional" | "other" {
  const w = wedge.toLowerCase();
  if (w.includes("institutional lp")) return "institutional";
  if (w.includes("family")) return "family_office";
  return "corporate";
}

function mapInvestorType(org: PackOrg): "individual" | "corporate" | "family_office" | "institutional" | "other" {
  const type = org.type ?? "";
  if (type in TYPE_MAP) return TYPE_MAP[type];
  console.warn(`  ! unmapped type "${type}" (id ${org.id}) — falling back to wedge "${org.wedge ?? ""}"`);
  return mapByWedge(org.wedge ?? "");
}

/** Everything staff-facing about an imported row, beyond its name — never
 * written to investor_organizations.notes; always to platform_settings. */
interface ImportMetadata {
  sourceId: string;
  type: string;
  wedge: string;
  investorType: string;
  tier: string;
  phase: string;
  composite: number | null;
  introRoute: string;
  trigger: string;
  nextAction: string;
  reputationalFlag: string;
  notes: string;
}

interface MappedRow {
  id: string;
  name: string;
  tag: string;
  metadata: ImportMetadata;
}

function buildMetadata(org: PackOrg, investorType: string): ImportMetadata {
  return {
    sourceId: org.id,
    type: org.type || "",
    wedge: org.wedge || "",
    investorType,
    tier: org.tier || "",
    phase: org.phase || "",
    composite: org.composite ?? null,
    introRoute: org.intro_route || "",
    trigger: org.trigger || "",
    nextAction: org.next_action || "",
    reputationalFlag: org.reputational_flag || "",
    notes: org.notes || "",
  };
}

function loadAndMap(file: string): MappedRow[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as PackOrg[];
  if (!Array.isArray(raw)) throw new Error(`${file} is not a JSON array of organisations.`);

  const seen = new Set<string>();
  const rows: MappedRow[] = [];
  for (const org of raw) {
    if (org.register !== "capital") continue;
    if (org.is_category === true) continue; // category/segment rows, not named entities
    if (org.confidential === true) continue;
    if (org.id === "meiji-shipping") continue; // explicit second guard, see header
    if (!org.name || !org.name.trim()) continue; // defensive: blank row
    if (seen.has(org.id)) continue; // defensive: a repeated id in the source pack
    seen.add(org.id);

    const investorType = mapInvestorType(org);
    rows.push({
      id: org.id,
      name: org.name.trim(),
      tag: `${TAG_PREFIX}${org.id}]`,
      metadata: buildMetadata(org, investorType),
    });
  }
  return rows;
}

function printMetadata(m: ImportMetadata): void {
  console.log(`    Source ID: ${m.sourceId}`);
  console.log(`    Type: ${m.type || "(none)"}${m.wedge ? ` / ${m.wedge}` : ""} -> ${m.investorType}`);
  console.log(`    Tier: ${m.tier || "(none)"}`);
  console.log(`    Phase: ${m.phase || "(none)"}`);
  console.log(`    Composite score: ${m.composite ?? "(none)"}`);
  console.log(`    Intro route: ${m.introRoute || "(none)"}`);
  console.log(`    Trigger to watch: ${m.trigger || "(none)"}`);
  console.log(`    Next action: ${m.nextAction || "(none)"}`);
  console.log(`    Reputational flag: ${m.reputationalFlag || "(none)"}`);
  console.log(`    Notes: ${m.notes || "(none)"}`);
}

function printPreview(rows: MappedRow[]): void {
  console.log(`Mapped ${rows.length} organisation(s) from the pack.\n`);
  console.log("investor_type mapping used (distinct `type` strings in the pack):");
  for (const [type, mapped] of Object.entries(TYPE_MAP)) {
    console.log(`  ${JSON.stringify(type).padEnd(45)} -> ${mapped}`);
  }
  console.log("  (blank type falls back to wedge: contains \"institutional lp\" -> institutional, contains \"family\" -> family_office, else -> corporate)\n");

  console.log(`First ${Math.min(10, rows.length)} mapped rows:\n`);
  for (const row of rows.slice(0, 10)) {
    console.log(`— ${row.name}  [${row.metadata.investorType}]  (id: ${row.id})`);
    printMetadata(row.metadata);
    console.log();
  }

  console.log(`Total: ${rows.length} organisation(s) would be created/updated.`);
  console.log(`investor_organizations.notes gets ONLY the tag "${TAG_PREFIX}<id>]" — none of the above. The`);
  console.log("metadata above goes to platform_settings (staff-only; a portal investor session cannot read it).");
  console.log("To remove this import later: npm run db:remove-capital-pipeline-import -- --write");
}

async function writeRows(rows: MappedRow[]): Promise<void> {
  let created = 0, updated = 0;
  for (const row of rows) {
    const existing = await adminQuery<{ investor_org_id: string }>(
      "select investor_org_id from investor_organizations where notes = $1",
      [row.tag],
    );
    if (existing[0]) {
      await adminQuery(
        "update investor_organizations set name = $1, updated_at = now() where investor_org_id = $2",
        [row.name, existing[0].investor_org_id],
      );
      updated += 1;
    } else {
      await adminQuery(
        "insert into investor_organizations (name, notes) values ($1, $2)",
        [row.name, row.tag],
      );
      created += 1;
    }
    await adminQuery(
      `insert into platform_settings (key, value) values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [row.tag, JSON.stringify(row.metadata)],
    );
  }
  console.log(`\nWrote ${rows.length} row(s): ${created} created, ${updated} updated (already present, refreshed).`);
  console.log("To remove this import later: npm run db:remove-capital-pipeline-import -- --write");
}

function parseArgs(): { file: string; write: boolean } {
  const argv = process.argv.slice(2);
  const get = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const file = get("file");
  if (!file) throw new Error("--file <path to organisations.json> is required.");
  return { file, write: argv.includes("--write") };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = loadAndMap(args.file);
  printPreview(rows);

  if (!args.write) {
    console.log("\nDry run only — nothing written. Re-run with --write to apply.");
    return;
  }

  requireEnv();
  await writeRows(rows);
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(closePool);
