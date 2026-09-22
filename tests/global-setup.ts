// Integration tests run against a Supabase Postgres — a local `supabase start`
// stack by default, or whatever DATABASE_URL points at. The schema is dropped,
// migrated and seeded once per run, with the FICTIONAL multi-tenant fixtures:
// isolation can only be proved against more than one organisation, and the real
// Reiwa fixtures are a single firm by design.
import "../scripts/env";
import { requireEnv } from "../scripts/env";
import { closePool } from "@/lib/db/client";
import { resetDatabase } from "@/lib/db/reset";

export default async function setup(): Promise<void> {
  requireEnv();
  const host = new URL(process.env.DATABASE_URL!).host;
  console.log(`[tests] resetting integration database on ${host}`);
  const applied = await resetDatabase(undefined, "demo");
  console.log(`[tests] applied ${applied.length} migration(s), seeded demonstration data`);
  await closePool();
}
