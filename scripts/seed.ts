// Provision the demo Supabase Auth accounts and seed demonstration data.
// No-op when the database already holds organisations.
//   npm run db:seed
import { requireEnv } from "./env";
import { installFailureHandlers, reportFailure } from "./fail";
import { closePool, adminQuery } from "@/lib/db/client";
import { seedIfEmpty, SEED_ACCOUNTS } from "@/lib/db/seed";

installFailureHandlers("Seed");

async function main(): Promise<void> {
  requireEnv();
  const seeded = await seedIfEmpty();
  if (!seeded) {
    console.log("Database already seeded — nothing written.");
  } else {
    console.log(`Seeded ${SEED_ACCOUNTS.length} Supabase Auth accounts and the demonstration data.`);
  }
  const counts = await adminQuery<{
    orgs: number; assets: number; opportunities: number; profiles: number;
    investor_orgs: number; investor_contacts: number; publications: number; entitlements: number;
  }>(
    `select (select count(*)::int from organizations) as orgs,
            (select count(*)::int from assets) as assets,
            (select count(*)::int from opportunities) as opportunities,
            (select count(*)::int from profiles) as profiles,
            (select count(*)::int from investor_organizations) as investor_orgs,
            (select count(*)::int from investor_contacts) as investor_contacts,
            (select count(*)::int from investor_publications) as publications,
            (select count(*)::int from publication_entitlements) as entitlements`,
  );
  const c = counts[0];
  console.log(
    `organizations=${c.orgs} profiles=${c.profiles} ` +
    `opportunities=${c.opportunities} assets=${c.assets}`,
  );
  console.log(
    `portal: investor_organizations=${c.investor_orgs} investor_contacts=${c.investor_contacts} ` +
    `publications=${c.publications} entitlements=${c.entitlements}`,
  );
}

main()
  .catch((e) => reportFailure("Seed", e))
  .finally(closePool);
