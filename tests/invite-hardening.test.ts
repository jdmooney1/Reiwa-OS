// ============================================================================
// P6 — invitation token hand-off, against the real database.
// ----------------------------------------------------------------------------
// An invitation token is a bearer credential. P3 made it strong (32 random
// bytes, stored only as a hash, expiring, revocable, one-shot); P6 stops it
// being durable in places nobody controls — browser history, the address bar,
// a Referer header, an access log, a forwarded "link".
//
// The rule under test: the token appears in exactly ONE URL, the emailed
// /access/<token>, and that URL renders nothing. It is exchanged server-side
// for an httpOnly cookie and the browser is redirected somewhere that carries
// no credential. Everything after that reads the cookie.
//
// The P3 guarantees are re-asserted here too, because hardening that quietly
// weakened one of them would be a worse outcome than not hardening at all.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { type Session } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import {
  createInvestorOrganization, createInvestorContact, updateInvestorContact,
} from "@/lib/data/investor-portal";
import {
  createInvite, revokeInvite, validateInviteToken, hashInviteToken, listInvitesForOrg,
} from "@/lib/data/investor-invites";
import { GET as accessHandoff } from "@/app/(portal)/access/[token]/route";
import { INVITE_COOKIE, INVITE_STATUS_COOKIE } from "@/lib/auth/invite-session";
import { adminSession, orgIdByName, orgUserSession } from "./helpers";

const LIVE = "live@p6-invite.example";
const DORMANT = "dormant@p6-invite.example";

let orgId: string;
let liveContactId: string;
let dormantContactId: string;
let staff: Session;

/** Drive the hand-off exactly as a browser following the emailed link would. */
async function handOff(token: string) {
  const url = `https://portal.reiwa-capital.com/access/${encodeURIComponent(token)}`;
  return accessHandoff(new NextRequest(url), { params: { token: encodeURIComponent(token) } });
}

beforeAll(async () => {
  staff = orgUserSession([await orgIdByName("Meiji Shipping")]);
  const supabase = createSupabaseAdminClient();
  const liveUid = await ensureAuthUser(supabase,
    { email: LIVE, password: DEMO_PASSWORD, name: "L. Fixture" });
  const dormantUid = await ensureAuthUser(supabase,
    { email: DORMANT, password: DEMO_PASSWORD, name: "D. Fixture" });

  orgId = await createInvestorOrganization(adminSession, {
    name: "P6 Invitation Partners", notes: "Created by tests/invite-hardening.test.ts.",
  });
  liveContactId = await createInvestorContact(adminSession, {
    investorOrgId: orgId, email: LIVE, name: "L. Fixture", authUserId: liveUid,
  });
  dormantContactId = await createInvestorContact(adminSession, {
    investorOrgId: orgId, email: DORMANT, name: "D. Fixture", authUserId: dormantUid,
  });
});

// ============================================================================
describe("The token leaves the URL at the first opportunity", () => {
  it("redirects away from the token-bearing URL instead of rendering it", async () => {
    const { rawToken } = await createInvite(adminSession, liveContactId, {}, null);
    const response = await handOff(rawToken);

    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toContain("/access");
    // The destination carries no credential — not in the path, not in a query.
    expect(location).not.toContain(rawToken);
    expect(new URL(location).search).toBe("");
  });

  it("hands the token on in an httpOnly cookie, not in anything the page can read", async () => {
    const { rawToken } = await createInvite(adminSession, liveContactId, {}, null);
    const response = await handOff(rawToken);

    const cookie = response.cookies.get(INVITE_COOKIE)!;
    expect(cookie.value).toBe(rawToken);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.path).toBe("/");
    // Short-lived: minutes, not the invitation's own fourteen days.
    expect(cookie.maxAge).toBeGreaterThan(0);
    expect(cookie.maxAge).toBeLessThanOrEqual(15 * 60);
  });

  it("sends no referrer and forbids caching of the hand-off", async () => {
    const { rawToken } = await createInvite(adminSession, liveContactId, {}, null);
    const response = await handOff(rawToken);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("passes on only the reason when the invitation is refused, never the token", async () => {
    const { rawToken, inviteId } = await createInvite(adminSession, liveContactId, {}, null);
    await revokeInvite(adminSession, inviteId);

    const response = await handOff(rawToken);
    expect(response.status).toBe(303);
    expect(response.cookies.get(INVITE_COOKIE)?.value ?? "").not.toBe(rawToken);
    expect(response.cookies.get(INVITE_STATUS_COOKIE)!.value).toBe("revoked");
    expect(response.headers.get("location")).not.toContain(rawToken);
  });

  it("treats an unrecognised token as not_found without leaking that it looked", async () => {
    const response = await handOff("not-a-real-token-at-all");
    expect(response.cookies.get(INVITE_STATUS_COOKIE)!.value).toBe("not_found");
    expect(response.cookies.get(INVITE_COOKIE)?.value).toBeFalsy();
  });

  it("refuses a deactivated contact's invitation at the hand-off", async () => {
    const { rawToken } = await createInvite(adminSession, dormantContactId, {}, null);
    await updateInvestorContact(adminSession, dormantContactId, { isActive: false });
    const response = await handOff(rawToken);
    expect(response.cookies.get(INVITE_STATUS_COOKIE)!.value).toBe("contact_inactive");
    expect(response.cookies.get(INVITE_COOKIE)?.value).toBeFalsy();
  });
});

// ============================================================================
describe("No raw token survives anywhere it should not", () => {
  const sources: { file: string; code: string }[] = [];

  beforeAll(() => {
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        // Strip comments so prose about the rule does not trip it.
        const code = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        sources.push({ file: full, code });
      }
    };
    walk(join(process.cwd(), "src"));
  });

  it("logs no invitation token", () => {
    const offenders = sources.filter(({ code }) =>
      /console\.(log|info|warn|error|debug)\([^)]*\b(rawToken|inviteToken|token_hash)\b/.test(code));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("builds no redirect or link that carries a token in a URL", () => {
    // The emailed link is minted in admin-invites.ts and is the one exception:
    // there is nowhere else for an invitation to arrive from.
    const offenders = sources.filter(({ file, code }) =>
      !file.endsWith("admin-invites.ts") &&
      /(redirect|href|Location)[^\n]*\$\{\s*(rawToken|inviteToken|token)\s*\}/.test(code));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("puts no invitation token in a rendered form field", () => {
    const offenders = sources.filter(({ code }) =>
      /type="hidden"[^>]*name="invite"/.test(code));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("declares no-referrer for the access and portal routes", () => {
    const config = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
    expect(config).toMatch(/Referrer-Policy/);
    expect(config).toMatch(/no-referrer/);
    expect(config).toMatch(/access\|portal/);
  });
});

// ============================================================================
// The P3 guarantees, re-asserted: hardening must not have relaxed any of them.
// ============================================================================
describe("The P3 token guarantees still hold", () => {
  it("mints 32 random bytes and stores only the hash", async () => {
    const { rawToken } = await createInvite(adminSession, liveContactId, {}, null);
    // 32 bytes, base64url: 43 characters, no padding.
    expect(Buffer.from(rawToken, "base64url").length).toBe(32);
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const { adminQuery } = await import("@/lib/db/client");
    const stored = await adminQuery<{ token_hash: string }>(
      "select token_hash from investor_invites where token_hash = $1", [hashInviteToken(rawToken)]);
    expect(stored.length).toBe(1);
    // The raw token appears in no column of the row.
    const row = await adminQuery<Record<string, unknown>>(
      "select * from investor_invites where token_hash = $1", [hashInviteToken(rawToken)]);
    expect(JSON.stringify(row[0])).not.toContain(rawToken);
  });

  it("never repeats a token", async () => {
    const minted = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      minted.add((await createInvite(adminSession, liveContactId, {}, null)).rawToken);
    }
    expect(minted.size).toBe(8);
  });

  it("revokes the predecessor when a new invitation is minted", async () => {
    const first = await createInvite(adminSession, liveContactId, {}, null);
    const second = await createInvite(adminSession, liveContactId, {}, null);

    expect((await validateInviteToken(first.rawToken)).ok).toBe(false);
    expect((await validateInviteToken(second.rawToken)).ok).toBe(true);

    const invites = await listInvitesForOrg(adminSession, orgId);
    const active = invites.filter((i) => i.investorContactId === liveContactId && i.state === "active");
    expect(active.length).toBe(1);
  });

  it("expires an invitation whose window has passed", async () => {
    const { rawToken } = await createInvite(adminSession, liveContactId, { ttlDays: -1 }, null);
    const validation = await validateInviteToken(rawToken);
    expect(validation.ok).toBe(false);
    expect(validation.ok === false && validation.reason).toBe("expired");
  });

  it("refuses a token of an implausible length before touching the database", async () => {
    const validation = await validateInviteToken("x".repeat(200));
    expect(validation.ok).toBe(false);
    expect(validation.ok === false && validation.reason).toBe("not_found");
  });
});
