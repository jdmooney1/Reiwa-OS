#!/usr/bin/env node
// ============================================================================
// Apply supabase/migrations to the database at DATABASE_URL (hosted Supabase
// or any Postgres). Ordered, idempotent (tracked in _migrations), one
// transaction per file. Developer machines may equivalently use the Supabase
// CLI; this script exists for environments without the CLI/Docker.
// Never applies the dev auth shim: hosted Supabase provides the auth schema.
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (Supabase: use the transaction pooler string).");
  process.exit(1);
}

const local = /localhost|127\.0\.0\.1/.test(url);
const client = new pg.Client({
  connectionString: url,
  ssl: local ? undefined : { rejectUnauthorized: false },
});
await client.connect();

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

await client.query(`create table if not exists _migrations (
  name text primary key, applied_at timestamptz not null default now());`);

let applied = 0;
for (const name of files) {
  const seen = await client.query("select 1 from _migrations where name = $1", [name]);
  if (seen.rowCount > 0) { console.log(`= ${name} (already applied)`); continue; }
  const sql = readFileSync(join(dir, name), "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into _migrations(name) values ($1)", [name]);
    await client.query("commit");
    console.log(`+ ${name}`);
    applied++;
  } catch (e) {
    await client.query("rollback");
    console.error(`! ${name} FAILED: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}
console.log(`Done. ${applied} migration(s) applied, ${files.length - applied} already current.`);
await client.end();
