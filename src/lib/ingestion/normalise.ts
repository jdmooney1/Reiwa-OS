// ============================================================================
// Address and name normalisation - the basis of property identity.
// ----------------------------------------------------------------------------
// Two brokers describe the same building three different ways. Everything that
// deduplicates depends on reducing those spellings to a stable key:
//
//   "16 Conduit St, Mayfair, London W1S 2XJ"  ─┐
//   "16 Conduit Street, London"                ├─> w1s2xj|16conduitstreet
//   "Unit 16, Conduit Street, W1S 2XJ"        ─┘
//
// The postcode is the strongest signal in UK and Dutch material, so the key is
// postcode-led where one exists and address-led where it does not.
//
// Pure module: no server imports, no I/O. Fully unit tested.
// ============================================================================

/** Combining diacritical marks, stripped after NFKD so accented spellings match. */
const ACCENTS = /[\u0300-\u036f]/g;

/** Street-type abbreviations, expanded to their full form before keying. */
const STREET_TYPES: Record<string, string> = {
  st: "street", str: "street", rd: "road", ave: "avenue", av: "avenue",
  pl: "place", sq: "square", ln: "lane", dr: "drive", ct: "court",
  cres: "crescent", gdns: "gardens", gdn: "garden", ter: "terrace",
  pde: "parade", bldg: "building", bldgs: "buildings", hse: "house",
  pk: "park", mt: "mount", wy: "way", hwy: "highway", blvd: "boulevard",
  // Dutch - the Amsterdam market is in scope from day one.
  str_nl: "straat", gr: "gracht", ln_nl: "laan",
};

/** Noise that carries no identity: unit designators, floors, marketing suffixes. */
const NOISE = [
  // Ordinal floors first: the generic designator below would otherwise eat the
  // word "floor" on its own and strand the ordinal ("second , 22 Grosvenor St").
  /\b(ground|first|second|third|fourth|fifth|sixth|lower|upper|basement|mezzanine)\s+floors?\b/gi,
  /\b(unit|suite|apartment|apt|flat|room|floor|fl|level|lvl|block|phase)\s*\.?\s*[\w-]*\b/gi,
  /\b(c\/o|care of|attn|attention)\b.*/gi,
  /\b(the\s+)?(freehold|leasehold|long leasehold|virtual freehold)\b/gi,
  /\b(investment|opportunity|for sale|to let|portfolio|asset)\b/gi,
];

const COUNTRY_ALIASES: Record<string, string> = {
  uk: "GB", "united kingdom": "GB", gb: "GB", "great britain": "GB",
  england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  nl: "NL", netherlands: "NL", "the netherlands": "NL", holland: "NL",
  de: "DE", germany: "DE", deutschland: "DE",
  fr: "FR", france: "FR",
  ie: "IE", ireland: "IE",
  es: "ES", spain: "ES",
  it: "IT", italy: "IT",
  be: "BE", belgium: "BE",
  jp: "JP", japan: "JP",
  us: "US", usa: "US", "united states": "US",
};

/** ISO-3166-1 alpha-2, or null. Unknown countries stay unknown. */
export function normaliseCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\./g, "");
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  return /^[A-Za-z]{2}$/.test(key) ? key.toUpperCase() : null;
}

// ---- Postcodes -------------------------------------------------------------
// UK: SW1A 1AA / W1S 2XJ / EC2V 7HH. Dutch: 1017 CA.
const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const NL_POSTCODE = /\b(\d{4})\s*([A-Z]{2})\b/i;

export interface PostcodeMatch {
  /** Canonical, spaced form for display: "W1S 2XJ" / "1017 CA". */
  formatted: string;
  /** Comparison form: no spaces, upper case. */
  compact: string;
  /** The routeable prefix - "W1S" / "1017". Useful for proximity, not identity. */
  outward: string;
  country: "GB" | "NL";
}

/** Find a postcode anywhere in a string. Returns null rather than guessing. */
export function findPostcode(raw: string | null | undefined): PostcodeMatch | null {
  if (!raw) return null;
  const text = String(raw);

  const uk = text.match(UK_POSTCODE);
  if (uk) {
    const outward = uk[1].toUpperCase();
    const inward = uk[2].toUpperCase();
    return {
      formatted: `${outward} ${inward}`,
      compact: `${outward}${inward}`,
      outward,
      country: "GB",
    };
  }

  const nl = text.match(NL_POSTCODE);
  if (nl) {
    const outward = nl[1];
    const inward = nl[2].toUpperCase();
    return {
      formatted: `${outward} ${inward}`,
      compact: `${outward}${inward}`,
      outward,
      country: "NL",
    };
  }

  return null;
}

export function normalisePostcode(raw: string | null | undefined): string | null {
  return findPostcode(raw)?.formatted ?? null;
}

// ---- Address ---------------------------------------------------------------
/**
 * Reduce an address to a comparable form: lower case, accents folded,
 * abbreviations expanded, unit/floor noise removed, postcode stripped (it is
 * carried separately), punctuation and duplicate whitespace gone.
 */
export function normaliseAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw)
    .normalize("NFKD")
    .replace(ACCENTS, "")   // fold accents: Herengracht vs Hérengracht
    .toLowerCase();

  // Remove the postcode - it is a separate, stronger signal.
  s = s.replace(UK_POSTCODE, " ").replace(NL_POSTCODE, " ");

  for (const pattern of NOISE) s = s.replace(pattern, " ");

  s = s
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Expand street-type abbreviations token by token, so "st" inside "street"
  // or "Stanhope" is untouched.
  const expanded = s.split(" ").map((token) => {
    const bare = token.replace(/-/g, "");
    return STREET_TYPES[bare] ?? token;
  });

  return expanded.join(" ").replace(/\s+/g, " ").trim();
}

/** Normalise a property or organisation name for comparison. */
export function normaliseName(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .normalize("NFKD")
    .replace(ACCENTS, "")
    .toLowerCase()
    // Dots are removed rather than spaced, so "B.V." collapses to the single
    // token "bv" that the suffix pattern can then match.
    .replace(/\./g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\b(ltd|limited|llp|plc|inc|bv|nv|gmbh|sa|sarl|llc|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Identity key ----------------------------------------------------------
export interface IdentityInput {
  address?: string | null;
  postcode?: string | null;
  name?: string | null;
  city?: string | null;
}

/**
 * The deduplication key for a property, or null when there is not enough to
 * identify one. A null key means "always create, never auto-match" - which is
 * the safe direction: a missed match is a review task, a false match silently
 * merges two buildings.
 *
 * Postcode-led where a postcode exists, because it survives address spelling
 * differences. Address-led otherwise. A name alone is never enough: "Mayfair
 * Asset" is a brochure title, not an identity.
 */
export function propertyIdentityKey(input: IdentityInput): string | null {
  const postcode = findPostcode(input.postcode) ?? findPostcode(input.address);
  const address = normaliseAddress(input.address);
  const street = streetPart(address);

  if (postcode) {
    // Postcode plus the street part only. The rest of the address - district,
    // city, county - is exactly what varies between brokers describing the same
    // building, so including it would manufacture false negatives.
    const detail = street ?? collapse(normaliseName(input.name));
    return detail ? `pc:${postcode.compact}|${detail}` : `pc:${postcode.compact}`;
  }

  if (street && /\d/.test(street)) {
    const city = collapse(normaliseName(input.city));
    return `ad:${street}${city ? `|${city}` : ""}`;
  }

  return null;
}

/** Full street-type words that terminate the street part of an address. */
const STREET_TYPE_WORDS = new Set([
  "street", "road", "avenue", "place", "square", "lane", "drive", "court",
  "crescent", "gardens", "garden", "terrace", "parade", "way", "hill", "row",
  "walk", "close", "mews", "wharf", "quay", "park", "gate", "yard", "rise",
  "grove", "green", "bridge", "circus", "embankment", "building", "buildings",
  "house", "boulevard", "highway", "mount",
]);

/** Dutch compound street suffixes: "herengracht", "kalverstraat", "museumplein". */
const DUTCH_STREET_SUFFIX = /(straat|gracht|laan|plein|kade|weg|dijk|markt|steeg)$/;

function isStreetType(token: string): boolean {
  return STREET_TYPE_WORDS.has(token) || DUTCH_STREET_SUFFIX.test(token);
}

/**
 * The identifying part of a normalised address: the building number plus the
 * street name, stopping at the street type.
 *
 *   "16 conduit street mayfair london" -> "16conduitstreet"
 *   "124 herengracht amsterdam"        -> "124herengracht"
 *
 * Falls back to the first two tokens when no street type is recognisable, which
 * keeps unfamiliar formats comparable without swallowing the whole tail.
 */
export function streetPart(address: string): string | null {
  if (!address) return null;
  const tokens = address.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  const numberMatch = tokens[0].match(/^\d+[a-z]?(?:-\d+[a-z]?)?$/);
  const start = numberMatch ? 1 : 0;
  const number = numberMatch ? tokens[0] : "";

  const rest = tokens.slice(start);
  if (rest.length === 0) return number || null;

  const typeIndex = rest.findIndex(isStreetType);
  const name = typeIndex >= 0 ? rest.slice(0, typeIndex + 1) : rest.slice(0, 2);

  const joined = collapse(`${number}${name.join("")}`);
  return joined || null;
}

/** Space-free form used inside keys. */
function collapse(value: string): string {
  return value.replace(/\s+/g, "");
}

// ---- Similarity ------------------------------------------------------------
/**
 * Dice coefficient over character bigrams: 0-1, order-insensitive enough for
 * address and name comparison and cheap enough to run over a candidate set.
 */
export function similarity(a: string, b: string): number {
  const x = a.replace(/\s+/g, " ").trim();
  const y = b.replace(/\s+/g, " ").trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }

  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const count = bigrams.get(g) ?? 0;
    if (count > 0) { bigrams.set(g, count - 1); hits++; }
  }

  return (2 * hits) / (x.length - 1 + y.length - 1);
}

/**
 * The leading building number of a normalised address, or null.
 * This is the discriminator between 16 and 22 Conduit Street, so the matcher
 * treats a mismatch here as strong evidence of two different buildings.
 */
export function buildingNumber(address: string | null | undefined): string | null {
  const normalised = normaliseAddress(address);
  return normalised.match(/^(\d+[a-z]?(?:-\d+[a-z]?)?)\b/)?.[1] ?? null;
}
