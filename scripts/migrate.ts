// Apply pending migrations to the configured Supabase database.
//   npm run db:migrate
import { requireEnv } from "./env";
import { runMigrations, closePool, adminQuery } from "@/lib/db/client";

async function main(): Promise<void> {
  requireEnv();
  const host = new URL(process.env.DATABASE_URL!).host;
  console.log(`Applying migrations to ${host} …`);
  const applied = await runMigrations();
  if (applied.length === 0) console.log("Already up to date — no migrations applied.");
  else for (const name of applied) console.log(`  applied ${name}`);

  const ledger = await adminQuery<{ name: string; applied_at: string }>(
    "select name, applied_at from app._migrations order by name",
  );
  console.log(`Ledger (${ledger.length}): ${ledger.map((r) => r.name).join(", ")}`);
}

main()
  .catch((e) => { console.error(`Migration failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
