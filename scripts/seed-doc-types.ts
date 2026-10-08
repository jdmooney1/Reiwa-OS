// Seed the document type catalogue (supabase/migrations/0035, docs/24).
//   npm run db:seed-doc-types
import { requireEnv } from "./env";
import { closePool } from "@/lib/db/client";
import { seedDocTypes } from "@/lib/db/seed-doc-types";

async function main(): Promise<void> {
  requireEnv();
  const result = await seedDocTypes();
  console.log(
    `doc_type catalogue: ${result.created} created, ${result.updated} updated, ` +
    `${result.skipped} unchanged (of ${result.total} total).`,
  );
  if (result.created + result.updated > 0) {
    console.log("Every write is logged to doc_type_audit (migration 0036).");
  }
}

main()
  .catch((e) => { console.error(`Seed failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
