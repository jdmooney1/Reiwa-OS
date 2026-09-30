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
  ownerUserId: string | null;
  /** The owner's display name, joined for the workspace. Null when unassigned. */
  ownerName: string | null;
  nextMilestone: string | null;
  nextMilestoneDate: string | null;
  /** Moves only when stage or status changes — not on every edit. */
  lastMaterialUpdateAt: string | null;
  sizeSqft: number | null;
  sizeSqm: number | null;
  summary: string | null;
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
