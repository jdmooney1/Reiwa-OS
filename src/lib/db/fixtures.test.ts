import { describe, expect, it } from "vitest";
import { REIWA_FIXTURES } from "@/lib/db/fixtures";

// The point of these tests is not the fixture data. It is the rule behind it:
// Reiwa OS never shows a figure the firm did not enter, and a seed file is the
// easiest place for an invented number to slip in and become folklore.
describe("Reiwa reference fixtures", () => {
  it("holds the firm's four reference deals", () => {
    expect(REIWA_FIXTURES.map((f) => f.name)).toEqual([
      "58 Queen's Gate",
      "28 Pavilion Road",
      "Queens Hotel, Brighton",
      "Dyke Road Avenue, Brighton",
    ]);
  });

  it("carries no figures at all", () => {
    for (const f of REIWA_FIXTURES) {
      for (const [key, value] of Object.entries(f)) {
        expect(typeof value, `${f.name}.${key}`).not.toBe("number");
      }
    }
  });

  it("marks every record as TBC, so nothing reads as established", () => {
    for (const f of REIWA_FIXTURES) {
      expect(f.summary, f.name).toContain("TBC");
    }
  });

  it("records a reason for each pass, and only for passes", () => {
    const passes = REIWA_FIXTURES.filter((f) => f.status === "rejected");
    expect(passes.map((f) => f.name)).toEqual([
      "Queens Hotel, Brighton",
      "Dyke Road Avenue, Brighton",
    ]);
    for (const f of passes) {
      expect(f.pass?.rationale, f.name).toBeTruthy();
    }
    for (const f of REIWA_FIXTURES.filter((f) => f.status === "active")) {
      expect(f.pass, f.name).toBeUndefined();
    }
  });

  it("keeps the two passes distinguishable by reason", () => {
    const [price, strategy] = REIWA_FIXTURES.filter((f) => f.pass).map((f) => f.pass!.rationale);
    expect(price).toMatch(/price/i);
    expect(strategy).toMatch(/off-strategy/i);
  });
});
