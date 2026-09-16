// ============================================================================
// Key the properties that existed before migration 0012.
//   npm run db:backfill-property-identity          report only
//   npm run db:backfill-property-identity -- --write   apply
// ----------------------------------------------------------------------------
// Migration 0012 deliberately does not compute identity_key. The key comes from
// src/lib/ingestion/normalise.ts — street-type expansion, unit and floor noise
// removal, accent folding — and reimplementing that in SQL would create a
// second normaliser to drift from the first. Two implementations of an identity
// rule are worse than one applied late.
//
// COLLISIONS ARE REPORTED, NEVER MERGED. Two existing rows that normalise to the
// same key are a pre-existing duplicate: the same building recorded twice,
// each half potentially carrying its own opportunities, documents and history.
// Choosing one and keying it would make the other permanently unmatchable;
// keying both is impossible under the unique index. Which row survives, and
// what happens to what hangs off the other, is a decision about the record —
// so this script names them and stops, in the posture migration 0010 took on
// authorship.
//
// Dry by default: it prints what it would do and changes nothing unless asked.
// ============================================================================
import { requireEnv } from "./env";
import { adminQuery, closePool } from "@/lib/db/client";
import { propertyIdentityKey, normaliseAddress, normalisePostcode } from "@/lib/ingestion/normalise";

interface Row {
  property_id: string;
  org_id: string;
  name: string;
  address: string | null;
  postcode: string | null;
  city: string | null;
}

async function main(): Promise<void> {
  requireEnv();
  const write = process.argv.includes("--write");

  const rows = await adminQuery<Row>(
    `select property_id, org_id, name, address, postcode, city
       from properties
      where identity_key is null
      order by org_id, created_at`);

  if (rows.length === 0) {
    console.log("Every property already carries an identity key. Nothing to do.");
    return;
  }

  // Key each row, then group by (org, key) to find collisions before writing.
  const keyed = new Map<string, Row[]>();
  const unkeyable: Row[] = [];

  for (const row of rows) {
    const key = propertyIdentityKey({
      address: row.address,
      postcode: normalisePostcode(row.postcode) ?? normalisePostcode(row.address),
      name: row.name,
      city: row.city,
    });
    if (!key) { unkeyable.push(row); continue; }
    const bucket = `${row.org_id}|${key}`;
    if (!keyed.has(bucket)) keyed.set(bucket, []);
    keyed.get(bucket)!.push(row);
  }

  // A key already held by a row this script is not touching also collides.
  const proposed = [...keyed.keys()].map((b) => b.split("|").slice(1).join("|"));
  const taken = proposed.length === 0 ? [] : await adminQuery<{ org_id: string; identity_key: string }>(
    "select org_id, identity_key from properties where identity_key = any($1::text[])",
    [proposed]);
  const takenSet = new Set(taken.map((t) => `${t.org_id}|${t.identity_key}`));

  const clean: { row: Row; key: string }[] = [];
  const collisions: { key: string; rows: Row[]; againstExisting: boolean }[] = [];

  for (const [bucket, group] of keyed) {
    const key = bucket.split("|").slice(1).join("|");
    const alreadyTaken = takenSet.has(bucket);
    if (group.length > 1 || alreadyTaken) {
      collisions.push({ key, rows: group, againstExisting: alreadyTaken });
    } else {
      clean.push({ row: group[0], key });
    }
  }

  console.log(`Properties without an identity key: ${rows.length}`);
  console.log(`  keyable and unique:        ${clean.length}`);
  console.log(`  too little detail to key:  ${unkeyable.length}`);
  console.log(`  collisions needing a decision: ${collisions.length}`);

  if (unkeyable.length > 0) {
    console.log(
      `\nLeft unkeyed — these carry no address detail that identifies a building.\n` +
      `They will never auto-match, which is the safe direction; add an address to key them.`);
    for (const row of unkeyable.slice(0, 10)) {
      console.log(`  - ${row.name}${row.city ? ` (${row.city})` : ""}  [${row.property_id}]`);
    }
    if (unkeyable.length > 10) console.log(`  ... and ${unkeyable.length - 10} more`);
  }

  if (collisions.length > 0) {
    console.log(
      `\nNOT KEYED — these normalise to a key another property already holds.\n` +
      `Each is the same building recorded more than once. Decide which row survives\n` +
      `and what moves to it, then re-run. This script will not choose for you: the\n` +
      `row it declined to key would become permanently unmatchable.`);
    for (const c of collisions) {
      console.log(`\n  key ${c.key}${c.againstExisting ? "  (also held by an already-keyed row)" : ""}`);
      for (const row of c.rows) {
        const detail = [row.address, row.city].filter(Boolean).join(", ");
        console.log(`    - ${row.name}${detail ? ` — ${detail}` : ""}  [${row.property_id}]`);
      }
    }
  }

  if (!write) {
    console.log(
      `\nDry run. Nothing was changed.\n` +
      `Re-run with --write to key the ${clean.length} unique propert${clean.length === 1 ? "y" : "ies"}.`);
    return;
  }

  for (const { row, key } of clean) {
    await adminQuery(
      `update properties
          set identity_key = $2,
              postcode = coalesce(postcode, $3),
              address_normalised = coalesce(address_normalised, $4)
        where property_id = $1`,
      [row.property_id, key,
       normalisePostcode(row.postcode) ?? normalisePostcode(row.address),
       normaliseAddress(row.address) || null]);
  }

  console.log(`\nKeyed ${clean.length} propert${clean.length === 1 ? "y" : "ies"}.`);
  if (collisions.length > 0) {
    console.log(`${collisions.length} collision(s) remain and still need a decision.`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error(`Backfill failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
