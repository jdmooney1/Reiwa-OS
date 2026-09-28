// ============================================================================
// Load the pipeline staging workbook into Reiwa OS.
//
//   npm run db:load-pipeline -- --file <path> --org "Meiji Shipping"
//   npm run db:load-pipeline -- --file <path> --org "Meiji Shipping" --write
//
// Dry by default: it reads, resolves, reports, and rolls back. Nothing is
// committed without --write.
//
// Re-running with --write is safe and is the intended workflow: the load is
// idempotent on Ref, so triage the sheet and run it again to apply the Status,
// Priority and Triage Note columns to the rows already created.
//
// The reconciliation report goes to stdout and to a file beside the workbook.
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { requireEnv } from "./env";
import { getPool, closePool, withSessionOn, adminQuery, type Session } from "@/lib/db/client";
import { readPipelineWorkbook, isNotABuilding, type PipelineRow } from "@/lib/ingestion/pipeline-workbook";
import { loadRow, recordLoadRow, type LoadedRow, type LoadContext } from "@/lib/data/deal-load";

interface Args { file: string; org: string; write: boolean }

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = get("file");
  const org = get("org");
  if (!file) throw new Error("--file <path to the staging workbook> is required.");
  if (!org) throw new Error('--org "<organisation name>" is required.');
  return { file, org, write: argv.includes("--write") };
}

const money = (v: number | null, ccy: string | null): string =>
  v === null ? "—" : `${ccy ?? "?"} ${v.toLocaleString("en-GB")}`;

async function main(): Promise<void> {
  requireEnv();
  const args = parseArgs();

  const buffer = readFileSync(args.file);
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const workbook = await readPipelineWorkbook(buffer);

  const orgs = await adminQuery<{ org_id: string; name: string }>(
    "select org_id, name from organizations where name = $1", [args.org]);
  if (!orgs[0]) throw new Error(`No organisation named "${args.org}".`);
  const orgId = orgs[0].org_id;

  const staff = await adminQuery<{ user_id: string }>(
    "select user_id from profiles order by created_at limit 1");
  if (!staff[0]) throw new Error("No profile exists to attribute the load to.");
  const userId = staff[0].user_id;

  const pool = getPool();
  const session: Session = { userId, orgIds: [orgId], role: "reiwa_admin", canWrite: true };

  const results: LoadedRow[] = [];
  const lines: string[] = [];
  const say = (s = "") => { lines.push(s); console.log(s); };

  await withSessionOn(pool, session, async (tx) => {
    const batch = await tx.query<{ batch_id: string }>(
      `insert into deal_load_batches(org_id, source_file, source_sheet, content_hash,
         rows_read, created_by)
       values ($1,$2,'Pipeline',$3,$4,$5) returning batch_id`,
      [orgId, basename(args.file), contentHash, workbook.rows.length, userId]);
    const ctx: LoadContext = { orgId, userId, batchId: batch.rows[0].batch_id };

    for (const row of workbook.rows) {
      let result: LoadedRow;
      try {
        result = await loadRow(tx, ctx, row);
      } catch (e) {
        result = { ref: row.ref, outcome: "failed", reason: (e as Error).message };
      }
      results.push(result);
      await recordLoadRow(tx, ctx, row, result);
    }

    const count = (o: string) => results.filter((r) => r.outcome === o).length;
    await tx.query(
      `update deal_load_batches
          set rows_created = $2, rows_updated = $3, rows_skipped = $4, rows_failed = $5,
              finished_at = now()
        where batch_id = $1`,
      [ctx.batchId, count("created"), count("updated"), count("skipped"), count("failed")]);

    // ---- Report -----------------------------------------------------------
    const byRef = new Map(workbook.rows.map((r) => [r.ref, r]));
    say("=".repeat(74));
    say(`REIWA OS — PIPELINE LOAD RECONCILIATION`);
    say(`${basename(args.file)}  ·  ${args.org}  ·  ${args.write ? "WRITE" : "DRY RUN"}`);
    say("=".repeat(74));

    const untriaged = workbook.rows.filter((r) => r.triageStatus === "untriaged").length;
    say("");
    say(`  UNTRIAGED: ${untriaged} of ${workbook.rows.length}`);
    say(`  This is the load's progress measure. It falls to zero as the Status,`);
    say(`  Priority and Triage Note columns are filled in and the loader re-run.`);
    say("");

    say("-- Rows " + "-".repeat(64));
    say(`  read                 ${workbook.rows.length}`);
    say(`  created              ${count("created")}`);
    say(`  updated              ${count("updated")}`);
    say(`  failed               ${count("failed")}`);
    for (const s of ["live", "dead", "reference", "untriaged"] as const) {
      const n = workbook.rows.filter((r) => r.triageStatus === s).length;
      if (n) say(`  triage: ${s.padEnd(13)}${n}`);
    }

    // ---- Properties -------------------------------------------------------
    const props = await tx.query<{ total: string; keyed: string }>(
      `select count(*) total, count(identity_key) keyed
         from properties where org_id = $1`, [orgId]);
    const unkeyed = results.filter((r) => r.propertyUnkeyed);
    const excluded = results.filter((r) => isNotABuilding(r.ref));

    // A collapse is two rows sharing one property. It is measured against the
    // rows that actually RESOLVED a property, not against every row: an
    // excluded row creates none, and counting that as a collapse would report
    // a merge that never happened.
    const resolvedRows = results.filter((r) => r.propertyId).length;
    const propertyCount = Number(props.rows[0].total);
    const collapsed = resolvedRows - propertyCount;

    say("");
    say("-- Properties " + "-".repeat(58));
    say(`  opportunities        ${results.filter((r) => r.opportunityId).length}`);
    say(`  resolved a property  ${resolvedRows}`);
    say(`  properties           ${propertyCount}`);
    say(`  with an identity key ${props.rows[0].keyed}`);
    say(`  collapsed (shared)   ${collapsed}`);
    say(collapsed === 0
      ? "  Expected: 1:1. No address in this load collapses onto another, so every"
      : "  UNEXPECTED: a collapse means two rows resolved to one property. None is");
    say(collapsed === 0
      ? "  row that resolved a property got its own."
      : "  expected on this load — review the pairs before committing.");

    say("");
    say("-- EXCEPTIONS: rows that are 1:1 by default, not by identity " + "-".repeat(11));
    say("  These properties carry NO identity key. They will never auto-match, so a");
    say("  re-listing opens a second record and later enrichment cannot find them.");
    say("  This is deliberate: a street name with no house number identifies a");
    say("  STREET, not a building, and a false merge cannot be undone.");
    say("");
    for (const r of unkeyed) {
      const row = byRef.get(r.ref)!;
      say(`    ${r.ref.padEnd(9)} ${(row.address ?? row.name).padEnd(34)} ${row.market ?? ""}`);
    }
    if (excluded.length) {
      say("");
      say("  Excluded from property identity altogether:");
      for (const r of excluded) say(`    ${r.ref.padEnd(9)} ${r.reason}`);
    }
    say("");
    say(`  TOTAL EXCEPTIONS: ${unkeyed.length + excluded.length}`);

    // ---- Fill rates -------------------------------------------------------
    say("");
    say("-- Field fill rates " + "-".repeat(52));
    const fields: [string, (r: PipelineRow) => unknown][] = [
      ["address", (r) => r.address], ["submarket", (r) => r.submarket],
      ["strategy", (r) => r.strategy], ["broker", (r) => r.broker],
      ["date received", (r) => r.dateReceived], ["price (base)", (r) => r.priceBase],
      ["size (sqm)", (r) => r.sizeSqm], ["income (base pa)", (r) => r.incomeBase],
      ["comments", (r) => r.comments], ["gmail thread", (r) => r.gmailThreadId],
    ];
    for (const [label, pick] of fields) {
      const n = workbook.rows.filter((r) => pick(r) !== null && pick(r) !== undefined).length;
      const pct = Math.round((n / workbook.rows.length) * 100);
      say(`  ${label.padEnd(20)} ${String(n).padStart(3)}/${workbook.rows.length}  ${String(pct).padStart(3)}%`);
    }

    // ---- Money ------------------------------------------------------------
    say("");
    say("-- Currency " + "-".repeat(60));
    for (const ccy of [...new Set(workbook.rows.map((r) => r.currency))]) {
      const of = workbook.rows.filter((r) => r.currency === ccy);
      const withPrice = of.filter((r) => r.priceBase !== null);
      const total = withPrice.reduce((s, r) => s + (r.priceBase ?? 0), 0);
      say(`  ${String(ccy ?? "none").padEnd(6)} ${String(of.length).padStart(3)} deals, ` +
          `${withPrice.length} priced, total ${money(total, ccy)}`);
    }
    say(`  JPY is NOT stored. The workbook's JPY figures are display formulas over`);
    say(`  the Reference tab's FX cells (${workbook.fx.map((f) => `${f.pair} ${f.rate}`).join(", ")}).`);
    say(`  Base currency and amount are stored; JPY is converted at read time.`);

    // ---- Failures ---------------------------------------------------------
    const failed = results.filter((r) => r.outcome === "failed");
    say("");
    say("-- Failures " + "-".repeat(60));
    if (failed.length === 0) say("  none");
    for (const f of failed) say(`  ${f.ref}: ${f.reason}`);

    if (workbook.issues.length) {
      say("");
      say("-- Source issues " + "-".repeat(55));
      for (const i of workbook.issues) say(`  ${i.ref} ${i.field}: ${i.message}`);
    }

    // ---- Investor visibility ---------------------------------------------
    const published = await tx.query<{ n: string }>(
      `select count(*) n from publication_sources ps
         join opportunities o on o.opportunity_id = ps.opportunity_id
        where o.org_id = $1`, [orgId]);
    say("");
    say("-- Investor visibility " + "-".repeat(49));
    say(`  publications for these opportunities: ${published.rows[0].n}`);
    say(`  Visibility requires an explicit publication (migration 0005). This load`);
    say(`  creates none, so every record is internal-only.`);
    say("");
    say("=".repeat(74));

    if (!args.write) {
      say("DRY RUN — rolling back. Re-run with --write to commit.");
      throw new RollBack();
    }
    say("COMMITTED.");
  }).catch((e) => { if (!(e instanceof RollBack)) throw e; });

  const out = join(dirname(args.file), `load-report-${new Date().toISOString().slice(0, 10)}.txt`);
  writeFileSync(out, lines.join("\n"), "utf8");
  console.log(`\nReport written to ${out}`);
}

/** Sentinel used to roll back a dry run without reporting an error. */
class RollBack extends Error {}

main()
  .catch((e) => { console.error(`Load failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
