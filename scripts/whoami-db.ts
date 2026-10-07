// ============================================================================
// Which database does .env.local's DATABASE_URL point at? Read-only and,
// more importantly, CONNECTION-FREE: this parses the configured connection
// strings offline and opens no socket at all, so it is always safe to run
// first — before a migration, a seed, an import, or anything else that
// could touch a real database.
//
//   npx tsx scripts/whoami-db.ts
//
// Never prints a password or a secret key — only the project ref (the
// subdomain of the Supabase API URL / the suffix of the Postgres username),
// which is not sensitive (it is the same string visible in the dashboard
// URL), plus the host, port and database name.
// ============================================================================
import "./env"; // loads .env.local as a side effect; never throws on missing vars
import { projectRefFromApiUrl, projectRefFromDatabaseUrl } from "@/lib/supabase/project-ref";

function main(): void {
  const dbUrl = process.env.DATABASE_URL;
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!dbUrl) {
    console.log("DATABASE_URL is not set in .env.local (or .env).");
    return;
  }

  let u: URL;
  try {
    u = new URL(dbUrl);
  } catch {
    console.log("DATABASE_URL is set but is not a valid connection URL.");
    return;
  }

  const dbRef = projectRefFromDatabaseUrl(dbUrl);
  const apiRef = projectRefFromApiUrl(apiUrl);

  console.log("DATABASE_URL (password never shown):");
  console.log(`  host:     ${u.hostname}`);
  console.log(`  port:     ${u.port || "(default)"}`);
  console.log(`  database: ${u.pathname.slice(1) || "(none)"}`);
  console.log(`  project ref (from the username): ${dbRef ?? "(none — a direct, non-pooler connection carries no ref)"}`);
  console.log();
  console.log(`NEXT_PUBLIC_SUPABASE_URL project ref: ${apiRef ?? "(none / not set)"}`);
  console.log();

  if (dbRef && apiRef) {
    if (dbRef === apiRef) {
      console.log(`Consistent: both point at project "${dbRef}".`);
    } else {
      console.log(`MISMATCH: DATABASE_URL's project is "${dbRef}", NEXT_PUBLIC_SUPABASE_URL's is "${apiRef}".`);
      console.log("Stop and fix .env.local before running anything else — these two must name the same project.");
    }
  } else {
    console.log("Could not determine one or both project refs from the configured URLs — check .env.local by eye before proceeding.");
  }
}

main();
