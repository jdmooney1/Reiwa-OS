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
    sale_structure: text,
  }),
  tenants: z.array(z.object({
    name: z.string(),
    area_sq_ft: num,
    rent_pa: num,
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
  { section: "deal_terms", key: "currency", label: "Currency", kind: "enum", options: CURRENCIES },
  { section: "deal_terms", key: "guide_price", label: "Guide price", kind: "number" },
  { section: "deal_terms", key: "price_basis", label: "Price basis", kind: "text" },
  { section: "deal_terms", key: "niy_percent", label: "NIY", kind: "number", unit: "%" },
  { section: "deal_terms", key: "price_psf", label: "Price per sq ft", kind: "number" },
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
 * The stable reference a teaser-made deal carries. A different prefix from the
 * command-line seed (SEED-) so the two routes never update each other's rows;
 * dropping the same teaser twice finds the first deal and only fills blanks.
 */
export function intakeReference(name: string): string {
  const slug = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `IM-${slug.toUpperCase()}`.slice(0, 120);
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
  const record: Obj = {
    opportunity,
    asset_snapshot: present({ ...x.asset_snapshot }),
    deal_terms: present({ ...x.deal_terms }),
  };
  if (!blank(x.data_completeness)) record.data_completeness = x.data_completeness!.trim();
  // Everything below has no column: the parser keeps unknown top-level keys verbatim in source_facts.
  if (x.tenants.length) record.tenants = x.tenants.map((t) => present({ ...t }));
  if (x.highlights.length) record.highlights = x.highlights;
  if (x.other_facts.length) record.other_facts = x.other_facts;
  record.teaser_intake = present({
    file_name: meta.fileName, model: meta.model, document_kind: x.document.kind, document_note: x.document.note,
  });
  if (x.evidence.length) (record.teaser_intake as Obj).evidence = x.evidence;
  return record;
}

/** True when the reading carries an amount of money, which then needs a stated currency. */
export function statesMoney(x: TeaserExtraction): boolean {
  return [x.deal_terms.guide_price, x.deal_terms.price_psf, x.asset_snapshot.passing_rent_pa, x.asset_snapshot.erv_pa,
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
    deal_terms: { currency: null, guide_price: null, price_basis: null, niy_percent: null, price_psf: null, sale_structure: null },
    tenants: [], highlights: [], other_facts: [], evidence: [], data_completeness: null,
  };
}
