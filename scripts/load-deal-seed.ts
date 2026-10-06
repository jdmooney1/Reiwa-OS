// ============================================================================
// Load structured deal records (broker IMs, already read) as DRAFT opportunities.
//
//   npm run db:load-deal-seed -- --file <deals.json> --org "Meiji Shipping" --user <email|profile id>
//   npm run db:load-deal-seed -- --file <deals.json> --org "..." --user <...> --write
//   ... --allow-existing     write a deal even though one already exists for the same building
//
// DRY BY DEFAULT: it reads, resolves, reports, and rolls back. Nothing is committed without
// --write. Re-running with --write is safe: it only fills fields that are still empty, so a
// deal a person has since edited in the app is left as they left it.
//
// What lands: an opportunity (stage new, untriaged, owned by nobody), its building facts on the
// property, its money on a version-1 investment case, and a "first seen" event. What does NOT:
// a publication, an entitlement, a photograph or a memo. Nothing is investor-visible.
//
// A deal is HELD, not written, if an opportunity for the same building (or one with a
// near-identical name) is already in the pipeline. That is reported with the existing record's
// broker and price, so a person can decide; --allow-existing overrides it.
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { requireEnv } from "./env";
import { getPool, closePool, withSessionOn, adminQuery, type Session } from "@/lib/db/client";
import { parseUserRef, type UserRef } from "@/lib/ingestion/user-ref";
import { parseDealSeed } from "@/lib/ingestion/deal-seed";
import { seedDeal, type SeededDeal } from "@/lib/data/deal-seed";

interface Args { file: string; org: string; user?: UserRef; write: boolean; allowExisting: boolean }

class RollBack extends Error {}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const file = get("file"), org = get("org"), user = get("user");
  if (!file) throw new Error("--file <path to the deals JSON> is required.");
  if (!org) throw new Error('--org "<organisation name>" is required.');
  return {
    file, org, user: user === undefined ? undefined : parseUserRef(user),
    write: argv.includes("--write"), allowExisting: argv.includes("--allow-existing"),
  };
}

const money = (n: number | null) => (n === null ? "-" : `GBP ${n.toLocaleString("en-GB")}`);

async function main(): Promise<void> {
  requireEnv();
  const args = parseArgs();

  const buffer = readFileSync(args.file);
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const rawFile = JSON.parse(buffer.toString("utf8")) as { deals: unknown[] };
  const deals = parseDealSeed(rawFile); // throws, listing every problem, before anything is touched

  const orgs = await adminQuery<{ org_id: string }>("select org_id from organizations where name = $1", [args.org]);
  if (!orgs[0]) throw new Error(`No organisation named "${args.org}".`);
  const orgId = orgs[0].org_id;

  let staff: { user_id: string }[];
  if (args.user) {
    staff = args.user.kind === "id"
      ? await adminQuery("select user_id from profiles where user_id = $1", [args.user.value])
      : await adminQuery("select user_id from profiles where lower(email) = $1", [args.user.value]);
    if (staff.length === 0) throw new Error(`No profile matches --user ${args.user.value}.`);
    if (staff.length > 1) throw new Error(`--user ${args.user.value} matches ${staff.length} profiles; use the profile id.`);
  } else {
    staff = await adminQuery("select user_id from profiles order by created_at limit 1");
    if (!staff[0]) throw new Error("No profile exists to attribute the load to.");
    console.warn("No --user given: attributing the load to the oldest profile.");
  }
  const userId = staff[0].user_id;
  const session: Session = { userId, orgIds: [orgId], role: "reiwa_admin", canWrite: true };

  const lines: string[] = [];
  const say = (s = "") => { lines.push(s); console.log(s); };
  const results: SeededDeal[] = [];

  await withSessionOn(getPool(), session, async (tx) => {
    const batch = await tx.query<{ batch_id: string }>(
      `insert into deal_load_batches(org_id, source_file, source_sheet, content_hash, rows_read, created_by)
       values ($1,$2,'deal-seed',$3,$4,$5) returning batch_id`,
      [orgId, basename(args.file), contentHash, deals.length, userId]);
    const batchId = batch.rows[0].batch_id;
    const ctx = { orgId, userId, allowExisting: args.allowExisting };

    for (const [i, deal] of deals.entries()) {
      let r: SeededDeal;
      try {
        r = await seedDeal(tx, ctx, deal);
      } catch (e) {
        await tx.query("rollback to savepoint seed_deal").catch(() => undefined);
        say(`  FAILED ${deal.reference}: ${(e as Error).message}`);
        throw e; // a deal that cannot be loaded stops the run: nothing half-written
      }
      results.push(r);
      await tx.query(
        `insert into deal_load_rows(org_id, batch_id, reference, raw_row, outcome, reason, opportunity_id, property_id, property_unkeyed)
         values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)`,
        [orgId, batchId, deal.reference, JSON.stringify(rawFile.deals[i]),
         r.outcome === "held" ? "skipped" : r.outcome,
         r.outcome === "held" ? `held: ${r.collisions.map((c) => `${c.why} ${c.reference ?? c.opportunityId}`).join("; ")}` : null,
         r.opportunityId ?? null, r.propertyId ?? null, r.propertyUnkeyed ?? false]);
    }
    const n = (o: string) => results.filter((r) => r.outcome === o).length;
    await tx.query(
      `update deal_load_batches set rows_created=$2, rows_updated=$3, rows_skipped=$4, finished_at=now() where batch_id=$1`,
      [batchId, n("created"), n("updated"), n("held")]);

    // ---- Report ----
    say("=".repeat(74));
    say("REIWA OS - DEAL SEED RECONCILIATION");
    say(`${basename(args.file)}  .  ${args.org}  .  ${args.write ? "WRITE" : "DRY RUN"}`);
    say("=".repeat(74));
    say(`  read ${deals.length}   created ${n("created")}   updated ${n("updated")}   HELD ${n("held")}`);
    say("");
    for (const [i, d] of deals.entries()) {
      const r = results[i];
      say(`-- ${d.name}  [${d.reference}]  ${r.outcome.toUpperCase()}`);
      say(`   stage ${d.dealStage ?? "-"}  .  ${d.assetType}  .  ${d.sizeSqft ?? "-"} sq ft  .  price ${money(d.money.guidePrice)}  .  NIY ${d.money.niyPct ?? "-"}%  .  passing ${money(d.money.passingRent)}`);
      const p = d.property;
      say(`   tenure ${p.tenure ?? "-"}  term ${p.unexpiredTermYears ?? "-"}  heritage ${p.heritageStatus ?? "-"}  EPC ${p.epcRating ?? "-"}  WAULT ${p.waultToExpiryYears ?? "-"}/${p.waultToBreaksYears ?? "-"}  covenant ${p.covenantRating ?? "-"}`);
      say(`   photo ${d.photo.type ?? "(not looked at)"}${d.photo.url ? ` ${d.photo.url}` : ""}${d.photo.attachments.length ? ` [${d.photo.attachments.join("; ")}]` : ""}`);
      say(`   broker ${d.brokerName ?? "-"} / ${d.sourceContactName ?? "-"}  .  completeness: ${d.dataCompleteness ?? "-"}`);
      if (r.propertyUnkeyed) say("   property: no identity key (no house number in the address); recorded 1:1 and cannot be matched to another record by address");
      for (const f of d.flags) say(`   FLAG ${f.code}: ${f.message}`);
      for (const c of r.collisions) {
        say(`   ${r.outcome === "held" ? "HELD BECAUSE" : "NOTE"} an opportunity already exists (${c.why}): "${c.name}" [${c.reference ?? "no ref"}] broker ${c.brokerName ?? "-"} price ${money(c.price)}`);
      }
      say("");
    }

    // ---- Investor reachability, measured, not assumed ----
    const ids = results.flatMap((r) => (r.opportunityId ? [r.opportunityId] : []));
    const pub = await tx.query<{ n: string }>(
      "select count(*)::text as n from publication_sources where opportunity_id = any($1::uuid[])", [ids]);
    say("-- Investor visibility " + "-".repeat(50));
    say(`  publications referencing these deals: ${pub.rows[0].n}  (an investor can see a deal only through one)`);
    say("");

    if (!args.write) {
      say("DRY RUN - rolling back. Re-run with --write to commit.");
      throw new RollBack();
    }
    say("COMMITTED.");
  }).catch((e) => { if (!(e instanceof RollBack)) throw e; });

  writeFileSync(args.file.replace(/\.json$/i, "") + ".load-report.txt", lines.join("\n"), "utf8");
}

main()
  .catch((e) => { console.error(`Load failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
