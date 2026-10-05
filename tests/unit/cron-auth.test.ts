import { describe, it, expect } from "vitest";
import { authorizeCron } from "@/lib/cron-auth";

const SECRET = "s3cret-value-long-enough-1234";

describe("authorizeCron", () => {
  it("accepts the exact bearer token", () => {
    expect(authorizeCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses a missing, malformed or wrong header", () => {
    for (const h of [null, undefined, "", SECRET, `bearer ${SECRET}`, `Basic ${SECRET}`, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, "Bearer ", "Bearer wrong"]) {
      expect(authorizeCron(h, SECRET), String(h)).toBe(false);
    }
  });

  it("FAILS CLOSED when no secret is configured, even for an empty bearer", () => {
    for (const secret of [undefined, null, ""]) {
      expect(authorizeCron("Bearer ", secret)).toBe(false);
      expect(authorizeCron(`Bearer ${secret}`, secret)).toBe(false);
      expect(authorizeCron("Bearer undefined", secret)).toBe(false);
    }
  });

  it("refuses a short secret even when the caller presents it, because it is guessable", () => {
    expect(authorizeCron("Bearer abc", "abc")).toBe(false);
  });
});
