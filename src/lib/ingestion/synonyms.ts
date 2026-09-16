// ============================================================================
// Header synonyms - broker spreadsheet column names to canonical field keys.
// ----------------------------------------------------------------------------
// Every broker names their columns differently. This dictionary is the reason
// the importer is flexible rather than template-bound, and it is deliberately
// data rather than code so it can grow as real spreadsheets arrive.
//
// Entries are matched after normalisation (lower case, punctuation and unit
// noise removed), so "Asking Price (GBP)" and "asking price" are one entry.
//
// Pure module. Fully unit tested.
// ============================================================================
import type { FieldKey } from "@/lib/ingestion/fields";

/**
 * Header text -> field key. Order within a field does not matter; the mapping
 * engine scores exact matches before fuzzy ones.
 *
 * A synonym listed here is an ASSERTION that the two mean the same thing. Where
 * they only nearly mean the same thing - "NOI" is not "passing rent", "cap
 * rate" is not exactly "NIY" - the pair belongs in AMBIGUOUS below instead, so
 * the mapping is suggested but flagged for confirmation.
 */
export const HEADER_SYNONYMS: Record<string, FieldKey> = {
  // ---- Identity ------------------------------------------------------------
  "property": "property_name",
  "property name": "property_name",
  "asset": "property_name",
  "asset name": "property_name",
  "building": "property_name",
  "building name": "property_name",
  "scheme": "property_name",
  "name": "property_name",
  "opportunity": "property_name",
  "deal": "property_name",
  "deal name": "property_name",

  "address": "address",
  "full address": "address",
  "property address": "address",
  "street address": "address",
  "location": "address",
  "street": "address",
  "addr": "address",

  "postcode": "postcode",
  "post code": "postcode",
  "zip": "postcode",
  "zip code": "postcode",
  "postal code": "postcode",

  "city": "city",
  "town": "city",
  "city town": "city",

  "submarket": "submarket",
  "sub market": "submarket",
  "district": "submarket",
  "area": "submarket",
  "neighbourhood": "submarket",
  "neighborhood": "submarket",

  "market": "market",
  "region": "market",

  "country": "country",

  // ---- Asset ---------------------------------------------------------------
  "type": "property_type",
  "property type": "property_type",
  "asset type": "property_type",
  "sector": "property_type",
  "use": "property_type",
  "use class": "property_type",

  "subtype": "property_subtype",
  "sub type": "property_subtype",
  "property subtype": "property_subtype",

  "size": "floor_area_sqft",
  "area sqft": "floor_area_sqft",
  "floor area": "floor_area_sqft",
  "sq ft": "floor_area_sqft",
  "sqft": "floor_area_sqft",
  "square feet": "floor_area_sqft",
  "nia": "floor_area_sqft",
  "gia": "floor_area_sqft",
  "net internal area": "floor_area_sqft",
  "gross internal area": "floor_area_sqft",
  "lettable area": "floor_area_sqft",

  "sq m": "floor_area_sqm",
  "sqm": "floor_area_sqm",
  "square metres": "floor_area_sqm",
  "square meters": "floor_area_sqm",
  "area sqm": "floor_area_sqm",

  "site area": "lot_size",
  "lot size": "lot_size",
  "plot size": "lot_size",

  "built": "construction_date",
  "year built": "construction_date",
  "construction date": "construction_date",
  "date built": "construction_date",

  "refurbished": "refurbishment_date",
  "refurbishment date": "refurbishment_date",
  "last refurbished": "refurbishment_date",

  "tenure": "tenure",
  "freehold leasehold": "tenure",
  "ownership": "tenure",

  // ---- Financial -----------------------------------------------------------
  "price": "asking_price",
  "asking price": "asking_price",
  "asking": "asking_price",
  "guide": "asking_price",
  "guide price": "asking_price",
  "quoting": "asking_price",
  "quoting price": "asking_price",
  "value": "asking_price",
  "valuation": "asking_price",
  "purchase price": "asking_price",
  "offers over": "asking_price",
  "lot price": "asking_price",
  "capital value": "asking_price",

  "rent": "passing_income",
  "income": "passing_income",
  "passing rent": "passing_income",
  "passing income": "passing_income",
  "current rent": "passing_income",
  "gross rent": "passing_income",
  "rental income": "passing_income",
  "annual rent": "passing_income",
  "rent pa": "passing_income",
  "contracted rent": "passing_income",

  "erv": "erv",
  "estimated rental value": "erv",
  "market rent": "erv",
  "reversionary rent": "erv",

  "noi": "noi",
  "net operating income": "noi",

  "yield": "niy",
  "niy": "niy",
  "net initial yield": "niy",
  "initial yield": "niy",
  "net yield": "niy",

  "reversionary yield": "reversionary_yield",
  "equivalent yield": "reversionary_yield",

  "price per sq ft": "price_per_sqft",
  "price psf": "price_per_sqft",
  "psf": "price_per_sqft",
  "capital value per sq ft": "price_per_sqft",
  "price per sq m": "price_per_sqm",
  "price psm": "price_per_sqm",

  "currency": "currency",
  "ccy": "currency",

  // ---- Occupancy -----------------------------------------------------------
  "occupancy": "occupancy_pct",
  "occupancy rate": "occupancy_pct",
  "let": "occupancy_pct",
  "occupied": "occupancy_pct",

  "vacancy": "vacancy_pct",
  "vacancy rate": "vacancy_pct",
  "void": "vacancy_pct",

  "wault": "wault",
  "waul": "wault",
  "weighted average unexpired lease term": "wault",
  "unexpired term": "wault",

  "tenant": "tenant_names",
  "tenants": "tenant_names",
  "tenant name": "tenant_names",
  "occupier": "tenant_names",
  "covenant": "tenant_names",

  "lease expiry": "lease_expiry",
  "expiry": "lease_expiry",
  "lease end": "lease_expiry",
  "lease commencement": "lease_commencement",
  "lease start": "lease_commencement",
  "break": "break_date",
  "break date": "break_date",
  "break option": "break_date",
  "rent review": "rent_review_date",
  "review date": "rent_review_date",
  "next review": "rent_review_date",

  // ---- Transaction ---------------------------------------------------------
  "broker": "broker",
  "agent": "broker",
  "selling agent": "broker",
  "vendor agent": "broker",
  "introduced by": "broker",
  "agency": "broker",

  "broker contact": "broker_contact",
  "contact": "broker_contact",
  "contact name": "broker_contact",

  "vendor": "vendor",
  "seller": "vendor",
  "owner": "vendor",
  "current owner": "vendor",

  "process": "sale_process",
  "sale process": "sale_process",
  "bid date": "bid_deadline",
  "bid deadline": "bid_deadline",
  "deadline": "bid_deadline",
  "closing date": "bid_deadline",

  "status": "sale_status",
  "sale status": "sale_status",
  "deal status": "sale_status",
  "market status": "sale_status",

  "source": "deal_source",
  "deal source": "deal_source",
  "origin": "deal_source",
  "referred by": "deal_source",

  // ---- Description ---------------------------------------------------------
  "description": "broker_description",
  "short description": "broker_description",
  "summary": "broker_description",
  "comments": "broker_description",
  "notes": "broker_description",
  "overview": "broker_description",
  "highlights": "investment_highlights",
  "investment highlights": "investment_highlights",
  "key highlights": "investment_highlights",
  "asset summary": "asset_summary",
};

/**
 * Headers that map to a field only APPROXIMATELY. The mapping is still
 * suggested, because leaving it unmapped helps nobody, but it is never applied
 * silently: the importer surfaces the reason so the user confirms.
 *
 * "Cap rate" is the obvious one - it is the US convention and is not always
 * computed the way a UK net initial yield is. Mapping it silently is how a deal
 * list ends up with yields that are quietly 25bp wrong.
 */
export const AMBIGUOUS_SYNONYMS: Record<string, { field: FieldKey; reason: string }> = {
  "cap rate": { field: "niy", reason: "Cap rate is not always computed as a net initial yield - confirm the basis." },
  "cap": { field: "niy", reason: "Cap rate is not always computed as a net initial yield - confirm the basis." },
  "capitalisation rate": { field: "niy", reason: "Cap rate is not always computed as a net initial yield - confirm the basis." },
  "gross yield": { field: "niy", reason: "Gross yield is not a net initial yield - confirm before relying on it." },
  "net income": { field: "passing_income", reason: "Net income may be NOI rather than passing rent - confirm the basis." },
  "net rent": { field: "passing_income", reason: "Net rent may be net of costs - confirm the basis." },
  "total income": { field: "passing_income", reason: "May include non-rental income - confirm the basis." },
  "gia sqm": { field: "floor_area_sqm", reason: "Confirm the area is stated in square metres." },
  "date": { field: "bid_deadline", reason: "Ambiguous date column - confirm what this date represents." },
  "size sqm": { field: "floor_area_sqm", reason: "Confirm the area is stated in square metres." },
};

/** Bracketed qualifiers, stripped whole: "(GBP)", "(sq ft)", "(p.a.)". */
const BRACKETED = [/\(([^)]*)\)/g, /\[[^\]]*\]/g];

/**
 * Units and qualifiers stripped from a header before lookup. Applied AFTER dots
 * are removed, so "p.a." has already collapsed to "pa": a trailing \b never
 * matches after a "." because "." is not a word character.
 */
const HEADER_NOISE =
  /\b(?:gbp|eur|usd|jpy|per annum|pa|per year|py|approx|approximately|est|estimated|total)\b/gi;

/** Combining diacritical marks, stripped after NFKD. */
const ACCENTS = /[\u0300-\u036f]/g;

/** Canonical lookup form for a spreadsheet header. */
export function normaliseHeader(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw).normalize("NFKD").replace(ACCENTS, "").toLowerCase();
  for (const pattern of BRACKETED) s = s.replace(pattern, " ");
  s = s.replace(/[£€$¥%]/g, " ").replace(/\./g, "");
  return s
    .replace(HEADER_NOISE, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
