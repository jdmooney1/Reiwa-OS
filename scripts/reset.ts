// DESTRUCTIVE: drop the application schema, re-migrate and re-seed.
// Development databases only. Requires --yes to run.
//   npm run db:reset -- --yes
import { requireEnv } from "./env";
import { closePool } from "@/lib/db/client";
import { resetDatabase, authorizeOperatorReset } from "@/lib/db/reset";

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
  console.log(`Resetting application schema on ${host} …`);
  // The operator's --yes IS the authorisation here. This path is unchanged in
  // substance: it resets DATABASE_URL, deliberately, because a person asked it
  // to at a terminal. The automated suites cannot reach it — they have no way
  // to pass --yes, and they go through the test-database gate instead.
  const applied = await resetDatabase(authorizeOperatorReset(true, host));
  console.log(`Re-applied ${applied.length} migration(s); demonstration data seeded.`);
}

main()
  .catch((e) => { console.error(`Reset failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
