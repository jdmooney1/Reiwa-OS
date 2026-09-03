// Human labels and accent tones for the Investment Portal admin surface (P2).
// UI-agnostic, mirroring the style of src/lib/domain.ts.
import type { Tone } from "@/lib/domain";
import type {
  VersionStatus, Placement, EntitlementDocumentLevel, DocumentAccessLevel,
  DocumentCategory, InvestorOrgStatus,
} from "@/lib/data/investor-portal";
import type { WorkflowState } from "@/lib/data/admin-portal";

export const WORKFLOW_LABEL: Record<WorkflowState, string> = {
  draft: "Draft",
  in_review: "In Review",
  published: "Published",
  withdrawn: "Withdrawn",
};

export const WORKFLOW_TONE: Record<WorkflowState, Tone> = {
  draft: "neutral",
  in_review: "caution",
  published: "positive",
  withdrawn: "muted",
};

export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  draft: "Draft",
  in_review: "In Review",
  published: "Published",
  superseded: "Superseded",
};

export const VERSION_STATUS_TONE: Record<VersionStatus, Tone> = {
  draft: "neutral",
  in_review: "caution",
  published: "positive",
  superseded: "muted",
};

export const INVESTOR_ORG_STATUS_LABEL: Record<InvestorOrgStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  closed: "Closed",
};

export const INVESTOR_ORG_STATUS_TONE: Record<InvestorOrgStatus, Tone> = {
  active: "positive",
  suspended: "caution",
  closed: "muted",
};

export const PLACEMENT_LABEL: Record<Placement, string> = {
  featured: "Featured",
  secondary: "Also Available",
};

export const DOC_LEVEL_LABEL: Record<DocumentAccessLevel, string> = {
  standard: "Standard",
  diligence: "Diligence",
  internal: "Internal",
};

export const DOC_LEVEL_TONE: Record<DocumentAccessLevel, Tone> = {
  standard: "neutral",
  diligence: "gold",
  internal: "negative",
};

export const ENTITLEMENT_LEVEL_LABEL: Record<EntitlementDocumentLevel, string> = {
  standard: "Standard",
  diligence: "Diligence",
};

export const DOC_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  teaser: "Teaser",
  financials: "Financials",
  legal: "Legal",
  technical: "Technical",
  esg: "ESG",
  data_room: "Data Room",
  other: "Other",
};
