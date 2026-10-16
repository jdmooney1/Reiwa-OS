// ============================================================================
// Teaser intake: what a model may read out of a broker teaser, and how a
// reviewed reading becomes a deal-seed record. PURE and client-safe: it imports
// zod and the seed parser's reference helper, nothing that opens a connection.
// ----------------------------------------------------------------------------
// THE SHAPE IS THE CONTRACT. TeaserExtractionSchema is handed to the model as a
// structured-output format, so every field comes back typed or null. A model
// never writes to the database: its reading goes to a person on the review
// screen, the person's edited version comes back to the server, is re-checked
// against this same schema, mapped by toSeedRecord(), and then refused or
// accepted by parseDealSeed() exactly as a hand-written seed file would be.
//
// NULL STAYS NULL, as in the seed parser. The prompt tells the model to leave a
// field null rather than estimate it, and toSeedRecord() never fills a gap.
// Money is in the currency the teaser states; nothing is converted.
// ============================================================================
import { z } from "zod";

/** The seed parser's own asset-type words (lib/ingestion/deal-seed.ts), plus an explicit "other". */
export const ASSET_TYPES = [
  "office", "retail", "industrial", "logistics", "residential", "multifamily", "hotel",
  "student housing", "healthcare", "data centre", "mixed use", "land", "other",
] as const;
export const TENURES = ["freehold", "virtual freehold", "long leasehold", "short leasehold"] as const;
export const DEAL_STAGES = ["early_dialogue", "guided", "under_offer"] as const;
export const CURRENCIES = ["GBP", "EUR", "USD", "JPY"] as const;
export const DOCUMENT_KINDS = ["teaser", "information_memorandum", "brochure", "other"] as const;
/** The uses a tenancy line can have: the underwriting engine's own vocabulary (lib/underwrite). */
export const TENANT_USES = ["office", "retail", "residential", "industrial", "hotel", "other"] as const;

const text = z.string().nullable();
const num = z.number().nullable();

export const TeaserExtractionSchema = z.object({
  document: z.object({
    /** False when the file is not marketing material for a property investment. */
    is_property_investment_material: z.boolean(),
    kind: z.enum(DOCUMENT_KINDS),
    /** Anything the reader should know about the file itself: illegible pages, several properties, and so on. */
    note: text,
  }),
  opportunity: z.object({
    name: text,
    address: text,
    /** The city, e.g. "London", "Amsterdam". */
    market: text,
    country: text,
    asset_type: z.enum(ASSET_TYPES).nullable(),
    off_market: z.boolean().nullable(),
    deal_stage: z.enum(DEAL_STAGES).nullable(),
    broker_name: text,
    source_contact_name: text,
    vendor: text,
  }),
  asset_snapshot: z.object({
    size_sq_ft: num,
    size_sq_m: num,
    tenure: z.enum(TENURES).nullable(),
    unexpired_term_years: num,
    ground_rent_pa: num,
    ground_rent_note: text,
    heritage_status: text,
    epc_rating: text,
    wault_to_expiry_years: num,
    wault_to_breaks_years: num,
    covenant_rating: text,
    rent_review_mechanism: text,
    transport_connectivity: text,
    passing_rent_pa: num,
    erv_pa: num,
    occupancy_percent: num,
    number_of_units: num,
    year_built_or_refurbished: text,
  }),
  deal_terms: z.object({
    currency: z.enum(CURRENCIES).nullable(),
    guide_price: num,
    /** "Offers in excess of", "Price on application", ... verbatim. */
    price_basis: text,
    niy_percent: num,
    price_psf: num,
    /** Per square metre, as European teasers quote it. Kept as a source fact; never converted. */
    price_psm: num,
    sale_structure: text,
  }),
  tenants: z.array(z.object({
    name: z.string(),
    /** The unit or floor the tenant occupies, as the schedule names it. */
    unit: text,
    use: z.enum(TENANT_USES).nullable(),
    area_sq_ft: num,
    area_sq_m: num,
    rent_pa: num,
    erv_pa: num,
    lease_expiry: text,
    break_option: text,
  })),
  highlights: z.array(z.string()),
  other_facts: z.array(z.object({ label: z.string(), value: z.string() })),
  /** Where each filled field was read: "opportunity.address", page 1, the words on the page. */
  evidence: z.array(z.object({ field: z.string(), page: num, quote: z.string() })),
  /** One line on what the teaser does and does not say. */
  data_completeness: text,
});

export type TeaserExtraction = z.infer<typeof TeaserExtractionSchema>;
export type EvidenceItem = TeaserExtraction["evidence"][number];

// ---- The review screen ----------------------------------------------------
export type ReviewSection = "opportunity" | "asset_snapshot" | "deal_terms";
export interface ReviewField {
  section: ReviewSection;
  key: string;
  label: string;
  kind: "text" | "number" | "boolean" | "enum";
  options?: readonly string[];
  /** Shown beside the input: "%", "sq ft", "years". */
  unit?: string;
  /** The seed parser refuses a record without it. */
  required?: boolean;
}

export const REVIEW_FIELDS: ReviewField[] = [
  { section: "opportunity", key: "name", label: "Deal name", kind: "text", required: true },
  { section: "opportunity", key: "address", label: "Address", kind: "text", required: true },
  { section: "opportunity", key: "market", label: "City", kind: "text" },
  { section: "opportunity", key: "country", label: "Country", kind: "text" },
  { section: "opportunity", key: "asset_type", label: "Asset type", kind: "enum", options: ASSET_TYPES, required: true },
  { section: "opportunity", key: "deal_stage", label: "Broker's stage", kind: "enum", options: DEAL_STAGES },
  { section: "opportunity", key: "off_market", label: "Off market", kind: "boolean" },
  { section: "opportunity", key: "broker_name", label: "Broker firm", kind: "text" },
  { section: "opportunity", key: "source_contact_name", label: "Broker contact", kind: "text" },
  { section: "opportunity", key: "vendor", label: "Vendor", kind: "text" },
  { section: "deal_terms", key: "currency", label: "Currency", kind: "enum", options: CURRENCIES, required: true },
  { section: "deal_terms", key: "guide_price", label: "Guide price", kind: "number" },
  { section: "deal_terms", key: "price_basis", label: "Price basis", kind: "text" },
  { section: "deal_terms", key: "niy_percent", label: "NIY", kind: "number", unit: "%" },
  { section: "deal_terms", key: "price_psf", label: "Price per sq ft", kind: "number" },
  { section: "deal_terms", key: "price_psm", label: "Price per sq m", kind: "number" },
  { section: "deal_terms", key: "sale_structure", label: "Sale structure", kind: "text" },
  { section: "asset_snapshot", key: "passing_rent_pa", label: "Passing rent pa", kind: "number" },
  { section: "asset_snapshot", key: "erv_pa", label: "ERV pa", kind: "number" },
  { section: "asset_snapshot", key: "size_sq_ft", label: "Size", kind: "number", unit: "sq ft" },
  { section: "asset_snapshot", key: "size_sq_m", label: "Size", kind: "number", unit: "sq m" },
  { section: "asset_snapshot", key: "tenure", label: "Tenure", kind: "enum", options: TENURES },
  { section: "asset_snapshot", key: "unexpired_term_years", label: "Unexpired term", kind: "number", unit: "years" },
  { section: "asset_snapshot", key: "ground_rent_pa", label: "Ground rent pa", kind: "number" },
  { section: "asset_snapshot", key: "ground_rent_note", label: "Ground rent (words)", kind: "text" },
  { section: "asset_snapshot", key: "wault_to_expiry_years", label: "WAULT to expiry", kind: "number", unit: "years" },
  { section: "asset_snapshot", key: "wault_to_breaks_years", label: "WAULT to breaks", kind: "number", unit: "years" },
  { section: "asset_snapshot", key: "occupancy_percent", label: "Occupancy", kind: "number", unit: "%" },
  { section: "asset_snapshot", key: "number_of_units", label: "Units", kind: "number" },
  { section: "asset_snapshot", key: "covenant_rating", label: "Covenant", kind: "text" },
  { section: "asset_snapshot", key: "rent_review_mechanism", label: "Rent reviews", kind: "text" },
  { section: "asset_snapshot", key: "epc_rating", label: "EPC", kind: "text" },
  { section: "asset_snapshot", key: "heritage_status", label: "Heritage / listing", kind: "text" },
  { section: "asset_snapshot", key: "year_built_or_refurbished", label: "Built / refurbished", kind: "text" },
  { section: "asset_snapshot", key: "transport_connectivity", label: "Transport", kind: "text" },
];

/** Where a reviewed field's evidence sits: "opportunity.address". */
export const fieldPath = (f: Pick<ReviewField, "section" | "key">) => `${f.section}.${f.key}`;

// ---- Into the seed --------------------------------------------------------
/**
 * The reference a teaser-made deal carries: the name, plus the upload it came
 * from. Unique per upload ON PURPOSE, so a teaser never lands on an existing
 * row through seedDeal()'s "same reference, fill the blanks" path; a second
 * teaser for a building already in the pipeline meets the duplicate check and
 * is held for a person to decide. A different prefix from the command-line
 * seed (SEED-), and never empty for a name in a script the slug cannot spell.
 */
export function intakeReference(name: string, uploadId: string): string {
  const slug = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const tag = uploadId.replace(/[^0-9a-f]/gi, "").slice(0, 8).toUpperCase() || "X";
  return slug ? `IM-${slug.toUpperCase()}-${tag}` : `IM-${tag}`;
}

/** The upload id inside an intake path (intake/<user>/<uuid>.<ext>), or "" for anything else. */
export function uploadIdOf(path: string): string {
  return /\/([0-9a-f-]{36})\.[a-z]+$/i.exec(path)?.[1] ?? "";
}

/**
 * The database's own length limits on the text a teaser fills (migration 0032).
 * A longer reading is shortened for the column and kept in full in source_facts,
 * so nothing a teaser said is lost and no limit becomes an opaque failure.
 */
export const TEXT_LIMITS: Record<string, number> = {
  heritage_status: 200, ground_rent_note: 200, covenant_rating: 200,
  rent_review_mechanism: 500, transport_connectivity: 500, epc_rating: 50,
};
const DATA_COMPLETENESS_LIMIT = 1000;
const clip = (v: string, n: number) => (v.length <= n ? v : `${v.slice(0, n - 1).trimEnd()}…`);

/** Upper bounds the columns can hold, by kind of figure. Above them a figure is a misreading. */
const NUMBER_LIMITS: Record<string, number> = {
  unexpired_term_years: 999, wault_to_expiry_years: 999, wault_to_breaks_years: 999,
  niy_percent: 100, occupancy_percent: 100, number_of_units: 1_000_000,
  size_sq_ft: 1e9, size_sq_m: 1e8,
  guide_price: 1e15, passing_rent_pa: 1e15, erv_pa: 1e15, ground_rent_pa: 1e11, price_psf: 1e9, price_psm: 1e10,
};

/** Figures the database could not hold: one line each, named as the form names them. */
export function rangeProblems(x: TeaserExtraction): string[] {
  const out: string[] = [];
  for (const f of REVIEW_FIELDS) {
    if (f.kind !== "number") continue;
    const v = (x[f.section] as Record<string, unknown>)[f.key];
    const max = NUMBER_LIMITS[f.key];
    if (typeof v === "number" && max !== undefined && v > max) {
      out.push(`${f.label}${f.unit ? ` (${f.unit})` : ""} of ${v.toLocaleString("en-GB")} is larger than any real figure; check it was read correctly.`);
    }
  }
  return out;
}

/** The source line on the opportunity: the broker when the teaser names one, the file otherwise. */
export function sourcingLine(broker: string | null, contact: string | null, fileName: string | null): string {
  if (broker && contact) return `Broker IM, ${broker} (${contact})`;
  if (broker) return `Broker IM, ${broker}`;
  return fileName ? `Teaser upload (${fileName})` : "Teaser upload";
}

type Obj = Record<string, unknown>;
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
/** Drop null and empty values: to the seed parser, absent and null mean the same, and an unmapped null is noise in source_facts. */
function present(o: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) if (!blank(v)) out[k] = typeof v === "string" ? v.trim() : v;
  return out;
}

export interface IntakeMeta {
  fileName: string | null;
  model: string | null;
}

/**
 * A reviewed extraction -> one record in the shape parseDealSeed() reads.
 * Nothing is computed here: values are carried or dropped, never derived.
 */
export function toSeedRecord(x: TeaserExtraction, meta: IntakeMeta): Obj {
  const o = x.opportunity;
  const opportunity = present({
    name: o.name, address: o.address, market: o.market, country: o.country,
    asset_type: o.asset_type, off_market: o.off_market, deal_stage: o.deal_stage,
    broker_name: o.broker_name, source_contact_name: o.source_contact_name, vendor: o.vendor,
    sourcing: sourcingLine(o.broker_name?.trim() || null, o.source_contact_name?.trim() || null, meta.fileName),
  });
  // The parser reads ground rent in words as `ground_rent`; long text is shortened for its column.
  const { ground_rent_note, ...rest } = x.asset_snapshot;
  const snap = present({ ...rest, ground_rent: ground_rent_note });
  const fullText: Obj = {};
  for (const [k, n] of Object.entries(TEXT_LIMITS)) {
    const key = k === "ground_rent_note" ? "ground_rent" : k;
    const v = snap[key];
    if (typeof v === "string" && v.length > n) { fullText[k] = v; snap[key] = clip(v, n); }
  }
  const record: Obj = {
    opportunity,
    asset_snapshot: snap,
    deal_terms: present({ ...x.deal_terms }),
  };
  if (!blank(x.data_completeness)) {
    const dc = x.data_completeness!.trim();
    record.data_completeness = clip(dc, DATA_COMPLETENESS_LIMIT);
    if (dc.length > DATA_COMPLETENESS_LIMIT) fullText.data_completeness = dc;
  }
  // Everything below has no column: the parser keeps unknown top-level keys verbatim in source_facts.
  if (x.tenants.length) record.tenants = x.tenants.map((t) => present({ ...t }));
  if (x.highlights.length) record.highlights = x.highlights;
  if (x.other_facts.length) record.other_facts = x.other_facts;
  record.teaser_intake = present({
    file_name: meta.fileName, model: meta.model, document_kind: x.document.kind, document_note: x.document.note,
  });
  if (x.evidence.length) (record.teaser_intake as Obj).evidence = x.evidence;
  if (Object.keys(fullText).length) (record.teaser_intake as Obj).full_text = fullText;
  return record;
}

/** True when the reading carries an amount of money, which then needs a stated currency. */
export function statesMoney(x: TeaserExtraction): boolean {
  return [x.deal_terms.guide_price, x.deal_terms.price_psf, x.deal_terms.price_psm, x.asset_snapshot.passing_rent_pa, x.asset_snapshot.erv_pa,
    x.asset_snapshot.ground_rent_pa, ...x.tenants.map((t) => t.rent_pa)].some((v) => v !== null);
}

/** An empty reading, for a person to fill by hand when the model could not read the file. */
export function emptyExtraction(): TeaserExtraction {
  return {
    document: { is_property_investment_material: true, kind: "other", note: null },
    opportunity: {
      name: null, address: null, market: null, country: null, asset_type: null, off_market: null,
      deal_stage: null, broker_name: null, source_contact_name: null, vendor: null,
    },
    asset_snapshot: {
      size_sq_ft: null, size_sq_m: null, tenure: null, unexpired_term_years: null, ground_rent_pa: null,
      ground_rent_note: null, heritage_status: null, epc_rating: null, wault_to_expiry_years: null,
      wault_to_breaks_years: null, covenant_rating: null, rent_review_mechanism: null,
      transport_connectivity: null, passing_rent_pa: null, erv_pa: null, occupancy_percent: null,
      number_of_units: null, year_built_or_refurbished: null,
    },
    deal_terms: { currency: null, guide_price: null, price_basis: null, niy_percent: null, price_psf: null, price_psm: null, sale_structure: null },
    tenants: [], highlights: [], other_facts: [], evidence: [], data_completeness: null,
  };
}

// ---- Reading the model's answer ------------------------------------------
// The structured-output format carries the enum lists as guidance only, so a
// model can still answer "Mixed-use", "Long Leasehold", "£" or "12,500,000".
// This brings an answer onto the schema's vocabulary where the meaning is
// unambiguous, and to null where it is not; TeaserExtractionSchema then
// decides. A value is never guessed into a different meaning.
const ENUM_FIELDS: Record<string, readonly string[]> = {
  "opportunity.asset_type": ASSET_TYPES, "asset_snapshot.tenure": TENURES,
  "opportunity.deal_stage": DEAL_STAGES, "deal_terms.currency": CURRENCIES,
};
const CURRENCY_WORDS: Record<string, string> = {
  "£": "GBP", "€": "EUR", "$": "USD", "US$": "USD", "¥": "JPY", "円": "JPY", "STERLING": "GBP", "EURO": "EUR", "EUROS": "EUR",
};
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function enumValue(raw: unknown, allowed: readonly string[], path: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  if (path === "deal_terms.currency") {
    const t = raw.trim().toUpperCase();
    const c = CURRENCY_WORDS[t] ?? CURRENCY_WORDS[raw.trim()] ?? t;
    return allowed.includes(c) ? c : null;
  }
  const t = raw.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  const underscored = t.replace(/ /g, "_");
  if (allowed.includes(t)) return t;
  if (allowed.includes(underscored)) return underscored;
  if (path === "tenants.use" && t.endsWith("s") && allowed.includes(t.slice(0, -1))) return t.slice(0, -1);
  if (path === "opportunity.asset_type" && t === "mixed") return "mixed use";
  if (path === "opportunity.asset_type" && t === "data center") return "data centre";
  return null;
}

function numberValue(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\s,£€$¥]/g, "");
  if (!/^\d+(\.\d+)?%?$/.test(t)) return null;
  return Number(t.replace("%", ""));
}

/** Coerce a model's answer onto the schema, then validate it. Returns null when it cannot be read at all. */
export function normaliseReading(raw: unknown): TeaserExtraction | null {
  if (!isObj(raw)) return null;
  const base = emptyExtraction();
  const shape = TeaserExtractionSchema.shape;
  const out: Obj = { ...base };
  for (const section of ["opportunity", "asset_snapshot", "deal_terms"] as const) {
    const src = isObj(raw[section]) ? raw[section] as Obj : {};
    const target: Obj = { ...base[section] };
    const fields = shape[section].shape as Record<string, z.ZodTypeAny>;
    for (const key of Object.keys(fields)) {
      const v = src[key];
      const path = `${section}.${key}`;
      if (ENUM_FIELDS[path]) target[key] = enumValue(v, ENUM_FIELDS[path], path);
      else if (key === "off_market") target[key] = typeof v === "boolean" ? v : null;
      else if (fields[key].safeParse(1).success) {
        target[key] = numberValue(v);
      } else target[key] = typeof v === "string" && v.trim() ? v.trim() : null;
    }
    out[section] = target;
  }
  const doc = isObj(raw.document) ? raw.document : {};
  out.document = {
    is_property_investment_material: doc.is_property_investment_material !== false,
    kind: (DOCUMENT_KINDS as readonly string[]).includes(String(doc.kind)) ? doc.kind : "other",
    note: typeof doc.note === "string" && doc.note.trim() ? doc.note.trim() : null,
  };
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  out.tenants = arr(raw.tenants).filter(isObj).filter((t) => str(t.name)).map((t) => ({
    name: str(t.name)!, unit: str(t.unit),
    use: enumValue(t.use, TENANT_USES, "tenants.use") as (typeof TENANT_USES)[number] | null,
    area_sq_ft: numberValue(t.area_sq_ft), area_sq_m: numberValue(t.area_sq_m),
    rent_pa: numberValue(t.rent_pa), erv_pa: numberValue(t.erv_pa),
    lease_expiry: str(t.lease_expiry), break_option: str(t.break_option),
  }));
  out.highlights = arr(raw.highlights).map(str).filter((v): v is string => v !== null);
  out.other_facts = arr(raw.other_facts).filter(isObj)
    .map((f) => ({ label: str(f.label), value: str(f.value) }))
    .filter((f): f is { label: string; value: string } => f.label !== null && f.value !== null);
  out.evidence = arr(raw.evidence).filter(isObj).filter((e) => str(e.field) && str(e.quote))
    .map((e) => ({ field: str(e.field)!, page: numberValue(e.page), quote: str(e.quote)! }));
  out.data_completeness = str(raw.data_completeness);
  const checked = TeaserExtractionSchema.safeParse(out);
  return checked.success ? checked.data : null;
}
