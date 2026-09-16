// ============================================================================
// Canonical field vocabulary for ingestion.
// ----------------------------------------------------------------------------
// Every extracted or imported value is keyed by one of these. The registry is
// the single place that knows:
//   * how a value should be parsed (money / percent / area / date / text),
//   * which physical column - if any - it projects onto.
//
// Fields with no column are NOT discarded: they are preserved on the ingestion
// item and, from Phase 2, in the observation ledger. A field earns a column
// when the pipeline needs to filter or sort on it, not before.
//
// Pure module: no server imports, safe in client components.
// ============================================================================

export type FieldKind = "text" | "multiline" | "money" | "percent" | "area" | "date" | "integer";

export type FieldGroup =
  | "identity" | "asset" | "financial" | "occupancy" | "transaction" | "description" | "meta";

export interface FieldDef {
  key: FieldKey;
  label: string;
  kind: FieldKind;
  group: FieldGroup;
  /** Column on `opportunities` this field projects onto. */
  opportunityColumn?: string;
  /** Column on `properties` this field projects onto. */
  propertyColumn?: string;
  /** Area fields declare their unit so a mapping never silently mixes sq ft and sq m. */
  unit?: "sqft" | "sqm";
  /** Shown in the review queue when the value is absent. */
  important?: boolean;
  note?: string;
}

// The order here is the order the review screen renders them in.
const DEFS = [
  // ---- Property identity ---------------------------------------------------
  { key: "property_name", label: "Property", kind: "text", group: "identity",
    opportunityColumn: "name", propertyColumn: "name", important: true },
  { key: "address", label: "Address", kind: "text", group: "identity",
    propertyColumn: "address", important: true },
  { key: "postcode", label: "Postcode", kind: "text", group: "identity",
    propertyColumn: "postcode", important: true },
  { key: "city", label: "City", kind: "text", group: "identity",
    propertyColumn: "city", important: true },
  { key: "submarket", label: "Submarket", kind: "text", group: "identity",
    opportunityColumn: "submarket", propertyColumn: "submarket" },
  { key: "market", label: "Market", kind: "text", group: "identity",
    opportunityColumn: "market", propertyColumn: "market" },
  { key: "country", label: "Country", kind: "text", group: "identity",
    propertyColumn: "country" },

  // ---- Asset ---------------------------------------------------------------
  { key: "property_type", label: "Property type", kind: "text", group: "asset",
    opportunityColumn: "asset_type", propertyColumn: "asset_type", important: true },
  { key: "property_subtype", label: "Subtype", kind: "text", group: "asset" },
  { key: "floor_area_sqft", label: "Floor area (sq ft)", kind: "area", group: "asset",
    opportunityColumn: "size_sqft", unit: "sqft" },
  { key: "floor_area_sqm", label: "Floor area (sq m)", kind: "area", group: "asset",
    opportunityColumn: "size_sqm", unit: "sqm" },
  { key: "lot_size", label: "Lot size", kind: "area", group: "asset" },
  { key: "construction_date", label: "Constructed", kind: "date", group: "asset" },
  { key: "refurbishment_date", label: "Refurbished", kind: "date", group: "asset" },
  { key: "tenure", label: "Tenure", kind: "text", group: "asset",
    note: "Freehold / leasehold / long leasehold" },

  // ---- Financial -----------------------------------------------------------
  // `asking_price` is canonical for asking / guide / quoting price: they are the
  // same number under different broker labels. Which label the source used is
  // preserved in the observation excerpt rather than in a second column.
  { key: "asking_price", label: "Asking price", kind: "money", group: "financial",
    opportunityColumn: "target_price", important: true },
  { key: "passing_income", label: "Passing income", kind: "money", group: "financial",
    opportunityColumn: "passing_rent", important: true },
  { key: "noi", label: "NOI", kind: "money", group: "financial",
    note: "Net operating income - NOT interchangeable with passing rent" },
  { key: "erv", label: "ERV", kind: "money", group: "financial",
    opportunityColumn: "erv" },
  { key: "niy", label: "Net initial yield", kind: "percent", group: "financial",
    opportunityColumn: "niy", important: true,
    note: "Cap rate and initial yield map here; the source label is kept on the observation" },
  { key: "reversionary_yield", label: "Reversionary yield", kind: "percent", group: "financial",
    opportunityColumn: "reversionary_yield" },
  { key: "price_per_sqft", label: "Price per sq ft", kind: "money", group: "financial" },
  { key: "price_per_sqm", label: "Price per sq m", kind: "money", group: "financial" },
  { key: "currency", label: "Currency", kind: "text", group: "meta",
    opportunityColumn: "currency" },

  // ---- Occupancy / leasing -------------------------------------------------
  { key: "occupancy_pct", label: "Occupancy", kind: "percent", group: "occupancy" },
  { key: "vacancy_pct", label: "Vacancy", kind: "percent", group: "occupancy" },
  { key: "wault", label: "WAULT (years)", kind: "text", group: "occupancy",
    note: "Recorded only where the source states it; never derived silently" },
  { key: "tenant_names", label: "Tenants", kind: "text", group: "occupancy" },
  { key: "lease_expiry", label: "Lease expiry", kind: "date", group: "occupancy" },
  { key: "lease_commencement", label: "Lease commencement", kind: "date", group: "occupancy" },
  { key: "break_date", label: "Break date", kind: "date", group: "occupancy" },
  { key: "rent_review_date", label: "Rent review", kind: "date", group: "occupancy" },

  // ---- Transaction ---------------------------------------------------------
  { key: "broker", label: "Broker", kind: "text", group: "transaction",
    opportunityColumn: "broker_name", important: true },
  { key: "broker_contact", label: "Broker contact", kind: "text", group: "transaction" },
  { key: "vendor", label: "Vendor", kind: "text", group: "transaction",
    opportunityColumn: "vendor_name" },
  { key: "sale_process", label: "Sale process", kind: "text", group: "transaction" },
  { key: "bid_deadline", label: "Bid deadline", kind: "date", group: "transaction" },
  { key: "sale_status", label: "Sale status", kind: "text", group: "transaction",
    note: "Market status of the asset, not Reiwa's position" },
  { key: "deal_source", label: "Source", kind: "text", group: "transaction",
    opportunityColumn: "source" },

  // ---- Description ---------------------------------------------------------
  { key: "broker_description", label: "Broker description", kind: "multiline", group: "description",
    opportunityColumn: "summary" },
  { key: "investment_highlights", label: "Investment highlights", kind: "multiline", group: "description" },
  { key: "asset_summary", label: "Asset summary", kind: "multiline", group: "description" },
] as const;

export type FieldKey = (typeof DEFS)[number]["key"];

// The literal above is `as const` so FieldKey stays a precise union; this line
// is what checks its shape against FieldDef at compile time.
export const FIELDS: readonly FieldDef[] = DEFS;

export const FIELD_BY_KEY: Record<FieldKey, FieldDef> =
  Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<FieldKey, FieldDef>;

export const FIELD_KEYS: readonly FieldKey[] = FIELDS.map((f) => f.key);

export function isFieldKey(value: string): value is FieldKey {
  return Object.prototype.hasOwnProperty.call(FIELD_BY_KEY, value);
}

/** Fields the review queue treats as expected; absence is reported, never invented. */
export const IMPORTANT_FIELDS: readonly FieldKey[] =
  FIELDS.filter((f) => f.important).map((f) => f.key);

export function fieldsInGroup(group: FieldGroup): readonly FieldDef[] {
  return FIELDS.filter((f) => f.group === group);
}
