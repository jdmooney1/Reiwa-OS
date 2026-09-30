// ============================================================================
// Find the Street View panorama for each located property, and remember its ID.
//   npm run db:resolve-street-view                 dry run
//   npm run db:resolve-street-view -- --write      record the panorama ids
//   npm run db:resolve-street-view -- --recheck-none   also re-ask properties that had no coverage
//   npm run db:resolve-street-view -- --limit 10
// ----------------------------------------------------------------------------
// STORES ONLY THE PANORAMA ID (properties.street_view_pano_id) and a timestamp.
// Google forbids storing Street View imagery and permits keeping a panorama ID
// indefinitely. No image is fetched by this script at all - it uses the
// metadata endpoint, which is free and says whether coverage exists - and the
// picture itself is fetched live when someone looks at it
// (src/app/api/property-photo/[propertyId]/route.ts).
//
// Because the metadata endpoint costs nothing, a dry run calls it and reports
// what it found; it writes no row.
//
// It needs a LOCATION to search, and the location must still be inside Google's
// 30-day limit (src/lib/geo/freshness.ts): only properties with a fresh, `ok`
// geocode are looked up. Run db:geocode-properties first. The coordinates are
// used to ask and are not kept beyond what geocoding already holds.
//
// Idempotent: only properties never asked about are selected. A failed lookup
// writes nothing, so it is asked again next time; "no coverage" IS recorded so it
// is not asked about on every run.
// ============================================================================
import { requireEnv } from "./env";
import { adminQuery, closePool } from "@/lib/db/client";
import { lookupPano } from "@/lib/geo/street-view";
import { geocodeCutoff } from "@/lib/geo/freshness";

interface Row {
  property_id: string;
  name: string;
  address: string | null;
  latitude: string;
  longitude: string;
  street_view_pano_id: string | null;
}

const PAUSE_MS = 80;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  requireEnv();
  if (!process.env.GOOGLE_MAPS_SERVER_KEY) {
    throw new Error("GOOGLE_MAPS_SERVER_KEY is not set. Add it to .env.local (server-only; never a NEXT_PUBLIC_ variable).");
  }
  const write = process.argv.includes("--write");
  const recheckNone = process.argv.includes("--recheck-none");
  const li = process.argv.indexOf("--limit");
  const limit = li >= 0 ? Number(process.argv[li + 1]) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive whole number.");
  const cutoff = geocodeCutoff().toISOString();

  const counts = await adminQuery<{ located: string; unlocated: string; expired: string }>(
    `select count(*) filter (where geocode_status = 'ok' and latitude is not null and geocoded_at >= $1::timestamptz) located,
            count(*) filter (where not (geocode_status = 'ok' and latitude is not null)) unlocated,
            count(*) filter (where geocode_status = 'ok' and geocoded_at < $1::timestamptz) expired
       from properties`, [cutoff]);

  const rows = await adminQuery<Row>(
    `select property_id, name, address, latitude::text, longitude::text, street_view_pano_id
       from properties
      where geocode_status = 'ok' and latitude is not null and longitude is not null
        and geocoded_at >= $1::timestamptz
        and (street_view_checked_at is null or ($2::boolean and street_view_pano_id is null))
      order by created_at, property_id`, [cutoff, recheckNone]);

  console.log(`${write ? "WRITE" : "DRY RUN (nothing will be written)"}`);
  console.log(`  properties with a fresh location: ${counts[0].located}`);
  console.log(`  cannot be looked up: ${counts[0].unlocated} not located, of which ${counts[0].expired} expired (run db:geocode-properties)`);
  console.log(`  to look up now: ${rows.length}${limit ? `, limited to ${limit}` : ""}`);

  const tally = { covered: 0, none: 0, failed: 0, written: 0 };
  const notes: string[] = [];
  let asked = 0;
  let stopped: string | null = null;

  for (const row of rows) {
    if (limit !== null && asked >= limit) break;
    asked += 1;
    const found = await lookupPano({ lat: Number(row.latitude), lng: Number(row.longitude) });

    if (found.kind === "failed") {
      if (found.fatal) { stopped = found.reason; break; }
      tally.failed += 1;
      notes.push(`  failed  ${row.name} - ${found.reason} (not recorded; will be asked again)`);
      await pause(PAUSE_MS);
      continue;
    }

    const panoId = found.kind === "ok" ? found.panoId : null;
    if (panoId) tally.covered += 1; else { tally.none += 1; notes.push(`  none    ${row.name} [${row.address ?? "no address"}] - no Street View coverage within 50 m`); }

    if (write) {
      const res = await adminQuery<{ property_id: string }>(
        `update properties set street_view_pano_id = $2, street_view_checked_at = now()
          where property_id = $1
            and (street_view_checked_at is null or ($3::boolean and street_view_pano_id is null))
          returning property_id`, [row.property_id, panoId, recheckNone]);
      tally.written += res.length;
    }
    await pause(PAUSE_MS);
  }

  console.log("");
  console.log("-- Reconciliation " + "-".repeat(50));
  console.log(`  asked Google:        ${asked}   (metadata, free)`);
  console.log(`  have coverage:       ${tally.covered}`);
  console.log(`  no coverage:         ${tally.none}   recorded so they are not asked again`);
  console.log(`  failed:              ${tally.failed}   not recorded`);
  console.log(`  rows written:        ${write ? tally.written : "0 (dry run)"}`);
  console.log(`  images stored:       0   (never: only the panorama id is kept)`);
  if (notes.length) { console.log(""); for (const n of notes) console.log(n); }
  if (stopped) { console.log(""); console.log(`STOPPED EARLY: ${stopped}`); process.exitCode = 1; }
  if (!write && asked > 0) console.log("\nDry run - nothing was written. Re-run with --write to record these.");
}

main()
  .catch((e) => { console.error(`Street View lookup failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
