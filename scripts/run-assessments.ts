// ============================================================================
// Run the assessment ENGINE over every live deal in an organisation.
// ----------------------------------------------------------------------------
//   npm run db:run-assessments -- --org "<organisation>" --user <email|profile id>           # dry run
//   npm run db:run-assessments -- --org "<organisation>" --user <email|profile id> --write   # record
//
// Engine only, by design. The written assessment is a billed model call and a
// judgement someone should read when it lands, so it is run per deal from the
// Assessment tab, never in bulk from here (docs/28).
//
// Dry by default: computes every deal, prints a table, writes nothing. --write
// records one engine-only row per deal in deal_assessments, all in one
// transaction. Deals marked dead, and deals that are not active, are skipped;
// --only <opportunity id> runs one.
// ============================================================================
import { requireEnv } from "./env";
import { getPool, closePool, withSessionOn, adminQuery, type Session } from "@/lib/db/client";
import { parseUserRef } from "@/lib/ingestion/user-ref";
import { loadDealContextOn, recordAssessmentOn } from "@/lib/data/deal-assessments";
import { resolveInputs } from "@/lib/underwrite/inputs";
import { buildReport, toStorable, ENGINE_VERSION } from "@/lib/underwrite/report";

class RollBack extends Error {}

function args() {
  const argv = process.argv.slice(2);
  const get = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const org = get("org"), user = get("user");
  if (!org) throw new Error('--org "<organisation name>" is required.');
  if (!user) throw new Error("--user <email|profile id> is required: every run says who recorded it.");
  return { org, user: parseUserRef(user), write: argv.includes("--write"), only: get("only") };
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");

async function main(): Promise<void> {
  requireEnv();
  const a = args();
  const orgs = await adminQuery<{ org_id: string }>("select org_id from organizations where name = $1", [a.org]);
  if (!orgs[0]) throw new Error(`No organisation named "${a.org}".`);
  const staff = a.user.kind === "id"
    ? await adminQuery<{ user_id: string }>("select user_id from profiles where user_id = $1", [a.user.value])
    : await adminQuery<{ user_id: string }>("select user_id from profiles where lower(email) = $1", [a.user.value]);
  if (staff.length !== 1) throw new Error(`--user ${a.user.value} must match exactly one profile.`);
  const session: Session = { userId: staff[0].user_id, orgIds: [orgs[0].org_id], role: "reiwa_admin", canWrite: true };
  const today = new Date().toISOString().slice(0, 10);

  let ran = 0, skipped = 0;
  try {
    await withSessionOn(getPool(), session, async (tx) => {
      const { rows } = await tx.query<{ opportunity_id: string; name: string }>(
        `select opportunity_id, name from opportunities
          where org_id = $1 and status = 'active' and triage_status <> 'dead'
            and ($2::uuid is null or opportunity_id = $2::uuid)
          order by name`, [orgs[0].org_id, a.only ?? null]);
      console.log(`${rows.length} deal(s). ${a.write ? "Recording." : "Dry run: nothing will be written."}\n`);
      for (const o of rows) {
        const ctx = await loadDealContextOn(tx, o.opportunity_id);
        if (!ctx) continue;
        const r = resolveInputs(ctx.facts, today);
        if (!r.ok) {
          skipped++;
          console.log(`- ${o.name}: skipped, needs ${r.missing.join(" and ")}`);
          continue;
        }
        const report = buildReport(ctx.facts.currency, r.tier, r.leases, r.params, r.lines, r.gaps);
        ran++;
        console.log(`- ${o.name}: ${r.tier}, ${ctx.facts.currency} ${pct(report.base.irrNet)}, yen ${pct(report.base.irrYenHedged)}, downside yen ${pct(report.scenarios.find((s) => s.key === "downside")!.irrYenHedged)}`);
        if (a.write) {
          await recordAssessmentOn(tx, session.userId, {
            orgId: ctx.orgId, opportunityId: o.opportunity_id, caseId: ctx.facts.case?.caseId ?? null,
            tier: r.tier, engineVersion: ENGINE_VERSION, inputs: r.lines, results: toStorable(report),
            assessment: null, model: null,
          });
        }
      }
      if (!a.write) throw new RollBack();
    });
  } catch (e) {
    if (!(e instanceof RollBack)) throw e;
  }
  console.log(`\n${ran} run, ${skipped} skipped${a.write ? ", recorded." : ", nothing written."}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => closePool());
