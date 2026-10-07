// Give every publication document its own stored file, then enforce it with a unique index.
//   npm run db:unshare-documents               dry run: says what it would do, changes nothing
//   npm run db:unshare-documents -- --apply    copies the files, re-points the rows, adds the index
//
// The row on the oldest version keeps the original path; every other row gets a copy. See
// src/lib/documents/ownership.ts and docs/25.
import { requireEnv } from "./env";
import { getPool, closePool } from "@/lib/db/client";
import { unshareDocuments } from "@/lib/documents/ownership";

async function main(): Promise<void> {
  requireEnv();
  const apply = process.argv.includes("--apply");
  console.log(`Database: ${new URL(process.env.DATABASE_URL!).host}  (${apply ? "APPLYING" : "dry run"})`);
  const report = await unshareDocuments(getPool(), { apply });
  console.log(`Shared files found: ${report.groups}`);
  for (const r of report.repointed) console.log(`  v${r.versionNumber} "${r.title}"\n    ${r.from}\n -> ${r.to}`);
  for (const u of report.unrepairable) console.log(`  CANNOT REPAIR v${u.versionNumber} "${u.title}": the file ${u.path} is already missing`);
  if (apply) console.log(report.indexCreated ? "Unique index on storage_path is in place." : "Unique index NOT created (shared rows remain).");
  else if (report.groups > 0) console.log("\nNothing changed. Re-run with -- --apply to repair.");
}

main().catch((e) => { console.error(`Unshare failed: ${(e as Error).message}`); process.exitCode = 1; }).finally(closePool);
