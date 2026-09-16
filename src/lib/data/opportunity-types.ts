// Pure types & constants (no server imports) — safe to import from client
// components. The data layer (opportunities.ts) re-exports these.
//
// The three status axes live in @/lib/ingestion/status, which owns the labels
// and the single flat display label derived from them (docs/17 D2). These
// aliases keep the existing import sites working.
export type {
  OppStage, OppStatus, MarketStatus, ReiwaPosition,
} from "@/lib/ingestion/status";
export { OPP_STAGES } from "@/lib/ingestion/status";

import type { OppStage, OppStatus, MarketStatus, ReiwaPosition } from "@/lib/ingestion/status";

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
  /** What happened to the ASSET in the market, independent of Reiwa's view. */
  marketStatus: MarketStatus;
  /** Reiwa's own position in the process, distinct from the market's. */
  reiwaPosition: ReiwaPosition;
  firstSeenAt: string | null;
  lastSourceAt: string | null;
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
  brokerName: string | null;
  vendorName: string | null;
  sizeSqft: number | null;
  sizeSqm: number | null;
  summary: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  assetId: string | null;
}
