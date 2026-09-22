// DESTRUCTIVE: drop the application schema, re-migrate and re-seed.
// Development databases only. Requires --yes to run.
//
// Reseeds with Reiwa Capital's four reference deals. Pass --demo for the
// fictional multi-tenant fixtures the integration tests use.
//   npm run db:reset -- --yes
//   npm run db:reset -- --yes --demo
import { requireEnv } from "./env";
import { closePool } from "@/lib/db/client";
import { resetDatabase, type FixtureSet } from "@/lib/db/reset";

async function main(): Promise<void> {
  requireEnv();
  const host = new URL(process.env.DATABASE_URL!).host;
  if (!process.argv.includes("--yes")) {
    console.error(
      `Refusing to reset ${host} without confirmation.\n` +
      `This DROPS every application table. Re-run with:  npm run db:reset -- --yes`,
    );
    process.exitCode = 1;
    return;
  }
  const fixtures: FixtureSet = process.argv.includes("--demo") ? "demo" : "reiwa";
  console.log(`Resetting application schema on ${host} …`);
  const applied = await resetDatabase(undefined, fixtures);
  console.log(`Re-applied ${applied.length} migration(s); ${fixtures} fixtures seeded.`);
}

main()
  .catch((e) => { console.error(`Reset failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
