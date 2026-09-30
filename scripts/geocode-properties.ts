// ============================================================================
// Geocode the properties that have not been placed.
//   npm run db:geocode-properties                    dry run: asks Google, writes nothing
//   npm run db:geocode-properties -- --write         record the results
//   npm run db:geocode-properties -- --retry-failed  also retry rows that FAILED
//   npm run db:geocode-properties -- --limit 10      try a few first
// ----------------------------------------------------------------------------
// Dry by default, and a dry run DOES call Google (it has to, to say what it
// would write) but touches no row. Google's Geocoding quota is monthly; a dry
// run followed by --write asks twice. Use --limit to try a handful first.
//
// ENRICH, NEVER OVERWRITE - the posture resolveProperty() takes:
//   * `pending` rows are selected (`failed` too with --retry-failed); a fresh
//     `ok` or `no_match` row is never asked again;
//   * a row that already holds coordinates from another source is left alone and
//     reported, not replaced;
//   * every UPDATE re-checks that condition, so two runs at once cannot
//     overwrite each other.
// Re-running with nothing pending or expired touches nothing.
//
// THIRTY-DAY EXPIRY. Google's terms let coordinates be kept only temporarily
// (30 days) when the data is shared, as it is here. geocoded_at is the
// freshness marker, so a row geocoded more than 30 days ago is due exactly like
// a pending one and is asked again. The rule is in src/lib/geo/freshness.ts.
// Whatever is STILL expired when a --write run finishes - because Google
// refused, the run was limited, or it stopped early - has its coordinates and
// formatted address removed and returns to `pending`. Data that may no longer be
// kept is not left in place waiting for the next run. Coordinates entered by hand
// have no geocoded_at and never expire. Run it at least monthly.
//
// A systemic error (denied key, daily quota spent) STOPS the run. Marking every
// remaining property `failed` for a fault that is not theirs would bury the
// real cause under 131 identical rows.
//
// Sequential, with a short pause, as the pipeline loader is: no burst of
// concurrent requests, and each result is committed as it arrives, so an
// interrupted run keeps what it already paid for.
// ============================================================================
import { requireEnv } from "./env";
import { adminQuery, closePool } from "@/lib/db/client";
import { buildQuery, geocodeAddress, type GeocodeResult } from "@/lib/geo/geocode";
import { geocodeCutoff, GEOCODE_TTL_DAYS } from "@/lib/geo/freshness";

interface Row {
  property_id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  latitude: string | null;
  longitude: string | null;
  geocode_status: string;
  geocoded_at: string | null;
}

const PAUSE_MS = 120;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  requireEnv();
  if (!process.env.GOOGLE_MAPS_SERVER_KEY) {
    throw new Error("GOOGLE_MAPS_SERVER_KEY is not set. Add it to .env.local (server-only; never a NEXT_PUBLIC_ variable).");
  }
  const write = process.argv.includes("--write");
  const retryFailed = process.argv.includes("--retry-failed");
  const limitArg = argValue("limit");
  const limit = limitArg === undefined ? null : Number(limitArg);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive whole number.");

  const wanted = retryFailed ? ["pending", "failed"] : ["pending"];
  const cutoff = geocodeCutoff().toISOString();
  const all = await adminQuery<{ geocode_status: string; n: string }>(
    "select geocode_status, count(*) n from properties group by geocode_status");
  const before = Object.fromEntries(all.map((r) => [r.geocode_status, Number(r.n)]));
  const total = all.reduce((a, r) => a + Number(r.n), 0);

  const candidates = await adminQuery<Row>(
    `select property_id, name, address, city, country, country_code,
            latitude::text, longitude::text, geocode_status, geocoded_at::text
       from properties
      where geocode_status = any($1::text[])
         or (geocode_status in ('ok', 'no_match') and geocoded_at is not null and geocoded_at < $2::timestamptz)
      order by created_at, property_id`, [wanted, cutoff]);
  const isExpired = (r: Row) =>
    ["ok", "no_match"].includes(r.geocode_status) && r.geocoded_at !== null && r.geocoded_at < cutoff;

  console.log(`${write ? "WRITE" : "DRY RUN (nothing will be written)"} - ${total} properties`);
  console.log(`  before: ${["pending", "ok", "no_match", "failed"].map((s) => `${s}=${before[s] ?? 0}`).join(" ")}`);
  const expiredCount = candidates.filter(isExpired).length;
  console.log(`  selected: ${candidates.length} (${wanted.join(" + ")}${expiredCount ? ` + ${expiredCount} older than ${GEOCODE_TTL_DAYS} days` : ""})${limit ? `, limited to ${limit}` : ""}`);

  const tally = { ok: 0, no_match: 0, failed: 0, alreadyHadCoordinates: 0, written: 0, refreshed: 0, purged: 0 };
  const notes: string[] = [];
  let attempted = 0;
  let answeredLocally = 0;
  let stoppedBecause: string | null = null;

  for (const row of candidates) {
    if (limit !== null && attempted >= limit) break;

    // Coordinates from another source are not the geocoder's to replace. An
    // EXPIRED geocode is the geocoder's own, so it is refreshed instead.
    if ((row.latitude !== null || row.longitude !== null) && !isExpired(row)) {
      tally.alreadyHadCoordinates += 1;
      notes.push(`  kept    ${row.name} - already has coordinates (${row.latitude}, ${row.longitude}); not overwritten`);
      continue;
    }

    // A property known only by name is answered without a request, so it does
    // not count against --limit or as a call to Google.
    if (buildQuery(row) !== null) attempted += 1;
    else answeredLocally += 1;
    let result: GeocodeResult;
    try {
      result = await geocodeAddress({
        address: row.address, city: row.city, country: row.country, countryCode: row.country_code,
      });
    } catch (e) {
      throw new Error(`Stopping: ${(e as Error).message}`);
    }
    // A systemic fault is not this property's: record nothing against it.
    if (result.fatal) {
      stoppedBecause = result.reason;
      break;
    }
    tally[result.status] += 1;
    if (isExpired(row)) tally.refreshed += 1;

    if (result.status !== "ok") {
      notes.push(`  ${result.status.padEnd(8)} ${row.name} [${row.address ?? "no address"}] - ${result.reason}` +
        (result.formattedAddress ? ` (Google: ${result.formattedAddress})` : ""));
    }

    if (write) {
      // The WHERE re-states what selected the row, so a concurrent run or a
      // hand-entered coordinate cannot be overwritten between select and update.
      // An expired geocode is overwritten with whatever the refresh returned,
      // including nothing: it may not be kept either way.
      const res = await adminQuery<{ property_id: string }>(
        `update properties set
           latitude = $2, longitude = $3, formatted_address = $4,
           geocode_status = $5, geocoded_at = now()
         where property_id = $1
           and ((geocode_status = any($6::text[]) and latitude is null and longitude is null)
             or (geocode_status in ('ok', 'no_match') and geocoded_at < $7::timestamptz))
         returning property_id`,
        [row.property_id, result.latitude, result.longitude, result.formattedAddress, result.status, wanted, cutoff]);
      tally.written += res.length;
    }

    await pause(PAUSE_MS);
  }

  // Anything still past the limit may not be kept. Refreshed rows are no longer
  // expired (geocoded_at is now), so this catches only what was NOT refreshed.
  const stillExpired = await adminQuery<{ n: string }>(
    `select count(*) n from properties
      where geocode_status in ('ok', 'no_match') and geocoded_at is not null and geocoded_at < $1::timestamptz`, [cutoff]);
  const toPurge = Number(stillExpired[0]?.n ?? 0);
  if (write && toPurge > 0) {
    const purged = await adminQuery<{ property_id: string }>(
      `update properties set latitude = null, longitude = null, formatted_address = null,
              geocode_status = 'pending', geocoded_at = null
        where geocode_status in ('ok', 'no_match') and geocoded_at is not null and geocoded_at < $1::timestamptz
        returning property_id`, [cutoff]);
    tally.purged = purged.length;
  }

  console.log("");
  console.log("-- Reconciliation " + "-".repeat(50));
  console.log(`  asked Google:         ${attempted}`);
  if (answeredLocally > 0) console.log(`  no address (no call): ${answeredLocally}`);
  console.log(`  ok${write ? "" : " (would place)"}:     ${tally.ok}`);
  console.log(`  no_match:             ${tally.no_match}   needs a better address (includes no-address rows)`);
  console.log(`  failed:               ${tally.failed}   worth a retry (--retry-failed)`);
  console.log(`  left alone:           ${tally.alreadyHadCoordinates}   already had coordinates`);
  if (expiredCount > 0) console.log(`  refreshed (expired):  ${tally.refreshed} of ${expiredCount} older than ${GEOCODE_TTL_DAYS} days`);
  if (write && tally.purged > 0) {
    console.log(`  REMOVED, past ${GEOCODE_TTL_DAYS} days and not refreshed: ${tally.purged} (coordinates cleared, back to pending)`);
  } else if (!write && expiredCount > 0) {
    console.log(`  (a --write run refreshes these; any it cannot refresh are cleared, not kept)`);
  }
  console.log(`  rows written:         ${write ? tally.written : "0 (dry run)"}`);
  const untouched = candidates.length - attempted - answeredLocally - tally.alreadyHadCoordinates;
  if (untouched > 0) console.log(`  not reached:          ${untouched}${stoppedBecause ? "" : " (--limit)"}`);
  if (notes.length > 0) {
    console.log("");
    console.log("-- Not placed / not touched " + "-".repeat(40));
    for (const n of notes) console.log(n);
  }
  if (stoppedBecause) {
    console.log("");
    console.log(`STOPPED EARLY: ${stoppedBecause}`);
    process.exitCode = 1;
  }
  if (!write && attempted > 0) console.log("\nDry run - nothing was written. Re-run with --write to record these.");
}

main()
  .catch((e) => { console.error(`Geocoding failed: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
