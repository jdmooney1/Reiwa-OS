// Seed Reiwa Capital and its four reference deals into an empty database.
// Every figure on those deals is deliberately absent — see src/lib/db/fixtures.ts.
// No-op when the database already holds organisations.
//
// Pass --demo to load the fictional multi-tenant fixtures instead. Those exist
// to prove row-level isolation and belong in a test database, never a real one.
//   npm run db:seed
//   npm run db:seed -- --demo
import { requireEnv } from "./env";
import { closePool, adminQuery } from "@/lib/db/client";
import { seedIfEmpty, type FixtureSet } from "@/lib/db/reset";
import { REIWA_FIXTURES, REIWA_ADMIN_EMAIL } from "@/lib/db/fixtures";
import { SEED_ACCOUNTS } from "@/lib/db/seed";

async function main(): Promise<void> {
  requireEnv();
  const fixtures: FixtureSet = process.argv.includes("--demo") ? "demo" : "reiwa";
  const seeded = await seedIfEmpty(undefined, fixtures);

  if (!seeded) {
    console.log("Database already holds organisations — nothing written.");
  } else if (fixtures === "demo") {
    console.log(`Seeded ${SEED_ACCOUNTS.length} Supabase Auth accounts and the fictional test fixtures.`);
  } else {
    console.log(
      `Seeded Reiwa Capital, the account ${REIWA_ADMIN_EMAIL} and ` +
      `${REIWA_FIXTURES.length} reference deals. All figures are TBC by design.`,
    );
  }

  const counts = await adminQuery<{
    orgs: number; assets: number; opportunities: number; profiles: number; decisions: number;
  }>(
    `select (select count(*)::int from organizations) as orgs,
            (select count(*)::int from assets) as assets,
            (select count(*)::int from opportunities) as opportunities,
            (select count(*)::int from profiles) as profiles,
            (select count(*)::int from decision_log) as decisions`,
  );
  const c = counts[0];
  console.log(
    `organizations=${c.orgs} profiles=${c.profiles} ` +
    `opportunities=${c.opportunities} assets=${c.assets} decisions=${c.decisions}`,
  );
}

main()
  .catch((e) => { console.error(`Seed failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
