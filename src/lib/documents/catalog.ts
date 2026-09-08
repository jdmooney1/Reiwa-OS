// ============================================================================
// Document Vault — category catalogue & ingestion status metadata.
// Each category maps to an icon and the DD section a finding-derived task would
// belong to, so the vault becomes structured deal memory rather than a file dump.
// ============================================================================
import {
  BookOpen, Table2, FileSignature, ScrollText, Calculator, Wrench, Landmark,
  Leaf, Hammer, Receipt, Scale, Image, Ruler, LineChart, Presentation,
  type LucideIcon,
} from "lucide-react";
import type { DocCategory, DocIngestStatus, DdSection } from "@/types/database";
import type { Tone } from "@/lib/domain";

export interface DocCategoryDef {
  key: DocCategory;
  icon: LucideIcon;
  ddSection: DdSection; // section a task created from this doc belongs to
}

export const DOC_CATEGORIES: DocCategoryDef[] = [
  { key: "Broker Brochure", icon: BookOpen, ddSection: "Executive Summary" },
  { key: "Rent Roll", icon: Table2, ddSection: "Income Profile and Tenancy" },
  { key: "Lease", icon: FileSignature, ddSection: "Income Profile and Tenancy" },
  { key: "Title", icon: ScrollText, ddSection: "Tenure and Ownership" },
  { key: "Valuation", icon: Calculator, ddSection: "Valuation Metrics" },
  { key: "Technical DD", icon: Wrench, ddSection: "Asset Description" },
  { key: "Planning", icon: Landmark, ddSection: "Planning and Heritage" },
  { key: "EPC", icon: Leaf, ddSection: "ESG and Compliance" },
  { key: "Capex Quote", icon: Hammer, ddSection: "Capex Plan" },
  { key: "Tax Memo", icon: Receipt, ddSection: "Cross Border Tax and Holding Structure" },
  { key: "Legal Memo", icon: Scale, ddSection: "Tenure and Ownership" },
  { key: "Photos", icon: Image, ddSection: "Asset Description" },
  { key: "Floorplans", icon: Ruler, ddSection: "Asset Description" },
  { key: "Financial Model", icon: LineChart, ddSection: "Business Plan Scenarios" },
  { key: "Investor Presentation", icon: Presentation, ddSection: "Executive Summary" },
];

export const DOC_CATEGORY_BY_KEY: Record<DocCategory, DocCategoryDef> =
  Object.fromEntries(DOC_CATEGORIES.map((c) => [c.key, c])) as Record<DocCategory, DocCategoryDef>;

export const DOC_CATEGORY_KEYS: DocCategory[] = DOC_CATEGORIES.map((c) => c.key);

export const INGEST_STATUS_LABEL: Record<DocIngestStatus, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  extracted: "Extracted",
  reviewed: "Reviewed",
};

export const INGEST_STATUS_TONE: Record<DocIngestStatus, Tone> = {
  uploaded: "muted",
  processing: "caution",
  extracted: "accent",
  reviewed: "positive",
};
