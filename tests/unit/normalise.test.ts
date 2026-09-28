import { describe, it, expect } from "vitest";
import {
  findPostcode, normalisePostcode, normaliseAddress, normaliseName,
  normaliseCountry, propertyIdentityKey, similarity,
} from "@/lib/ingestion/normalise";

describe("findPostcode", () => {
  it("finds UK postcodes in any spacing or case", () => {
    expect(findPostcode("16 Conduit Street, London W1S 2XJ")?.formatted).toBe("W1S 2XJ");
    expect(findPostcode("w1s2xj")?.formatted).toBe("W1S 2XJ");
    expect(findPostcode("EC2V 7HH")?.compact).toBe("EC2V7HH");
    expect(findPostcode("SW1A 1AA")?.outward).toBe("SW1A");
  });
  it("finds Dutch postcodes", () => {
    const nl = findPostcode("Herengracht 124, 1015 BT Amsterdam");
    expect(nl?.formatted).toBe("1015 BT");
    expect(nl?.country).toBe("NL");
  });
  it("returns null when there is no postcode rather than guessing", () => {
    expect(findPostcode("Mayfair, London")).toBeNull();
    expect(findPostcode(null)).toBeNull();
    expect(normalisePostcode("no postcode here")).toBeNull();
  });
});

describe("normaliseAddress", () => {
  it("expands street abbreviations", () => {
    expect(normaliseAddress("16 Conduit St")).toBe("16 conduit street");
    expect(normaliseAddress("4 Berkeley Sq")).toBe("4 berkeley square");
    expect(normaliseAddress("22 Grosvenor St.")).toBe("22 grosvenor street");
  });
  it("does not corrupt words that merely start with an abbreviation", () => {
    expect(normaliseAddress("10 Stanhope Gate")).toBe("10 stanhope gate");
    expect(normaliseAddress("1 Street Lane")).toBe("1 street lane");
  });
  it("strips the postcode, which is carried separately", () => {
    expect(normaliseAddress("16 Conduit Street, London W1S 2XJ")).toBe("16 conduit street london");
  });
  it("strips unit and floor noise", () => {
    expect(normaliseAddress("Unit 16, Conduit Street")).toBe("conduit street");
    expect(normaliseAddress("Second Floor, 22 Grosvenor Street")).toBe("22 grosvenor street");
  });
  it("folds accents so Dutch and French addresses match", () => {
    expect(normaliseAddress("Hérengracht 124")).toBe(normaliseAddress("Herengracht 124"));
  });
  it("handles empty input", () => {
    expect(normaliseAddress(null)).toBe("");
    expect(normaliseAddress("")).toBe("");
  });
});

describe("normaliseName", () => {
  it("drops articles and company suffixes", () => {
    expect(normaliseName("The Mayfair Building Ltd")).toBe("mayfair building");
    expect(normaliseName("Knight Frank LLP")).toBe("knight frank");
    expect(normaliseName("Sakura Capital B.V.")).toBe("sakura capital");
  });
});

describe("normaliseCountry", () => {
  it("maps common spellings to ISO alpha-2", () => {
    expect(normaliseCountry("United Kingdom")).toBe("GB");
    expect(normaliseCountry("uk")).toBe("GB");
    expect(normaliseCountry("The Netherlands")).toBe("NL");
    expect(normaliseCountry("Japan")).toBe("JP");
  });
  it("leaves an unknown country unknown", () => {
    expect(normaliseCountry("Atlantis")).toBeNull();
    expect(normaliseCountry(null)).toBeNull();
  });
});

describe("propertyIdentityKey", () => {
  it("gives three spellings of one building the same key", () => {
    const a = propertyIdentityKey({ address: "16 Conduit St, Mayfair, London W1S 2XJ" });
    const b = propertyIdentityKey({ address: "16 Conduit Street, London", postcode: "W1S 2XJ" });
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });
  it("separates different buildings in the same postcode", () => {
    const a = propertyIdentityKey({ address: "16 Conduit Street", postcode: "W1S 2XJ" });
    const b = propertyIdentityKey({ address: "22 Conduit Street", postcode: "W1S 2XJ" });
    expect(a).not.toBe(b);
  });
  it("produces one address-led key form, with no postcode in it", () => {
    // Postcode is stored as an enrichable attribute, never part of the key: the
    // deferred email-extraction phase sees postcodes the pipeline load never
    // did, and a second key form would duplicate every property already loaded.
    const withPostcode = propertyIdentityKey({
      address: "24-26 Spring Street, Paddington, London W2 1JA",
    });
    const without = propertyIdentityKey({ address: "24-26 Spring Street" });
    expect(withPostcode).toBe("24-26springstreet");
    expect(without).toBe(withPostcode);
  });
  it("refuses to key on a name alone, so it can never auto-merge a brochure title", () => {
    expect(propertyIdentityKey({ name: "Mayfair Asset" })).toBeNull();
    expect(propertyIdentityKey({ name: "Mayfair Asset", city: "London" })).toBeNull();
    expect(propertyIdentityKey({})).toBeNull();
  });
  it("keys a London street with no type suffix consistently", () => {
    // Bishopsgate, Cheapside, Aldwych and Poultry are streets whose names carry
    // no "Street"/"Road" suffix. The token after the name is the city, so a
    // listing that mentions London and one that does not must still agree.
    const withCity = propertyIdentityKey({ address: "8 Bishopsgate, London EC2N 4BQ" });
    const without = propertyIdentityKey({ address: "8 Bishopsgate", postcode: "EC2N 4BQ" });
    expect(withCity).not.toBeNull();
    expect(withCity).toBe(without);
  });

  it("still separates different numbers on such a street", () => {
    expect(propertyIdentityKey({ address: "8 Bishopsgate, London EC2N 4BQ" }))
      .not.toBe(propertyIdentityKey({ address: "22 Bishopsgate, London EC2N 4BQ" }));
  });

  it("ignores unit designators when keying", () => {
    const a = propertyIdentityKey({ address: "Unit 3, 16 Conduit Street", postcode: "W1S 2XJ" });
    const b = propertyIdentityKey({ address: "16 Conduit Street", postcode: "W1S 2XJ" });
    expect(a).toBe(b);
  });
});

describe("similarity", () => {
  it("scores identical strings 1", () => {
    expect(similarity("16 conduit street", "16 conduit street")).toBe(1);
  });
  it("scores near matches high and unrelated strings low", () => {
    expect(similarity("16 conduit street", "16 conduit st")).toBeGreaterThan(0.75);
    expect(similarity("16 conduit street", "40 gresham street")).toBeLessThan(0.6);
  });
  it("handles empty input", () => {
    expect(similarity("", "anything")).toBe(0);
  });
});

describe("\"St\" is Saint far more often than Street", () => {
  it("keeps the street name when St abbreviates Saint", () => {
    // Expanding blindly gave "12 street george street", keyed "12street" - the
    // building gone, and one house number from merging with 12 St Mary Axe.
    expect(propertyIdentityKey({ address: "12 St George Street" })).toBe("12saintgeorgestreet");
    expect(propertyIdentityKey({ address: "60 St James's Street" })).toBe("60saintjamessstreet");
    expect(propertyIdentityKey({ address: "36-39 St Martins Lane" })).toBe("36-39saintmartinslane");
    expect(propertyIdentityKey({ address: "24 St James's Square" })).toBe("24saintjamesssquare");
  });

  it("still expands St when it IS the street type", () => {
    expect(propertyIdentityKey({ address: "16 Conduit St, Mayfair" }))
      .toBe(propertyIdentityKey({ address: "16 Conduit Street, Mayfair" }));
  });

  it("no longer lets two Saint streets collide on their house number", () => {
    expect(propertyIdentityKey({ address: "12 St George Street" }))
      .not.toBe(propertyIdentityKey({ address: "12 St Mary Axe" }));
  });
});

describe("The house number may lead or trail", () => {
  it("composes Dutch addresses canonically", () => {
    // streetPart used to stop at the street type, which in Dutch is the FIRST
    // token, discarding the house number entirely.
    expect(propertyIdentityKey({ address: "Wolvenstraat 23" })).toBe("23wolvenstraat");
    expect(propertyIdentityKey({ address: "Herengracht 567" })).toBe("567herengracht");
    expect(propertyIdentityKey({ address: "Keizersgracht 125-127" })).toBe("125-127keizersgracht");
  });

  it("keeps two buildings on one Dutch street apart", () => {
    expect(propertyIdentityKey({ address: "Wolvenstraat 23" }))
      .not.toBe(propertyIdentityKey({ address: "Wolvenstraat 99" }));
  });

  it("agrees whichever convention the source used", () => {
    expect(propertyIdentityKey({ address: "Herengracht 124" }))
      .toBe(propertyIdentityKey({ address: "124 Herengracht" }));
  });

  it("leaves a street with no house number unkeyable", () => {
    // A street name alone identifies a STREET, not a building. Unkeyable can be
    // upgraded when a source supplies a number; a false merge cannot be undone.
    expect(propertyIdentityKey({ address: "Nieuwe Herengracht" })).toBeNull();
    expect(propertyIdentityKey({ address: "York House" })).toBeNull();
    expect(propertyIdentityKey({ address: "Royal Exchange" })).toBeNull();
  });
});
