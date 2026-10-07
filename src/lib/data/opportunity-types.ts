// Pure types & constants (no server imports) — safe to import from client
// components. The data layer (opportunities.ts) re-exports these.
export type OppStage = "new" | "screening" | "underwriting" | "ic" | "approved" | "acquired";
export type OppStatus = "active" | "rejected" | "withdrawn" | "lost" | "converted";

/** How the opportunity reached Reiwa. Structured; `source` is the free-text detail. */
export type SourceType =
  | "off_market" | "broker_marketed" | "direct_approach"
  | "referral" | "existing_relationship" | "other";

export const SOURCE_TYPES: SourceType[] = [
  "off_market", "broker_marketed", "direct_approach",
  "referral", "existing_relationship", "other",
];

export type OppPriority = "low" | "medium" | "high";

export type GeocodeStatus = "pending" | "ok" | "failed" | "no_match";

/**
 * Where a loaded deal stands in review. `untriaged` is what every row starts as
 * and is deliberately never defaulted to `live` (migration 0014): an untriaged
 * row must look incomplete, not quietly active.
 */
export type TriageStatus = "untriaged" | "live" | "dead" | "reference";
export const TRIAGE_STATUSES: TriageStatus[] = ["untriaged", "live", "dead", "reference"];
/** Only ever set on a `live` row: the database enforces that. */
export type TriagePriority = "P1" | "P2" | "P3";
export const TRIAGE_PRIORITIES: TriagePriority[] = ["P1", "P2", "P3"];

export const OPP_STAGES: OppStage[] = ["new", "screening", "underwriting", "ic", "approved", "acquired"];

export interface Opportunity {
  opportunityId: string;
  orgId: string;
  propertyId: string | null;
  name: string;
  market: string | null;
  submarket: string | null;
  assetType: string;
  strategy: string | null;
  stage: OppStage;
  status: OppStatus;
  currency: string;
  targetPrice: number | null;
  niy: number | null;
  reversionaryYield: number | null;
  passingRent: number | null;
  erv: number | null;
  capexBudget: number | null;
  targetIrr: number | null;
  equityMultiple: number | null;
  probability: number | null;
  source: string | null;
  sourceType: SourceType;
  sourceContactName: string | null;
  sourceContactEmail: string | null;
  sourcedAt: string | null;
  referralNote: string | null;
  brokerName: string | null;
  vendorName: string | null;
  priority: OppPriority;
  triageStatus: TriageStatus;
  triagePriority: TriagePriority | null;
  triageNote: string | null;
  ownerUserId: string | null;
  /** The owner's display name, joined for the workspace. Null when unassigned. */
  ownerName: string | null;
  nextMilestone: string | null;
  nextMilestoneDate: string | null;
  /** Moves only when stage or status changes — not on every edit. */
  lastMaterialUpdateAt: string | null;
  sizeSqft: number | null;
  sizeSqm: number | null;
  /** INTERNAL thesis / summary. Never crosses into an investor-facing record. */
  summary: string | null;
  /**
   * Written for investors (migration 0033). The only free text the publication
   * boundary reads. Null = not written; a new draft's Overview then starts blank.
   */
  investorOverview: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  /**
   * Where the property is, from the geocoder (migration 0016). INTERNAL ONLY:
   * this type is never imported by anything the investor portal renders, and
   * tests/unit/investor-no-location.test.ts holds that line.
   */
  latitude: number | null;
  longitude: number | null;
  geocodeStatus: GeocodeStatus;
  /** What the geocoder resolved the address to, for comparison with `address`. */
  formattedAddress: string | null;
  /**
   * When the geocoder was last asked. The freshness marker: Google-derived
   * location data is shown for 30 days from this instant and not after
   * (src/lib/geo/freshness.ts). Null on hand-entered coordinates.
   */
  geocodedAt: string | null;
  /** A panorama id is on record, so /api/property-photo/<propertyId> has a picture to serve. */
  hasStreetView: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  assetId: string | null;
}

/**
 * The location-derived fields on an Opportunity (migrations 0016, 0017).
 *
 * They exist for the opportunity workspace, which draws the map and the street
 * photo, and are read from the database by the shared opportunity query. A LIST
 * of opportunities does not display them, and a list handed to a client component
 * is serialised into the page and delivered to the browser whole, so anything on
 * the row goes with it. Lists strip these with withoutLocation() and are typed
 * without them, so reaching for one on a list row is a compile error rather than
 * a quiet leak. Google-derived data that is not displayed should not be shipped.
 */
export const LOCATION_FIELDS = [
  "latitude", "longitude", "formattedAddress", "geocodeStatus", "geocodedAt", "hasStreetView",
] as const satisfies readonly (keyof Opportunity)[];

export type LocationField = (typeof LOCATION_FIELDS)[number];

/** An opportunity without its location-derived fields. */
export function withoutLocation<T extends Opportunity>(o: T): Omit<T, LocationField> {
  const copy: Record<string, unknown> = { ...(o as object) };
  for (const key of LOCATION_FIELDS) delete copy[key];
  return copy as Omit<T, LocationField>;
}
