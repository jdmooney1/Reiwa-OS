// ============================================================================
// Structured deal records (broker IMs read by a person or a model) -> what the
// database holds. PURE: no connection, no clock, no I/O.
// ----------------------------------------------------------------------------
// The input is a JSON file of deals, each shaped
//   { opportunity, asset_snapshot, deal_terms, documents?, data_completeness }
// This file turns that into one normalised SeedDeal per deal, or throws with every
// problem it found, so a malformed file is refused whole rather than half-loaded.
//
// THE RULES IT HOLDS
//   * NULL STAYS NULL. A key that is absent or null becomes null. Nothing is defaulted,
//     computed to fill a gap, or inferred. A peppercorn ground rent is NOT zero; a
//     missing EPC is NOT "E".
//   * NOTHING IS DROPPED. Every source key either maps to a column or is kept, as given,
//     under `sourceFacts`, so the load is lossless and a later pass can promote a key to
//     a column when it earns one.
//   * UNKNOWN VOCABULARY IS AN ERROR. A tenure, deal stage, asset type or photo-reference
//     type this file does not know is refused, not coerced to "other".
//   * NUMBERS MUST BE NUMBERS. A mapped numeric field that arrives as text (">12,500,000")
//     is an error if it is a mapped field, and is kept as text if it is not.
//   * FLAGS, NOT FIXES. Where a record disagrees with itself, or carries a note that it
//     disagrees with something else, that is recorded as a flag. The loader never picks a
//     winner.
// ============================================================================

export type DealStage = "early_dialogue" | "guided" | "under_offer";
export type Tenure = "freehold" | "virtual_freehold" | "long_leasehold" | "short_leasehold" | "other";
export type PhotoReferenceType = "attachment_not_retrieved" | "external_url" | "none_found";
export type SourceType = "off_market" | "broker_marketed" | "other";

export interface LoaderFlag { code: string; message: string }

export interface SeedDeal {
  /** Stable per organisation: re-running updates this row instead of making another. */
  reference: string;
  name: string;
  address: string;
  market: string | null;
  assetType: string;
  sourceType: SourceType;
  dealStage: DealStage | null;
  /** The source line, verbatim. */
  sourcing: string | null;
  /** Parsed only when the line has the shape "<channel>, <firm> (<person>)". */
  brokerName: string | null;
  sourceContactName: string | null;
  /** How the source reached us: used for the property timeline. */
  sourceKind: "broker_email" | "brochure";
  sizeSqft: number | null;
  property: {
    heritageStatus: string | null;
    tenure: Tenure | null;
    unexpiredTermYears: number | null;
    groundRentPa: number | null;
    groundRentNote: string | null;
    waultToExpiryYears: number | null;
    waultToBreaksYears: number | null;
    covenantRating: string | null;
    rentReviewMechanism: string | null;
    epcRating: string | null;
    transportConnectivity: string | null;
  };
  money: { currency: string; guidePrice: number | null; niyPct: number | null; passingRent: number | null };
  photo: { type: PhotoReferenceType | null; url: string | null; attachments: string[] };
  dataCompleteness: string | null;
  /** Everything the source said that has no column yet, nested by the source's own sections. */
  sourceFacts: Record<string, unknown>;
  flags: LoaderFlag[];
}

const ASSET_TYPE: Record<string, string> = {
  "office": "office", "retail": "retail", "industrial": "industrial", "logistics": "logistics",
  "residential": "residential", "multifamily": "multifamily", "hotel": "hotel",
  "student housing": "student_housing", "healthcare": "healthcare", "data centre": "data_centre",
  "mixed use": "mixed_use", "land": "land",
};
const TENURE: Record<string, Tenure> = {
  "freehold": "freehold", "virtual freehold": "virtual_freehold",
  "long leasehold": "long_leasehold", "short leasehold": "short_leasehold",
};
const DEAL_STAGES: readonly DealStage[] = ["early_dialogue", "guided", "under_offer"];
const PHOTO_TYPES: readonly PhotoReferenceType[] = ["attachment_not_retrieved", "external_url", "none_found"];

/** Price per sq ft or rent per sq ft must reproduce the stated total within this. */
const RECONCILE_TOLERANCE = 0.015;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function seedReference(name: string): string {
  const slug = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `SEED-${slug.toUpperCase()}`;
}

/** "Broker email, Knight Frank (Jake Withers)" -> firm and person; anything else -> neither. */
export function parseSourcing(sourcing: string | null): { broker: string | null; contact: string | null; note: string | null } {
  if (!sourcing) return { broker: null, contact: null, note: null };
  const m = /^Broker (?:email|IM), (.+?) \(([^)]+)\)(?: - (NOTE: .+))?$/.exec(sourcing.trim());
  return m ? { broker: m[1].trim(), contact: m[2].trim(), note: m[3]?.trim() ?? null } : { broker: null, contact: null, note: null };
}

/** Parse and validate a whole file. Throws one Error listing every problem. */
export function parseDealSeed(raw: unknown): SeedDeal[] {
  const problems: string[] = [];
  if (!isObj(raw) || !Array.isArray(raw.deals)) throw new Error('The file must be an object with a "deals" array.');
  if (raw.deals.length === 0) throw new Error("The file has no deals.");

  const out: SeedDeal[] = [];
  const seen = new Map<string, string>();
  raw.deals.forEach((d, i) => {
    const where = isObj(d) && isObj(d.opportunity) && typeof d.opportunity.name === "string" ? `"${d.opportunity.name}"` : `deal #${i + 1}`;
    const bad = (msg: string) => problems.push(`${where}: ${msg}`);
    try {
      const deal = parseOne(d, bad);
      if (deal) {
        const clash = seen.get(deal.reference);
        if (clash) bad(`the reference ${deal.reference} is also ${clash}; names must be distinct`);
        seen.set(deal.reference, where);
        out.push(deal);
      }
    } catch (e) {
      bad((e as Error).message);
    }
  });
  if (problems.length) throw new Error(`Refusing the file (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n  - ${problems.join("\n  - ")}`);
  return out;
}

function parseOne(d: unknown, bad: (m: string) => void): SeedDeal | null {
  if (!isObj(d)) { bad("not an object"); return null; }
  const opp = isObj(d.opportunity) ? { ...d.opportunity } : null;
  if (!opp) { bad('missing "opportunity"'); return null; }
  const snap: Obj = isObj(d.asset_snapshot) ? { ...d.asset_snapshot } : {};
  const terms: Obj = isObj(d.deal_terms) ? { ...d.deal_terms } : {};
  const docs: Obj | null = isObj(d.documents) ? { ...d.documents } : null;
  const known = new Set(["opportunity", "asset_snapshot", "deal_terms", "documents", "data_completeness"]);
  const extraTop = Object.keys(d).filter((k) => !known.has(k));
  const errorsBefore = { n: 0 };
  const err = (m: string) => { errorsBefore.n++; bad(m); };

  /** Take a key out of a section (so what remains is what has no column). */
  const take = (o: Obj, k: string) => { const v = o[k]; delete o[k]; return v === undefined ? null : v; };
  const text = (o: Obj, k: string, section: string): string | null => {
    const v = take(o, k);
    if (v === null) return null;
    if (typeof v !== "string") { err(`${section}.${k} must be text or null`); return null; }
    const t = v.trim();
    return t === "" ? null : t;
  };
  const number = (o: Obj, k: string, section: string): number | null => {
    const v = take(o, k);
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) { err(`${section}.${k} must be a non-negative number or null (got ${JSON.stringify(v)})`); return null; }
    return v;
  };

  // ---- opportunity ----
  const name = text(opp, "name", "opportunity");
  const address = text(opp, "address", "opportunity");
  if (!name) err("opportunity.name is required");
  if (!address) err("opportunity.address is required (a deal with no address cannot be matched to a building)");
  const market = text(opp, "market", "opportunity");
  const assetRaw = text(opp, "asset_type", "opportunity");
  let assetType = "other";
  if (!assetRaw) err("opportunity.asset_type is required");
  else if (!(assetRaw.toLowerCase() in ASSET_TYPE)) err(`opportunity.asset_type "${assetRaw}" is not one this loader knows`);
  else assetType = ASSET_TYPE[assetRaw.toLowerCase()];
  const off = take(opp, "off_market");
  if (off !== null && typeof off !== "boolean") err("opportunity.off_market must be true, false or null");
  const sourceType: SourceType = off === true ? "off_market" : off === false ? "broker_marketed" : "other";
  const stageRaw = take(opp, "deal_stage");
  let dealStage: DealStage | null = null;
  if (stageRaw !== null) {
    if (typeof stageRaw === "string" && (DEAL_STAGES as readonly string[]).includes(stageRaw)) dealStage = stageRaw as DealStage;
    else err(`opportunity.deal_stage ${JSON.stringify(stageRaw)} must be one of ${DEAL_STAGES.join(", ")} or null`);
  }
  const sourcing = text(opp, "sourcing", "opportunity");
  const parsed = parseSourcing(sourcing);

  // ---- asset_snapshot ----
  const sizeSqft = number(snap, "size_sq_ft", "asset_snapshot");
  const tenureRaw = text(snap, "tenure", "asset_snapshot");
  let tenure: Tenure | null = null;
  if (tenureRaw !== null) {
    if (tenureRaw.toLowerCase() in TENURE) tenure = TENURE[tenureRaw.toLowerCase()];
    else err(`asset_snapshot.tenure "${tenureRaw}" is not one this loader knows (freehold, virtual freehold, long leasehold, short leasehold)`);
  }
  // Ground rent arrives as an amount ("ground_rent_gbp_pa") or as words ("ground_rent": "Peppercorn").
  const groundRentPa = number(snap, "ground_rent_gbp_pa", "asset_snapshot");
  const groundRentNote = text(snap, "ground_rent", "asset_snapshot");
  const property = {
    heritageStatus: text(snap, "heritage_status", "asset_snapshot"),
    tenure,
    unexpiredTermYears: number(snap, "unexpired_term_years", "asset_snapshot"),
    groundRentPa,
    groundRentNote,
    waultToExpiryYears: number(snap, "wault_to_expiry_years", "asset_snapshot"),
    waultToBreaksYears: number(snap, "wault_to_breaks_years", "asset_snapshot"),
    covenantRating: text(snap, "covenant_rating", "asset_snapshot"),
    rentReviewMechanism: text(snap, "rent_review_mechanism", "asset_snapshot"),
    epcRating: text(snap, "epc_rating", "asset_snapshot"),
    transportConnectivity: text(snap, "transport_connectivity", "asset_snapshot"),
  };

  // ---- money ----
  const currency = text(terms, "currency", "deal_terms") ?? "GBP";
  const guidePrice = number(terms, "guide_price_gbp", "deal_terms");
  const niyPct = number(terms, "niy_percent", "deal_terms");
  const passingRent = number(snap, "passing_rent_gbp_pa", "asset_snapshot") ?? number(terms, "passing_rent_gbp_pa", "deal_terms");
  if (currency !== "GBP" && (guidePrice !== null || passingRent !== null)) err(`deal_terms.currency "${currency}": the field names are GBP; refusing to guess a conversion`);

  // ---- documents ----
  let photoType: PhotoReferenceType | null = null;
  let photoUrl: string | null = null;
  let attachments: string[] = [];
  if (docs) {
    const t = take(docs, "photo_reference_type");
    if (t !== null) {
      if (typeof t === "string" && (PHOTO_TYPES as readonly string[]).includes(t)) photoType = t as PhotoReferenceType;
      else err(`documents.photo_reference_type ${JSON.stringify(t)} must be one of ${PHOTO_TYPES.join(", ")}`);
    }
    photoUrl = text(docs, "photo_url", "documents");
    const a = take(docs, "attachments_identified");
    if (a !== null) {
      if (Array.isArray(a) && a.every((x) => typeof x === "string" && x.trim() !== "")) attachments = a.map((x: string) => x.trim());
      else err("documents.attachments_identified must be a list of file names");
    }
    if (photoType === "external_url" && !photoUrl) err("documents: an external_url reference needs a photo_url");
    if (photoType !== "external_url" && photoUrl) err("documents: a photo_url needs photo_reference_type external_url");
    if (photoUrl && !/^https?:\/\/\S+$/.test(photoUrl)) err("documents.photo_url must be an http(s) address");
    if (photoType === "attachment_not_retrieved" && attachments.length === 0) err("documents: attachment_not_retrieved needs the attachments that were identified");
    if (photoType === "none_found" && attachments.length > 0) err("documents: none_found cannot also list attachments");
    if (photoType === null && attachments.length > 0) err("documents: attachments are listed with no photo_reference_type");
  }

  const dataCompleteness = typeof d.data_completeness === "string" && d.data_completeness.trim() ? d.data_completeness.trim() : null;
  if (d.data_completeness !== undefined && d.data_completeness !== null && typeof d.data_completeness !== "string") err("data_completeness must be text");

  if (!name || !address || errorsBefore.n > 0) return null;

  // ---- what is left over, kept as given ----
  const sourceFacts: Record<string, unknown> = {};
  if (Object.keys(opp).length) sourceFacts.opportunity = opp;
  if (Object.keys(snap).length) sourceFacts.asset_snapshot = snap;
  if (Object.keys(terms).length) sourceFacts.deal_terms = terms;
  if (docs && Object.keys(docs).length) sourceFacts.documents = docs;
  for (const k of extraTop) sourceFacts[k] = (d as Obj)[k];

  // ---- flags: disagreement is recorded, never resolved ----
  const flags: LoaderFlag[] = [];
  const price = guidePrice;
  const psf = typeof (terms.price_psf_gbp) === "number" ? (terms.price_psf_gbp as number) : null;
  if (price !== null && psf !== null && sizeSqft !== null) {
    const implied = psf * sizeSqft;
    if (Math.abs(implied - price) / price > RECONCILE_TOLERANCE) {
      flags.push({
        code: "price_psf_mismatch",
        message: `Guide price ${fmt(price)} does not agree with the stated price per sq ft (${psf} x ${sizeSqft.toLocaleString("en-GB")} sq ft = ${fmt(implied)}).`,
      });
    }
  }
  const rpsf = typeof (terms.passing_rent_psf_gbp) === "number" ? (terms.passing_rent_psf_gbp as number) : null;
  if (passingRent !== null && rpsf !== null && sizeSqft !== null) {
    const implied = rpsf * sizeSqft;
    if (Math.abs(implied - passingRent) / passingRent > RECONCILE_TOLERANCE) {
      flags.push({
        code: "passing_rent_psf_mismatch",
        message: `Passing rent ${fmt(passingRent)} does not agree with the stated rent per sq ft (${rpsf} x ${sizeSqft.toLocaleString("en-GB")} sq ft = ${fmt(implied)}).`,
      });
    }
  }
  if (parsed.note) flags.push({ code: "source_note", message: `The source line carries a note: ${parsed.note}` });
  if (dataCompleteness && /differs from|conflict|discrepan/i.test(dataCompleteness)) {
    flags.push({ code: "source_conflict_noted", message: `The source marks a conflict with another record: ${dataCompleteness}` });
  }
  if (sourcing && !parsed.broker) {
    flags.push({ code: "broker_not_parsed", message: "The source line does not name a broker in the usual shape, so no broker or contact was set. The line is kept in full." });
  }
  if (flags.length) sourceFacts._loader_flags = flags;

  return {
    reference: seedReference(name), name, address, market, assetType, sourceType, dealStage, sourcing,
    brokerName: parsed.broker, sourceContactName: parsed.contact,
    sourceKind: sourcing !== null && /^Broker email/.test(sourcing) ? "broker_email" : "brochure",
    sizeSqft, property,
    money: { currency, guidePrice, niyPct, passingRent },
    photo: { type: photoType, url: photoUrl, attachments },
    dataCompleteness, sourceFacts, flags,
  };
}

const fmt = (n: number) => `GBP ${Math.round(n).toLocaleString("en-GB")}`;
