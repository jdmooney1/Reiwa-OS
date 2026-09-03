// Provision the demo Supabase Auth accounts and seed demonstration data.
// No-op when the database already holds organisations.
//   npm run db:seed
import { requireEnv } from "./env";
import { closePool, adminQuery } from "@/lib/db/client";
import { seedIfEmpty, SEED_ACCOUNTS } from "@/lib/db/seed";

async function main(): Promise<void> {
  requireEnv();
  const seeded = await seedIfEmpty();
  if (!seeded) {
    console.log("Database already seeded — nothing written.");
  } else {
    console.log(`Seeded ${SEED_ACCOUNTS.length} Supabase Auth accounts and the demonstration data.`);
  }
  const counts = await adminQuery<{ orgs: number; assets: number; opportunities: number; profiles: number }>(
    `select (select count(*)::int from organizations) as orgs,
            (select count(*)::int from assets) as assets,
            (select count(*)::int from opportunities) as opportunities,
            (select count(*)::int from profiles) as profiles`,
  );
  console.log(
    `organizations=${counts[0].orgs} profiles=${counts[0].profiles} ` +
    `opportunities=${counts[0].opportunities} assets=${counts[0].assets}`,
  );
}

main()
  .catch((e) => { console.error(`Seed failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
