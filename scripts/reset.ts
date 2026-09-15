// DESTRUCTIVE: drop the application schema, re-migrate and re-seed.
//   npm run db:reset -- --yes
//
// TWO things must be true, and --yes is only one of them. The other is that the
// target database carries `app.destructive_reset_allowed = 'true'`, which it can
// only have because somebody set it there deliberately. Confirming at a terminal
// says you meant to run the command; it says nothing about which database
// DATABASE_URL is pointed at right now, and that is the failure that costs data.
//
// Nothing else is accepted as evidence of disposability — not the project name,
// not the hostname, not "dev" in the connection string, not localhost.
// See docs/19-test-database-safety.md.
import { requireEnv } from "./env";
import { closePool } from "@/lib/db/client";
import { resetDatabase, authorizeOperatorReset } from "@/lib/db/reset";

async function main(): Promise<void> {
  requireEnv();
  const connectionString = process.env.DATABASE_URL!;
  const host = new URL(connectionString).host;

  if (!process.argv.includes("--yes")) {
    console.error(
      `Refusing to reset ${host} without confirmation.\n` +
      `This DROPS every application table. Re-run with:  npm run db:reset -- --yes`,
    );
    process.exitCode = 1;
    return;
  }

  // Asks the database itself. Throws before a single DROP if it has not been
  // marked disposable.
  const authorization = await authorizeOperatorReset(true, connectionString);

  console.log(`Resetting application schema on ${host} …`);
  const applied = await resetDatabase(authorization);
  console.log(`Re-applied ${applied.length} migration(s); demonstration data seeded.`);
}

main()
  .catch((e) => { console.error(`Reset failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
