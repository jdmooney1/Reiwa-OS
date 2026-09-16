import { describe, it, expect } from "vitest";
import {
  scoreMatch, rankMatches, disposition, matchPercent, bandFor, BANDS,
  type MatchTarget,
} from "@/lib/ingestion/match";
import { propertyIdentityKey } from "@/lib/ingestion/normalise";

const target = (over: Partial<MatchTarget>): MatchTarget => ({
  propertyId: "p1",
  name: "16 Conduit Street",
  address: "16 Conduit Street, London",
  postcode: "W1S 2XJ",
  broker: "Knight Frank",
  price: 12_500_000,
  ...over,
});

const withKey = (t: MatchTarget): MatchTarget =>
  ({ ...t, identityKey: propertyIdentityKey(t) });

describe("scoreMatch - the brief's worked example", () => {
  it("scores a re-sent deal as an exact match on identity key", () => {
    const t = withKey(target({}));
    const subject = withKey(target({
      address: "16 Conduit St, Mayfair, London W1S 2XJ", broker: "CBRE", price: 11_900_000,
    }));
    const r = scoreMatch(subject, t);
    expect(r.band).toBe("exact");
    expect(matchPercent(r.score)).toBe(100);
  });

  it("scores the same building described loosely in the strong or possible band", () => {
    const r = scoreMatch(
      { address: "16 Conduit Street", postcode: "W1S 2XJ", name: "16 Conduit Street" },
      target({}));
    expect(r.score).toBeGreaterThanOrEqual(BANDS.possible);
    expect(r.reasons.join(" ")).toMatch(/postcode/i);
  });
});

describe("scoreMatch - the signals behave as designed", () => {
  it("caps a definite postcode conflict below the review floor", () => {
    const r = scoreMatch(
      { address: "16 Conduit Street", postcode: "EC2V 7HH" },
      target({}));
    // A near-identical address must not rescue two different postcodes.
    expect(r.signals.postcode).toBe(0);
    expect(r.score).toBeLessThan(BANDS.possible);
    expect(r.band).toBe("weak");
    expect(r.reasons.join(" ")).toMatch(/Different postcodes/);
  });

  it("treats the same postcode district as proximity, not identity", () => {
    const r = scoreMatch(
      { address: "44 Different Road", postcode: "W1S 4AA", name: "Different Building" },
      target({}));
    expect(r.signals.postcode).toBeGreaterThan(0);
    expect(r.signals.postcode).toBeLessThan(0.35);
    expect(r.band).toBe("weak");
  });

  it("never lets broker and price alone suggest a merge", () => {
    const r = scoreMatch(
      { name: "Completely Different Asset", broker: "Knight Frank", price: 12_500_000 },
      target({ address: null, postcode: null }));
    expect(r.score).toBeLessThan(BANDS.possible);
    expect(r.band).toBe("weak");
  });

  it("separates two buildings on the same street", () => {
    const a = withKey(target({}));
    const b = withKey(target({ address: "22 Conduit Street, London", name: "22 Conduit Street" }));
    const r = scoreMatch(b, a);
    expect(r.band).not.toBe("exact");
    expect(r.score).toBeLessThan(BANDS.strong);
  });

  it("scores nothing when there is nothing to compare", () => {
    expect(scoreMatch({}, target({})).score).toBe(0);
  });
});

describe("bandFor", () => {
  it("bands scores as documented", () => {
    expect(bandFor(1)).toBe("exact");
    expect(bandFor(0.92)).toBe("strong");
    expect(bandFor(0.7)).toBe("possible");
    expect(bandFor(0.3)).toBe("weak");
  });
});

describe("rankMatches", () => {
  const targets = [
    withKey(target({ propertyId: "p1" })),
    withKey(target({ propertyId: "p2", address: "22 Conduit Street, London", name: "22 Conduit Street" })),
    withKey(target({ propertyId: "p3", address: "1 Dam Square, Amsterdam", postcode: "1012 JS",
                     name: "Magna Plaza", broker: "CBRE", price: 85_000_000 })),
  ];

  it("returns the best candidate first and drops weak ones", () => {
    const ranked = rankMatches(withKey(target({})), targets);
    expect(ranked[0].target.propertyId).toBe("p1");
    expect(ranked.every((r) => r.score >= BANDS.possible)).toBe(true);
    expect(ranked.map((r) => r.target.propertyId)).not.toContain("p3");
  });

  it("returns nothing for an unrelated property", () => {
    const ranked = rankMatches(
      { address: "500 Nowhere Lane, Leeds", postcode: "LS1 1AA", name: "Nowhere House" },
      targets);
    expect(ranked).toHaveLength(0);
  });
});

describe("disposition - never merges silently", () => {
  const targets = [withKey(target({}))];

  it("creates a new opportunity when nothing matches", () => {
    const d = disposition({ address: "500 Nowhere Lane, Leeds", postcode: "LS1 1AA" }, targets);
    expect(d.action).toBe("create");
  });

  it("pre-selects, but still routes an exact match through confirmation", () => {
    const d = disposition(withKey(target({ broker: "Savills" })), targets);
    expect(d.action).toBe("attach");
    if (d.action === "attach") {
      expect(d.reason).toMatch(/confirmation/i);
      expect(d.candidate.band).toBe("exact");
    }
  });

  it("sends anything short of exact to review with its candidates", () => {
    // Same street address, but the source states no postcode - strong, not exact.
    const d = disposition({ address: "16 Conduit St", name: "16 Conduit Street" }, targets);
    expect(d.action).toBe("review");
    if (d.action === "review") {
      expect(d.candidates.length).toBeGreaterThan(0);
      expect(d.candidates[0].band).toBe("strong");
      expect(d.candidates[0].reasons.length).toBeGreaterThan(0);
    }
  });

  it("never reaches the exact band without an identity-key match", () => {
    const r = scoreMatch({ address: "16 Conduit St", name: "16 Conduit Street" }, withKey(target({})));
    expect(r.band).not.toBe("exact");
    expect(r.score).toBeLessThan(BANDS.exact);
  });

  it("does not punish a source merely for omitting a postcode", () => {
    const withPostcode = scoreMatch({ address: "16 Conduit Street, London", postcode: "W1S 2XJ" }, target({}));
    const without = scoreMatch({ address: "16 Conduit Street, London" }, target({}));
    expect(without.score).toBeGreaterThanOrEqual(BANDS.strong);
    expect(withPostcode.score).toBeGreaterThanOrEqual(without.score);
  });

  it("explains every score, so the review screen can show why", () => {
    const d = disposition({ address: "16 Conduit Street", postcode: "W1S 2XJ", broker: "Knight Frank" }, targets);
    if (d.action === "review") {
      expect(Object.keys(d.candidates[0].signals).length).toBeGreaterThan(1);
    }
  });
});
