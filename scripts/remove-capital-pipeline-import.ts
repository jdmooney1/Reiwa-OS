// ============================================================================
// Remove the test investor_organizations rows created by
// import-capital-pipeline-test-orgs.ts, safely.
//
//   npx tsx scripts/remove-capital-pipeline-import.ts            (dry run)
//   npx tsx scripts/remove-capital-pipeline-import.ts --write    (delete)
//
// WHY NOT A ONE-LINE DELETE: investor_organizations has five inbound
// foreign keys (supabase/migrations/0005_investor_portal.sql,
// 0038_deal_investor.sql):
//
//   table                      on delete
//   -------------------------- ---------
//   investor_contacts          cascade
//   publication_entitlements   cascade
//   investor_activity_events   cascade
//   investor_requests          cascade
//   deal_investor               restrict
//
// This script never creates contacts/entitlements/activity/requests for an
// imported row, but nothing stops a later, unrelated admin action from
// adding one — and the whole point of this import is for someone to link a
// test org to a deal via deal_investor in the tracker. Two real hazards
// follow from a plain `delete from investor_organizations where notes =
// ...`, run as one statement over many rows:
//   1. `deal_investor` is ON DELETE RESTRICT, not CASCADE. If even one of
//      the matched rows is linked, Postgres rejects the WHOLE statement —
//      every other, genuinely-unlinked row stays too, with a FK error and
//      no explanation of which row caused it.
//   2. The four CASCADE FKs would, for any row that DID somehow pick up a
//      contact/entitlement/activity/request, delete those silently along
//      with it — exactly the kind of accidental cross-table deletion a
//      one-liner hides.
//
// So: check every one of the five tables for every tagged row FIRST, refuse
// and list anything linked, and delete only what is linked nowhere — one
// row at a time, so a block on one never hides or stops the rest. The
// matching platform_settings metadata row (same tag as its key) is removed
// alongside each investor_organizations row that actually gets deleted,
// and left alone for anything blocked, so the two tables never disagree
// about what still exists.
// ============================================================================
import { requireEnv } from "./env";
import { adminQuery, closePool } from "@/lib/db/client";
import { TAG_PREFIX } from "./lib/capital-pipeline-import-tag";

interface TaggedOrg {
  investor_org_id: string;
  name: string;
  notes: string;
}

interface LinkCheck {
  table: string;
  column: string;
}

// Every table with a foreign key into investor_organizations(investor_org_id).
const LINK_CHECKS: LinkCheck[] = [
  { table: "deal_investor", column: "investor_org_id" },
  { table: "investor_contacts", column: "investor_org_id" },
  { table: "publication_entitlements", column: "investor_org_id" },
  { table: "investor_activity_events", column: "investor_org_id" },
  { table: "investor_requests", column: "investor_org_id" },
];

async function findLinks(investorOrgId: string): Promise<string[]> {
  const linked: string[] = [];
  for (const check of LINK_CHECKS) {
    const rows = await adminQuery<{ n: number }>(
      `select count(*)::int as n from ${check.table} where ${check.column} = $1`,
      [investorOrgId],
    );
    if (rows[0].n > 0) linked.push(`${check.table} (${rows[0].n})`);
  }
  return linked;
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  requireEnv();

  const tagged = await adminQuery<TaggedOrg>(
    "select investor_org_id, name, notes from investor_organizations where notes like $1 order by name",
    [`${TAG_PREFIX}%`],
  );
  console.log(`Found ${tagged.length} tagged test-import organisation(s).\n`);
  if (tagged.length === 0) { console.log("Nothing to do."); return; }

  const removable: TaggedOrg[] = [];
  const blocked: { org: TaggedOrg; links: string[] }[] = [];

  for (const org of tagged) {
    const links = await findLinks(org.investor_org_id);
    if (links.length > 0) blocked.push({ org, links });
    else removable.push(org);
  }

  if (blocked.length > 0) {
    console.log(`BLOCKED — ${blocked.length} row(s) are linked and will NOT be deleted:`);
    for (const { org, links } of blocked) {
      console.log(`  - ${org.name} (${org.notes}): linked via ${links.join(", ")}`);
    }
    console.log();
  }

  console.log(`Removable — ${removable.length} row(s) with no links of any kind:`);
  for (const org of removable) console.log(`  - ${org.name} (${org.notes})`);

  if (!write) {
    console.log("\nDry run only — nothing deleted. Re-run with --write to delete the removable rows.");
    console.log(`(Blocked rows stay blocked until you remove the link yourself — e.g. the deal_investor row — then re-run.)`);
    return;
  }

  for (const org of removable) {
    await adminQuery("delete from platform_settings where key = $1", [org.notes]);
    await adminQuery("delete from investor_organizations where investor_org_id = $1", [org.investor_org_id]);
  }
  console.log(`\nDeleted ${removable.length} row(s) (investor_organizations + their platform_settings metadata).`);
  if (blocked.length > 0) {
    console.log(`${blocked.length} row(s) remain, still linked — see BLOCKED list above.`);
  }
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(closePool);
