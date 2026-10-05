// The token, the creation rules and the link, with no database.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  mintShareToken, hashShareToken, verifyShareToken, looksLikeShareToken, MAX_TOKEN_CHARS,
} from "@/lib/deal-share/token";
import {
  validateShareInput, shareState, dealShareOrigin, dealShareLink, dealSharePath,
  DEAL_SHARE_TTL_DAYS_DEFAULT, DEAL_SHARE_TTL_DAYS_MAX, PROSPECT_DISCLAIMER,
} from "@/lib/deal-share/policy";

const ID = "11111111-1111-4111-8111-111111111111";
const ok = { prospectName: "Hanako Sato", prospectEmail: "h@example.com", ttlDays: 14, snapshotMemoId: ID, teaserMemoId: null };

describe("the token", () => {
  it("is 256 random bits, URL-safe, different every time, and hashes to SHA-256 hex", () => {
    const a = mintShareToken(), b = mintShareToken();
    expect(a.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).toBe(createHash("sha256").update(a.rawToken).digest("hex"));
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.rawToken);
  });

  it("verifies only the token that produced the hash", () => {
    const a = mintShareToken(), b = mintShareToken();
    expect(verifyShareToken(a.rawToken, a.tokenHash)).toBe(true);
    expect(verifyShareToken(b.rawToken, a.tokenHash)).toBe(false);
    expect(verifyShareToken(a.tokenHash, a.tokenHash)).toBe(false); // the hash is not the token
  });

  it("fails CLOSED on anything missing or malformed, on either side", () => {
    const a = mintShareToken();
    for (const bad of [null, undefined, "", " ", "short", "a b".repeat(10), "x".repeat(MAX_TOKEN_CHARS + 1), "../etc/passwd/../../../x"]) {
      expect(verifyShareToken(bad as string, a.tokenHash)).toBe(false);
      expect(looksLikeShareToken(bad)).toBe(false);
    }
    for (const bad of [null, undefined, "", "abc", "Z".repeat(64), a.tokenHash.toUpperCase()]) {
      expect(verifyShareToken(a.rawToken, bad as string)).toBe(false);
    }
    expect(looksLikeShareToken(42)).toBe(false);
  });
});

describe("creation input", () => {
  it("normalises name and email and keeps the default lifetime inside the limit", () => {
    const v = validateShareInput({ ...ok, prospectName: "  Hanako Sato ", prospectEmail: " H@Example.COM " });
    expect(v).toMatchObject({ prospectName: "Hanako Sato", prospectEmail: "h@example.com", ttlDays: 14, snapshotMemoId: ID, teaserMemoId: null });
    expect(DEAL_SHARE_TTL_DAYS_DEFAULT).toBeLessThanOrEqual(DEAL_SHARE_TTL_DAYS_MAX);
  });

  it.each([
    [{ prospectName: " " }, /name/],
    [{ prospectName: "x".repeat(201) }, /too long/],
    [{ prospectEmail: "not-an-email" }, /valid email/],
    [{ prospectEmail: "a@b" }, /valid email/],
    [{ ttlDays: 0 }, /between 1 and 90/],
    [{ ttlDays: 91 }, /between 1 and 90/],
    [{ ttlDays: 1.5 }, /between 1 and 90/],
    [{ ttlDays: "soon" }, /between 1 and 90/],
    [{ snapshotMemoId: null, teaserMemoId: null }, /at least one document/],
    [{ snapshotMemoId: "", teaserMemoId: undefined }, /at least one document/],
    [{ snapshotMemoId: "not-a-uuid" }, /memo version/],
  ])("refuses %j", (over, message) => {
    expect(() => validateShareInput({ ...ok, ...over })).toThrow(message);
  });

  it("accepts the Teaser alone, or both", () => {
    expect(validateShareInput({ ...ok, snapshotMemoId: null, teaserMemoId: ID }).teaserMemoId).toBe(ID);
    expect(validateShareInput({ ...ok, teaserMemoId: ID.toUpperCase() })).toMatchObject({ snapshotMemoId: ID, teaserMemoId: ID });
  });
});

describe("state", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  it("active until the expiry instant, then expired; revoked outranks both", () => {
    expect(shareState({ expiresAt: "2026-10-06T00:00:00Z", revokedAt: null }, now)).toBe("active");
    expect(shareState({ expiresAt: "2026-10-05T12:00:00Z", revokedAt: null }, now)).toBe("expired");
    expect(shareState({ expiresAt: "2026-10-04T00:00:00Z", revokedAt: null }, now)).toBe("expired");
    expect(shareState({ expiresAt: "2026-10-04T00:00:00Z", revokedAt: "2026-10-03T00:00:00Z" }, now)).toBe("revoked");
    expect(shareState({ expiresAt: "2026-12-01T00:00:00Z", revokedAt: "2026-10-03T00:00:00Z" }, now)).toBe("revoked");
  });
});

describe("the link", () => {
  it("is built on a configured https origin, never a request, and is /deal/<token>", () => {
    expect(dealShareOrigin("https://portal.reiwa-capital.com")).toBe("https://portal.reiwa-capital.com");
    expect(dealShareOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(dealSharePath("abc")).toBe("/deal/abc");
    expect(dealShareLink("https://portal.reiwa-capital.com", "abc")).toBe("https://portal.reiwa-capital.com/deal/abc");
  });
  it("has no fallback to another surface's address", () => {
    const saved = { d: process.env.DEAL_SHARE_URL, i: process.env.INVESTOR_PORTAL_URL };
    try {
      delete process.env.DEAL_SHARE_URL; process.env.INVESTOR_PORTAL_URL = "https://portal.reiwa-capital.com";
      expect(() => dealShareOrigin()).toThrow(/DEAL_SHARE_URL/);
      process.env.DEAL_SHARE_URL = "https://deals.reiwa-capital.com";
      expect(dealShareOrigin()).toBe("https://deals.reiwa-capital.com");
    } finally {
      for (const [k, v] of [["DEAL_SHARE_URL", saved.d], ["INVESTOR_PORTAL_URL", saved.i]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
  it.each([
    [undefined, /not configured/], ["", /not configured/], ["not a url", /not a valid URL/],
    ["http://portal.reiwa-capital.com", /https/], ["https://x.com/some/path", /origin/], ["https://x.com/?a=1", /origin/],
  ])("refuses %s", (raw, message) => {
    expect(() => dealShareOrigin(raw as string)).toThrow(message);
  });
});

describe("the disclaimer", () => {
  it("says it is for preliminary discussion, is not tax or legal advice, and that Reiwa gives none", () => {
    expect(PROSPECT_DISCLAIMER).toMatch(/preliminary discussion purposes only/);
    expect(PROSPECT_DISCLAIMER).toMatch(/not tax or legal advice/);
    expect(PROSPECT_DISCLAIMER).toMatch(/Reiwa Capital does not provide tax or legal advice/);
  });
});
