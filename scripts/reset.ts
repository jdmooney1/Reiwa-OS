// DESTRUCTIVE: drop the application schema, re-migrate and re-seed.
// Development databases only. Requires --yes to run.
//   npm run db:reset -- --yes
import { requireEnv } from "./env";
import { installFailureHandlers, reportFailure } from "./fail";
import { closePool } from "@/lib/db/client";
import { resetDatabase } from "@/lib/db/reset";

installFailureHandlers("Reset");

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
  const applied = await resetDatabase();
  console.log(`Re-applied ${applied.length} migration(s); demonstration data seeded.`);
}

main()
  .catch((e) => reportFailure("Reset", e))
  .finally(closePool);
