// Load Reiwa Capital's live deal pipeline into Reiwa OS. Safe to re-run.
//   npm run db:import-pipeline                          # import
//   npm run db:import-pipeline -- --dry-run             # preview only, writes nothing
//   npm run db:import-pipeline -- --owner you@firm.com  # set owner + org membership
import { requireEnv } from "./env";
import { closePool, getPool } from "@/lib/db/client";
import { buildPipeline, importPipeline, REIWA_ORG_NAME } from "@/lib/pipeline/import";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const ownerEmail = arg("--owner");
  const records = buildPipeline();

  const by = (k: "market" | "stage" | "status") =>
    Object.entries(records.reduce<Record<string, number>>((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {}))
      .map(([key, n]) => `${key}=${n}`).join(" ");
  console.log(`${records.length} opportunities prepared`);
  console.log(`  market: ${by("market")}`);
  console.log(`  stage:  ${by("stage")}`);
  console.log(`  status: ${by("status")}`);
  if (dryRun) { console.log("Dry run - nothing written."); return; }

  requireEnv();
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const db = { query: async <T>(sql: string, params: unknown[] = []) => ({ rows: (await client.query(sql, params)).rows as T[] }), exec: (sql: string) => client.query(sql) };

    let ownerUserId: string | null = null;
    let ownerRole: string | null = null;
    if (ownerEmail) {
      const p = (await client.query("select user_id, global_role from profiles where email = $1", [ownerEmail])).rows[0];
      if (!p) throw new Error(`No Reiwa OS profile for ${ownerEmail} - sign in once first, or omit --owner`);
      ownerUserId = p.user_id; ownerRole = p.global_role;
    }

    const res = await importPipeline(db, records, { ownerUserId });

    if (ownerUserId && ownerRole !== "reiwa_admin") {
      await client.query(
        `insert into organization_members(org_id, user_id, role) select $1, $2, 'manager'
         where not exists (select 1 from organization_members where org_id = $1 and user_id = $2)`,
        [res.orgId, ownerUserId]);
    }
    await client.query("commit");
    console.log(`${REIWA_ORG_NAME} org ${res.orgCreated ? "created" : "found"} (${res.orgId})`);
    console.log(`inserted=${res.inserted} updated=${res.updated}`);
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

main()
  .catch((e) => { console.error(`Pipeline import failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
