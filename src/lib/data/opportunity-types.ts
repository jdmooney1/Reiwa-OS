// Pure types & constants (no server imports) — safe to import from client
// components. The data layer (opportunities.ts) re-exports these.
export type OppStage = "new" | "screening" | "underwriting" | "ic" | "approved" | "acquired";
export type OppStatus = "active" | "rejected" | "withdrawn" | "lost" | "converted";

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
