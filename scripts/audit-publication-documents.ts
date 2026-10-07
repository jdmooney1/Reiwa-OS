// Read-only: which publication documents share a stored file, and which stored files are missing.
//   npm run db:audit-documents
import { requireEnv } from "./env";
import { getPool, closePool } from "@/lib/db/client";
import { findSharedDocuments, findMissingObjects } from "@/lib/documents/ownership";

async function main(): Promise<void> {
  requireEnv();
  console.log(`Database: ${new URL(process.env.DATABASE_URL!).host}`);
  const pool = getPool();
  const shared = await findSharedDocuments(pool);
  console.log(`\nShared files: ${shared.length}`);
  for (const g of shared) {
    console.log(`  ${g.keep.storagePath}`);
    console.log(`    keeps    v${g.keep.versionNumber} (${g.keep.versionStatus}) "${g.keep.title}"`);
    for (const r of g.repoint) console.log(`    shared   v${r.versionNumber} (${r.versionStatus}) "${r.title}"`);
  }
  const missing = await findMissingObjects(pool);
  console.log(`\nDocuments whose stored file is missing: ${missing.length}`);
  for (const m of missing) console.log(`  v${m.versionNumber} (${m.versionStatus}) "${m.title}"  ${m.storagePath}`);
  if (shared.length === 0 && missing.length === 0) console.log("\nNothing to repair.");
}

main().catch((e) => { console.error(`Audit failed: ${(e as Error).message}`); process.exitCode = 1; }).finally(closePool);
