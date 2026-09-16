// ============================================================================
// Manual production smoke: provision a real investor contact and invitation.
// ----------------------------------------------------------------------------
// MANUAL ONLY, and the most dangerous thing in this directory by some distance.
// Everything else here only READS a deployment. This WRITES: an investor
// contact, a Supabase Auth user and a live invitation token, into whatever
// DATABASE_URL and Supabase project the shell running it is configured for.
//
// It exists because the investor journey cannot be smoke-tested without an
// investor whose mailbox a person can actually read, and creating one by hand
// through the admin UI each time is how people end up leaving test contacts in a
// real portal.
//
// Three deliberate differences from the scratch version this replaces:
//
//   * nothing is hard-coded. The original carried a real email address and a
//     real organisation UUID in the source, which meant running it by accident
//     wrote to a specific, known, real organisation.
//   * it needs its own second opt-in on top of the shared one, because the
//     shared flag is also carried by the read-only specs and a flag that permits
//     reading must not silently permit writing.
//   * it prints what it created, so it can be undone.
//
// It does NOT send the invitation email. It prints the access path; emailing it
// is a separate, deliberate act in the admin UI.
// ============================================================================
import { requireEnv } from "../env";
import { closePool, adminQuery, type Session } from "@/lib/db/client";
import { loadAuthSession } from "@/lib/auth/service";
import { toDbSession } from "@/lib/auth/session";
import { provisionInvestorAuthUser } from "@/lib/supabase/investor-admin";
import { createInvestorContact, updateInvestorContact } from "@/lib/data/investor-portal";
import { createInvite } from "@/lib/data/investor-invites";
import { requireProductionSmokeOptIn, requireFile, OPT_IN } from "./guard";

const WRITE_OPT_IN = "PRODUCTION_SMOKE_WRITE";

async function main(): Promise<void> {
  requireProductionSmokeOptIn();

  if (process.env[WRITE_OPT_IN] !== "true") {
    throw new Error(
      [
        "Refusing to provision a production smoke contact: writing was not asked for.",
        "",
        `  Reason: ${WRITE_OPT_IN} is not "true".`,
        "",
        `${OPT_IN} permits the read-only smoke specs. Creating a real investor`,
        "contact, a real Auth user and a real invitation token is a separate act",
        "and needs its own opt-in.",
      ].join("\n"),
    );
  }

  const orgId = requireFile("SMOKE_INVESTOR_ORG_ID");
  const email = requireFile("SMOKE_INVESTOR_EMAIL");
  const name = process.env.SMOKE_INVESTOR_NAME ?? "Production Smoke";

  requireEnv();

  const [admin] = await adminQuery<{ user_id: string }>(
    "select user_id from profiles where global_role = 'reiwa_admin' limit 1");
  if (!admin) throw new Error("No reiwa_admin profile exists in the target database.");
  const auth = await loadAuthSession(admin.user_id);
  if (!auth) throw new Error(`Could not load an auth session for admin ${admin.user_id}.`);
  const db: Session = toDbSession(auth);

  const existing = await adminQuery<{ investor_contact_id: string }>(
    "select investor_contact_id from investor_contacts where email = $1", [email]);
  const contactId = existing.length
    ? existing[0].investor_contact_id
    : await createInvestorContact(db, {
        investorOrgId: orgId, email, name, title: "Production Smoke", isActive: true,
      });

  const authUserId = await provisionInvestorAuthUser(email, name);
  await updateInvestorContact(db, contactId, { authUserId });

  const invite = await createInvite(db, contactId, {}, auth.userId);

  console.log(existing.length ? "Reused existing contact." : "Created contact.");
  console.log(`CONTACT=${contactId}`);
  console.log(`AUTH_USER=${authUserId}`);
  console.log(`INVITE=${invite.inviteId}`);
  console.log(`ACCESS_PATH=/access/${invite.rawToken}`);
  console.log("");
  console.log("Deactivate the contact and revoke the invitation when the smoke run is done.");
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closePool);
