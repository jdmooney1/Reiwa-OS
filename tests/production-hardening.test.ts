// ============================================================================
// P6 — production hardening, against the real database and real Storage.
// ----------------------------------------------------------------------------
// Three things are asserted here that no earlier phase could:
//
//   * a document's BYTES are reachable only through an authorisation this
//     suite performs the same way the action does — under the investor's own
//     row level security, then a short-lived signed URL;
//   * the privilege surface itself is correct, and stays correct when a new
//     table is created (the regression that catches a future migration
//     silently exposing something to `anon`);
//   * the activity record cannot be rewritten by anyone the application can
//     act as, administrators included.
//
// Self-contained fixture; nothing seeded is touched, so P0-P5 stay valid.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, withInvestorSession, withSession, type Session } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import { createOpportunity } from "@/lib/data/opportunities";
import {
  createInvestorOrganization, createInvestorContact, updateInvestorContact,
  updateInvestorOrganization, createPublicationFromOpportunity, updateDraftVersion,
  publishVersion, addPublicationDocument, grantEntitlement, updateEntitlement,
  supersedeActiveVersion, listEntitlements,
} from "@/lib/data/investor-portal";
import { resolveDocumentDownload, recordPortalEvent } from "@/lib/data/portal-feed";
import {
  ensureDocumentBucket, createSignedDocumentUrl, uploadDocumentObject,
  DOCUMENT_BUCKET, SIGNED_URL_TTL_SECONDS,
} from "@/lib/supabase/storage";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

const STANDARD = "standard@p6-fixture.example";
const DILIGENCE = "diligence@p6-fixture.example";
const OUTSIDER = "outsider@p6-fixture.example";

let staff: Session;
let adminUserId: string;
let stdOrgId: string, dilOrgId: string, outOrgId: string;
let stdUid: string, dilUid: string, outUid: string;
let stdContactId: string;
let publicationId: string, versionId: string;
let docStandard: string, docDiligence: string, docInternal: string;
let storagePaths: Record<string, string> = {};

const BYTES = Buffer.from("%PDF-1.4\nReiwa Capital P6 test object\n", "utf8");

beforeAll(async () => {
  staff = orgUserSession([await orgIdByName("Meiji Shipping")]);
  adminUserId = await profileIdByEmail("admin@reiwa.com");
  await ensureDocumentBucket();

  const supabase = createSupabaseAdminClient();
  stdUid = await ensureAuthUser(supabase, { email: STANDARD, password: DEMO_PASSWORD, name: "S. Tier" });
  dilUid = await ensureAuthUser(supabase, { email: DILIGENCE, password: DEMO_PASSWORD, name: "D. Tier" });
  outUid = await ensureAuthUser(supabase, { email: OUTSIDER, password: DEMO_PASSWORD, name: "O. Outside" });

  stdOrgId = await createInvestorOrganization(adminSession, { name: "P6 Standard Holdings" });
  dilOrgId = await createInvestorOrganization(adminSession, { name: "P6 Diligence Holdings" });
  outOrgId = await createInvestorOrganization(adminSession, { name: "P6 Outside Holdings" });

  stdContactId = await createInvestorContact(adminSession, {
    investorOrgId: stdOrgId, email: STANDARD, name: "S. Tier", authUserId: stdUid,
  });
  await createInvestorContact(adminSession, {
    investorOrgId: dilOrgId, email: DILIGENCE, name: "D. Tier", authUserId: dilUid,
  });
  await createInvestorContact(adminSession, {
    investorOrgId: outOrgId, email: OUTSIDER, name: "O. Outside", authUserId: outUid,
  });

  const opportunityId = await createOpportunity(staff, {
    orgId: await orgIdByName("Meiji Shipping"),
    name: "P6 Hardening House", city: "London", country: "United Kingdom",
    market: "London", assetType: "office", strategy: "core", currency: "GBP",
    targetPrice: 20_000_000, niy: 4.1, targetIrr: 10,
  });
  const created = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
  publicationId = created.publicationId;
  versionId = created.versionId;
  await updateDraftVersion(adminSession, versionId, { headline: "P6 headline" });

  const doc = async (title: string, level: "standard" | "diligence" | "internal") =>
    addPublicationDocument(adminSession, {
      versionId, title, category: "other",
      storagePath: `publications/${versionId}/${level}-${Date.now()}.pdf`,
      fileName: `${title}.pdf`, mimeType: "application/pdf", accessLevel: level,
    }, adminUserId);

  docStandard = await doc("P6 Standard Doc", "standard");
  docDiligence = await doc("P6 Diligence Doc", "diligence");
  docInternal = await doc("P6 Internal Doc", "internal");
  await publishVersion(adminSession, versionId, adminUserId);

  // Upload real bytes for each, so a signed URL has something to serve.
  const rows = await adminQuery<{ document_id: string; storage_path: string }>(
    "select document_id, storage_path from publication_documents where version_id = $1", [versionId]);
  for (const r of rows) {
    storagePaths[r.document_id] = r.storage_path;
    await uploadDocumentObject(r.storage_path, BYTES.buffer.slice(
      BYTES.byteOffset, BYTES.byteOffset + BYTES.byteLength) as ArrayBuffer, "application/pdf");
  }

  await grantEntitlement(adminSession, {
    investorOrgId: stdOrgId, publicationId, isVisible: true,
    placement: "featured", documentAccessLevel: "standard",
  }, adminUserId);
  await grantEntitlement(adminSession, {
    investorOrgId: dilOrgId, publicationId, isVisible: true,
    placement: "featured", documentAccessLevel: "diligence",
  }, adminUserId);
  // The outsider organisation is entitled to nothing.
});

// ============================================================================
// Secure document delivery
// ============================================================================
describe("Secure document delivery", () => {
  it("a signed URL is produced only after the entitlement check, and serves the bytes", async () => {
    const resolved = await resolveDocumentDownload(stdUid, docStandard);
    expect(resolved).not.toBeNull();
    expect(resolved!.storagePath).toBe(storagePaths[docStandard]);

    const url = await createSignedDocumentUrl(resolved!.storagePath, { downloadAs: "teaser.pdf" });
    expect(url).toBeTruthy();
    const response = await fetch(url!);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Reiwa Capital P6 test object");
  });

  it("signs for a short window only", async () => {
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
    const url = await createSignedDocumentUrl(storagePaths[docStandard]);
    const token = new URL(url!).searchParams.get("token")!;
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    const ttl = payload.exp - Math.floor(Date.now() / 1000);
    // Supabase adds a small clock-skew allowance on top of the requested TTL.
    expect(ttl).toBeLessThanOrEqual(SIGNED_URL_TTL_SECONDS + 10);
    expect(ttl).toBeGreaterThan(0);
    expect(payload.url).toBe(`${DOCUMENT_BUCKET}/${storagePaths[docStandard]}`);
  });

  it("a standard entitlement cannot reach a diligence document", async () => {
    expect(await resolveDocumentDownload(stdUid, docStandard)).not.toBeNull();
    expect(await resolveDocumentDownload(stdUid, docDiligence)).toBeNull();
  });

  it("a diligence entitlement reaches standard and diligence, never internal", async () => {
    expect(await resolveDocumentDownload(dilUid, docStandard)).not.toBeNull();
    expect(await resolveDocumentDownload(dilUid, docDiligence)).not.toBeNull();
    expect(await resolveDocumentDownload(dilUid, docInternal)).toBeNull();
  });

  it("no investor at any tier can reach an internal document", async () => {
    for (const uid of [stdUid, dilUid, outUid]) {
      expect(await resolveDocumentDownload(uid, docInternal)).toBeNull();
    }
  });

  it("an unentitled organisation reaches nothing, and a forged id resolves to nothing", async () => {
    for (const id of [docStandard, docDiligence, docInternal]) {
      expect(await resolveDocumentDownload(outUid, id)).toBeNull();
    }
    expect(await resolveDocumentDownload(stdUid, "00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await resolveDocumentDownload(stdUid, "not-a-uuid")).toBeNull();
  });

  it("revoking the entitlement blocks the next download immediately", async () => {
    const grant = (await listEntitlements(adminSession, stdOrgId))
      .find((e) => e.publicationId === publicationId)!;

    expect(await resolveDocumentDownload(stdUid, docStandard)).not.toBeNull();
    await updateEntitlement(adminSession, grant.entitlementId, { isVisible: false });
    expect(await resolveDocumentDownload(stdUid, docStandard)).toBeNull();
    await updateEntitlement(adminSession, grant.entitlementId, { isVisible: true });
    expect(await resolveDocumentDownload(stdUid, docStandard)).not.toBeNull();
  });

  it("a deactivated contact and a suspended organisation both block downloads", async () => {
    await updateInvestorContact(adminSession, stdContactId, { isActive: false });
    expect(await resolveDocumentDownload(stdUid, docStandard)).toBeNull();
    await updateInvestorContact(adminSession, stdContactId, { isActive: true });

    await updateInvestorOrganization(adminSession, dilOrgId, { status: "suspended" });
    expect(await resolveDocumentDownload(dilUid, docDiligence)).toBeNull();
    await updateInvestorOrganization(adminSession, dilOrgId, { status: "active" });
    expect(await resolveDocumentDownload(dilUid, docDiligence)).not.toBeNull();
  });

  it("a withdrawn publication blocks document access", async () => {
    const opportunityId = await createOpportunity(staff, {
      orgId: await orgIdByName("Meiji Shipping"), name: "P6 Withdrawn House",
      city: "London", country: "United Kingdom", assetType: "office", currency: "GBP",
    });
    const created = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
    const docId = await addPublicationDocument(adminSession, {
      versionId: created.versionId, title: "P6 Doomed Doc",
      storagePath: `publications/${created.versionId}/doomed.pdf`, accessLevel: "standard",
    }, adminUserId);
    await publishVersion(adminSession, created.versionId, adminUserId);
    await grantEntitlement(adminSession, {
      investorOrgId: stdOrgId, publicationId: created.publicationId,
      isVisible: true, placement: "secondary", documentAccessLevel: "standard",
    }, adminUserId);

    expect(await resolveDocumentDownload(stdUid, docId)).not.toBeNull();
    await supersedeActiveVersion(adminSession, created.publicationId);
    expect(await resolveDocumentDownload(stdUid, docId)).toBeNull();
  });

  it("records a download event only for a delivery that was authorised", async () => {
    const before = await downloadEvents(stdContactId);
    // A refused document records nothing, because the action never reaches the
    // event: resolveDocumentDownload returned null.
    expect(await resolveDocumentDownload(stdUid, docInternal)).toBeNull();
    expect(await downloadEvents(stdContactId)).toBe(before);

    await recordPortalEvent(stdUid, "document_downloaded",
      { publicationId, versionId, context: { document_id: docStandard } });
    expect(await downloadEvents(stdContactId)).toBe(before + 1);
  });
});

async function downloadEvents(contactId: string): Promise<number> {
  const rows = await adminQuery<{ n: string }>(
    `select count(*)::text as n from investor_activity_events
      where investor_contact_id = $1 and event_type = 'document_downloaded'`, [contactId]);
  return Number(rows[0].n);
}

// ============================================================================
// Privilege surface
// ============================================================================
describe("Privilege surface", () => {
  it("anon holds no privilege on anything in public", async () => {
    const rows = await adminQuery<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`);
    expect(rows).toEqual([]);
  });

  it("authenticated holds no TRUNCATE, REFERENCES or TRIGGER anywhere in public", async () => {
    const rows = await adminQuery<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'
          and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
        order by table_name`);
    expect(rows).toEqual([]);
  });

  it("a NEW table does not inherit access for anon — the future-migration regression", async () => {
    // This is the guarantee 0007 bought: Supabase's project defaults would
    // otherwise grant anon full DML on anything a later migration creates.
    await adminQuery("create table if not exists p6_privilege_probe (id int primary key)");
    try {
      const granted = await adminQuery<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'p6_privilege_probe'
            and grantee in ('anon', 'PUBLIC')`);
      expect(granted).toEqual([]);

      const unsafe = await adminQuery<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'p6_privilege_probe'
            and grantee = 'authenticated' and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')`);
      expect(unsafe).toEqual([]);
    } finally {
      await adminQuery("drop table if exists p6_privilege_probe");
    }
  });

  it("every table in public has RLS enabled", async () => {
    const rows = await adminQuery<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it("every SECURITY DEFINER function pins an empty search_path", async () => {
    const rows = await adminQuery<{ proname: string; config: string | null }>(
      `select p.proname, array_to_string(p.proconfig, ',') as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('app','public') and p.prosecdef`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect({ fn: r.proname, pinned: /search_path=/.test(r.config ?? "") })
        .toEqual({ fn: r.proname, pinned: true });
    }
  });

  it("PUBLIC can execute nothing in schema app, and there is no blanket future grant", async () => {
    const anyExec = await adminQuery<{ can: boolean }>(
      `select bool_or(has_function_privilege('public', p.oid, 'EXECUTE')) as can
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app'`);
    expect(anyExec[0].can).toBe(false);

    const defaults = await adminQuery<{ acl: string }>(
      `select array_to_string(d.defaclacl, ',') as acl from pg_default_acl d
         join pg_namespace n on n.oid = d.defaclnamespace
        where n.nspname = 'app'`);
    expect(defaults).toEqual([]);
  });

  it("the investor projection is security_invoker, so it can never widen access", async () => {
    const rows = await adminQuery<{ v: string | null }>(
      `select (select option_value from pg_options_to_table(c.reloptions)
                where option_name = 'security_invoker') as v
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'investor_feed'`);
    expect(rows[0].v).toBe("true");
  });
});

// ============================================================================
// The audit trail
// ============================================================================
describe("Activity immutability", () => {
  it("no policy permits UPDATE or DELETE of an activity event, for anyone", async () => {
    const rows = await adminQuery<{ polname: string; cmd: string }>(
      `select polname, case polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                                   when 'w' then 'UPDATE' when 'd' then 'DELETE'
                                   when '*' then 'ALL' end as cmd
         from pg_policy where polrelid = 'investor_activity_events'::regclass`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect({ policy: r.polname, cmd: r.cmd }).not.toEqual({ policy: r.polname, cmd: "UPDATE" });
      expect({ policy: r.polname, cmd: r.cmd }).not.toEqual({ policy: r.polname, cmd: "DELETE" });
      expect({ policy: r.polname, cmd: r.cmd }).not.toEqual({ policy: r.polname, cmd: "ALL" });
    }
  });

  it("an administrator can read the record but cannot rewrite it", async () => {
    await recordPortalEvent(stdUid, "opportunity_viewed", { publicationId, versionId });
    const target = (await adminQuery<{ event_id: string; event_type: string }>(
      `select event_id, event_type from investor_activity_events
        where investor_contact_id = $1 order by occurred_at desc limit 1`, [stdContactId]))[0];

    // Reading is permitted...
    const read = await withSession(adminSession, (tx) =>
      tx.query("select event_id from investor_activity_events where event_id = $1", [target.event_id]));
    expect(read.rows.length).toBe(1);

    // ...rewriting is not, for the administrator either. The UPDATE and DELETE
    // privileges were withdrawn in 0007, so PostgreSQL refuses at the privilege
    // layer — before row level security is even consulted. That is a stronger
    // outcome than a policy that matches no rows: there is no statement an
    // administrator can phrase that would edit history.
    await expect(withSession(adminSession, (tx) =>
      tx.query("update investor_activity_events set event_type = 'login' where event_id = $1",
        [target.event_id]))).rejects.toThrow(/permission denied/i);

    await expect(withSession(adminSession, (tx) =>
      tx.query("delete from investor_activity_events where event_id = $1",
        [target.event_id]))).rejects.toThrow(/permission denied/i);

    const after = await adminQuery<{ event_type: string }>(
      "select event_type from investor_activity_events where event_id = $1", [target.event_id]);
    expect(after[0].event_type).toBe(target.event_type);
  });

  it("authenticated holds no UPDATE or DELETE privilege on the record at all", async () => {
    const rows = await adminQuery<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'investor_activity_events'
          and grantee = 'authenticated' and privilege_type in ('UPDATE','DELETE','TRUNCATE')`);
    expect(rows).toEqual([]);
  });
});

// ============================================================================
// The investor boundary still holds
// ============================================================================
describe("The boundary after hardening", () => {
  it("an investor still reaches no internal table", async () => {
    for (const table of ["opportunities", "assets", "organizations", "profiles",
                          "transactions", "publication_sources", "publication_version_sources"]) {
      const { rows } = await withInvestorSession(stdUid, (tx) =>
        tx.query<{ n: string }>(`select count(*)::text as n from ${table}`));
      expect({ table, rows: Number(rows[0].n) }).toEqual({ table, rows: 0 });
    }
  });

  it("no internal identifier appears on anything the portal hands an investor", async () => {
    const internal = new Set<string>();
    for (const sql of ["select opportunity_id::text as id from opportunities",
                        "select org_id::text as id from organizations"]) {
      for (const r of await adminQuery<{ id: string }>(sql)) internal.add(r.id);
    }
    const feed = await withInvestorSession(stdUid, (tx) =>
      tx.query("select * from investor_feed"));
    const rendered = JSON.stringify(feed.rows);
    for (const id of internal) {
      expect({ id, leaked: rendered.includes(id) }).toEqual({ id, leaked: false });
    }
  });

  it("the environment exposes only publishable values to a browser", async () => {
    const { PUBLIC_ENV_ALLOWLIST, SERVER_ENV_REQUIRED } = await import("@/lib/env");
    for (const name of SERVER_ENV_REQUIRED) {
      const isPublic = name.startsWith("NEXT_PUBLIC_");
      expect({ name, allowed: PUBLIC_ENV_ALLOWLIST.includes(name) }).toEqual({ name, allowed: isPublic });
    }
    // The two server-only credentials must never be NEXT_PUBLIC_.
    expect(SERVER_ENV_REQUIRED).toContain("SUPABASE_SECRET_KEY");
    expect(SERVER_ENV_REQUIRED).toContain("DATABASE_URL");
    expect(PUBLIC_ENV_ALLOWLIST).not.toContain("SUPABASE_SECRET_KEY");
    expect(PUBLIC_ENV_ALLOWLIST).not.toContain("DATABASE_URL");
  });

  it("no source file hands a server-only credential to client code", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const src = readFileSync(full, "utf8");
        if (!/^"use client";/m.test(src)) continue;
        if (/SUPABASE_SECRET_KEY|DATABASE_URL|SUPABASE_DB_CA_CERT/.test(src)) offenders.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});

afterAll(async () => {
  // Leave the bucket tidy — the fixture's objects are not needed again.
  const admin = createSupabaseAdminClient();
  const paths = Object.values(storagePaths);
  if (paths.length > 0) await admin.storage.from(DOCUMENT_BUCKET).remove(paths);
});
