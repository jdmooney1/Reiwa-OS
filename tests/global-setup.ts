// Integration tests run against the real Supabase Postgres in .env.local.
// The schema is dropped, migrated and seeded once per `vitest run`.
import "../scripts/env";
import { requireEnv } from "../scripts/env";
import { closePool } from "@/lib/db/client";
import { resetDatabase } from "@/lib/db/reset";

export default async function setup(): Promise<void> {
  requireEnv();
  const host = new URL(process.env.DATABASE_URL!).host;
  console.log(`[tests] resetting integration database on ${host}`);
  const applied = await resetDatabase();
  console.log(`[tests] applied ${applied.length} migration(s), seeded demonstration data`);
  await closePool();
}
