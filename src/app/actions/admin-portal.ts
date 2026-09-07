"use server";

// ============================================================================
// Investment Portal admin actions (P2).
// ----------------------------------------------------------------------------
// Every action is double-gated: requireAdminSession() rejects non-admin staff
// at the application layer, and every statement then runs through withSession()
// under the caller's own claims, where the P1 write policies (app.is_admin())
// enforce the same rule in the database. Nothing here touches the privileged
// connection.
// ============================================================================
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/admin";
import {
  createInvestorOrganization, updateInvestorOrganization,
  createInvestorContact, updateInvestorContact,
  createPublicationFromOpportunity, updateDraftVersion,
  submitVersionForReview, returnVersionToDraft, publishVersion, supersedeActiveVersion,
  addPublicationDocument, removePublicationDocument,
  grantEntitlement, updateEntitlement, revokeEntitlement, setEntitlementPlacement,
  getPublicationProvenance,
  type InvestorOrgStatus, type Placement, type EntitlementDocumentLevel,
  type DocumentCategory, type DocumentAccessLevel,
} from "@/lib/data/investor-portal";
import {
  createDraftFromVersion, assertNoOpenVersion, updatePublicationDocument,
  getPublicationForOpportunity, reorderSecondaryEntitlements,
} from "@/lib/data/admin-portal";
import {
  checkUpload, newObjectPath, putDocumentObject, deleteDocumentObject,
} from "@/lib/documents/storage";

const trimmed = (v: FormDataEntryValue | null): string => String(v ?? "").trim();
const orNull = (v: FormDataEntryValue | null): string | null => trimmed(v) || null;
const numOrNull = (v: FormDataEntryValue | null): number | null => {
  const s = trimmed(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function refreshInvestor(investorOrgId: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/investors");
  revalidatePath(`/admin/investors/${investorOrgId}`);
}

function refreshPublication(publicationId: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/publications");
  revalidatePath(`/admin/publications/${publicationId}`);
}

// ============================================================================
// Investor organisations
// ============================================================================
export async function createInvestorOrgAction(formData: FormData): Promise<void> {
  const { db } = await requireAdminSession();
  const name = trimmed(formData.get("name"));
  if (!name) throw new Error("The organisation name is required.");
  const id = await createInvestorOrganization(db, {
    name,
    status: (trimmed(formData.get("status")) || "active") as InvestorOrgStatus,
    notes: orNull(formData.get("notes")),
  });
  revalidatePath("/admin");
  revalidatePath("/admin/investors");
  redirect(`/admin/investors/${id}`);
}

export async function updateInvestorOrgAction(
  investorOrgId: string, formData: FormData,
): Promise<void> {
  const { db } = await requireAdminSession();
  const name = trimmed(formData.get("name"));
  if (!name) throw new Error("The organisation name is required.");
  await updateInvestorOrganization(db, investorOrgId, {
    name,
    status: (trimmed(formData.get("status")) || "active") as InvestorOrgStatus,
    notes: orNull(formData.get("notes")),
  });
  refreshInvestor(investorOrgId);
}

// ============================================================================
// Investor contacts
// ============================================================================
export async function createInvestorContactAction(
  investorOrgId: string, formData: FormData,
): Promise<void> {
  const { db } = await requireAdminSession();
  const name = trimmed(formData.get("name"));
  const email = trimmed(formData.get("email"));
  if (!name || !email) throw new Error("A contact needs a name and an email address.");
  await createInvestorContact(db, {
    investorOrgId,
    name,
    email,
    title: orNull(formData.get("title")),
  });
  refreshInvestor(investorOrgId);
}

export async function updateInvestorContactAction(
  investorContactId: string, investorOrgId: string, formData: FormData,
): Promise<void> {
  const { db } = await requireAdminSession();
  const name = trimmed(formData.get("name"));
  const email = trimmed(formData.get("email"));
  if (!name || !email) throw new Error("A contact needs a name and an email address.");
  await updateInvestorContact(db, investorContactId, {
    name,
    email,
    title: orNull(formData.get("title")),
  });
  refreshInvestor(investorOrgId);
}

export async function setContactActiveAction(
  investorContactId: string, investorOrgId: string, isActive: boolean,
): Promise<void> {
  const { db } = await requireAdminSession();
  await updateInvestorContact(db, investorContactId, { isActive });
  refreshInvestor(investorOrgId);
}

// ============================================================================
// Entitlements — the investor's portal, managed from either side
// ============================================================================
export async function assignPublicationAction(
  investorOrgId: string, formData: FormData,
): Promise<void> {
  const { db, auth } = await requireAdminSession();
  const publicationId = trimmed(formData.get("publicationId"));
  if (!publicationId) throw new Error("Choose a publication to assign.");
  await grantEntitlement(db, {
    investorOrgId,
    publicationId,
    isVisible: formData.get("isVisible") === "on",
    placement: (trimmed(formData.get("placement")) || "secondary") as Placement,
    documentAccessLevel:
      (trimmed(formData.get("documentAccessLevel")) || "standard") as EntitlementDocumentLevel,
    investorNote: orNull(formData.get("investorNote")),
  }, auth.userId);
  refreshInvestor(investorOrgId);
  refreshPublication(publicationId);
}

/** Grant from the publication side (Investor Access tab). */
export async function grantAccessAction(
  publicationId: string, formData: FormData,
): Promise<void> {
  const { db, auth } = await requireAdminSession();
  const investorOrgId = trimmed(formData.get("investorOrgId"));
  if (!investorOrgId) throw new Error("Choose an investor organisation.");
  await grantEntitlement(db, {
    investorOrgId,
    publicationId,
    isVisible: formData.get("isVisible") === "on",
    placement: (trimmed(formData.get("placement")) || "secondary") as Placement,
    documentAccessLevel:
      (trimmed(formData.get("documentAccessLevel")) || "standard") as EntitlementDocumentLevel,
    investorNote: orNull(formData.get("investorNote")),
  }, auth.userId);
  refreshInvestor(investorOrgId);
  refreshPublication(publicationId);
}

export async function setEntitlementPlacementAction(
  entitlementId: string, investorOrgId: string, placement: Placement,
): Promise<void> {
  const { db } = await requireAdminSession();
  await setEntitlementPlacement(db, entitlementId, placement);
  refreshInvestor(investorOrgId);
  revalidatePath("/admin/publications");
}

export async function setEntitlementVisibilityAction(
  entitlementId: string, investorOrgId: string, isVisible: boolean,
): Promise<void> {
  const { db } = await requireAdminSession();
  // Making a row visible never re-promotes it: it returns as secondary, so the
  // one-featured rule cannot be tripped from here.
  await updateEntitlement(db, entitlementId,
    isVisible ? { isVisible: true, placement: "secondary" } : { isVisible: false, placement: "secondary" });
  refreshInvestor(investorOrgId);
  revalidatePath("/admin/publications");
}

export async function revokeEntitlementAction(
  entitlementId: string, investorOrgId: string,
): Promise<void> {
  const { db } = await requireAdminSession();
  await revokeEntitlement(db, entitlementId);
  refreshInvestor(investorOrgId);
  revalidatePath("/admin/publications");
}

export async function setEntitlementAccessAction(
  entitlementId: string, investorOrgId: string, level: EntitlementDocumentLevel,
): Promise<void> {
  const { db } = await requireAdminSession();
  await updateEntitlement(db, entitlementId, { documentAccessLevel: level });
  refreshInvestor(investorOrgId);
}

export async function saveEntitlementNoteAction(
  entitlementId: string, investorOrgId: string, formData: FormData,
): Promise<void> {
  const { db } = await requireAdminSession();
  await updateEntitlement(db, entitlementId, { investorNote: orNull(formData.get("investorNote")) });
  refreshInvestor(investorOrgId);
}

export async function reorderSecondaryAction(
  investorOrgId: string, orderedEntitlementIds: string[],
): Promise<void> {
  const { db } = await requireAdminSession();
  await reorderSecondaryEntitlements(db, investorOrgId, orderedEntitlementIds);
  refreshInvestor(investorOrgId);
}

// ============================================================================
// Publication lifecycle
// ============================================================================
/**
 * "Prepare for Investors" — from an internal opportunity. One publication per
 * opportunity: if one exists, open it rather than creating anything.
 */
export async function preparePublicationAction(opportunityId: string): Promise<void> {
  const { db, auth } = await requireAdminSession();
  const existing = await getPublicationForOpportunity(db, opportunityId);
  if (existing) redirect(`/admin/publications/${existing}`);
  const { publicationId } = await createPublicationFromOpportunity(db, opportunityId, auth.userId);
  revalidatePath("/admin");
  revalidatePath("/admin/publications");
  redirect(`/admin/publications/${publicationId}`);
}

export async function updateDraftVersionAction(
  versionId: string, publicationId: string, formData: FormData,
): Promise<void> {
  const { db } = await requireAdminSession();
  const title = trimmed(formData.get("title"));
  if (!title) throw new Error("The publication title is required.");
  const highlights = String(formData.get("highlights") ?? "")
    .split("\n").map((h) => h.trim()).filter(Boolean);
  await updateDraftVersion(db, versionId, {
    title,
    headline: orNull(formData.get("headline")),
    overview: orNull(formData.get("overview")),
    market: orNull(formData.get("market")),
    submarket: orNull(formData.get("submarket")),
    city: orNull(formData.get("city")),
    country: orNull(formData.get("country")),
    assetType: orNull(formData.get("assetType")),
    strategy: orNull(formData.get("strategy")),
    currency: trimmed(formData.get("currency")) || "GBP",
    headlinePrice: numOrNull(formData.get("headlinePrice")),
    targetNiy: numOrNull(formData.get("targetNiy")),
    targetIrr: numOrNull(formData.get("targetIrr")),
    targetEquityMultiple: numOrNull(formData.get("targetEquityMultiple")),
    holdPeriodYears: numOrNull(formData.get("holdPeriodYears")),
    sizeSqft: numOrNull(formData.get("sizeSqft")),
    sizeSqm: numOrNull(formData.get("sizeSqm")),
    highlights,
  });
  refreshPublication(publicationId);
}

export async function submitForReviewAction(
  versionId: string, publicationId: string,
): Promise<void> {
  const { db, auth } = await requireAdminSession();
  await submitVersionForReview(db, versionId, auth.userId);
  refreshPublication(publicationId);
}

export async function returnToDraftAction(
  versionId: string, publicationId: string,
): Promise<void> {
  const { db } = await requireAdminSession();
  await returnVersionToDraft(db, versionId);
  refreshPublication(publicationId);
}

export async function publishVersionAction(
  versionId: string, publicationId: string,
): Promise<void> {
  const { db, auth } = await requireAdminSession();
  await publishVersion(db, versionId, auth.userId);
  refreshPublication(publicationId);
  revalidatePath("/admin/investors");
}

export async function withdrawPublicationAction(publicationId: string): Promise<void> {
  const { db } = await requireAdminSession();
  await supersedeActiveVersion(db, publicationId);
  refreshPublication(publicationId);
  revalidatePath("/admin/investors");
}

/** Edit a published publication: copy the version into a fresh draft. */
export async function startDraftFromVersionAction(
  sourceVersionId: string, publicationId: string,
): Promise<void> {
  const { db, auth } = await requireAdminSession();
  await createDraftFromVersion(db, sourceVersionId, { copyDocuments: true }, auth.userId);
  refreshPublication(publicationId);
}

/**
 * Explicitly refresh from the internal opportunity: a NEW draft re-prefilled
 * through the P1 whitelist. Deliberate and admin-visible — the live version is
 * untouched until that draft is reviewed and published.
 */
export async function startDraftFromSourceAction(publicationId: string): Promise<void> {
  const { db, auth } = await requireAdminSession();
  await assertNoOpenVersion(db, publicationId);
  const provenance = await getPublicationProvenance(db, publicationId);
  if (!provenance) throw new Error("This publication has no linked internal opportunity.");
  await createPublicationFromOpportunity(db, provenance.opportunityId, auth.userId);
  refreshPublication(publicationId);
}

// ============================================================================
// Documents
// ----------------------------------------------------------------------------
// A document is a file in the private `publication-documents` bucket plus the
// row that describes it. The object path is generated HERE, on the server, from
// a random UUID — the browser supplies the file, never a location for it — and
// the file's type and size are validated before anything is stored.
// ============================================================================
export interface DocumentFormState {
  ok?: boolean;
  error?: string;
}

export async function addDocumentAction(
  versionId: string, publicationId: string,
  _prev: DocumentFormState, formData: FormData,
): Promise<DocumentFormState> {
  const { db, auth } = await requireAdminSession();

  const title = trimmed(formData.get("title"));
  if (!title) return { error: "The document title is required." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  // Validate against what the server sees, not what the form claimed.
  const check = checkUpload(file.type, file.size);
  if (!check.ok) return { error: check.reason };

  // Random, server-generated, and only ever known to the server and the row.
  const storagePath = newObjectPath(versionId, check.mimeType);
  await putDocumentObject(storagePath, await file.arrayBuffer(), check.mimeType);

  try {
    await addPublicationDocument(db, {
      versionId,
      title,
      category: (trimmed(formData.get("category")) || "other") as DocumentCategory,
      accessLevel: (trimmed(formData.get("accessLevel")) || "standard") as DocumentAccessLevel,
      storagePath,
      fileName: safeFileName(file.name),
      mimeType: check.mimeType,
      sizeBytes: check.sizeBytes,
    }, auth.userId);
  } catch (e) {
    // The row did not land, so the object must not survive it: an object with
    // no row is unreachable and unaccounted for.
    await deleteDocumentObject(storagePath);
    throw e;
  }

  refreshPublication(publicationId);
  return { ok: true };
}

/**
 * The original file name, kept for display and for the download's Content-
 * Disposition only. It never influences where the object is stored, so path
 * separators and traversal segments are simply removed rather than escaped.
 */
function safeFileName(name: string): string | null {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").trim();
  return cleaned ? cleaned.slice(0, 160) : null;
}

export async function updateDocumentAction(
  documentId: string, publicationId: string, formData: FormData,
): Promise<void> {
  const { db } = await requireAdminSession();
  const title = trimmed(formData.get("title"));
  if (!title) throw new Error("The document title is required.");
  await updatePublicationDocument(db, documentId, {
    title,
    category: trimmed(formData.get("category")) || "other",
    accessLevel: trimmed(formData.get("accessLevel")) || "standard",
  });
  refreshPublication(publicationId);
}

export async function removeDocumentAction(
  documentId: string, publicationId: string,
): Promise<void> {
  const { db } = await requireAdminSession();
  // The path comes back from the deleted row, so the object removed is exactly
  // the one that row owned — the browser never names it.
  const storagePath = await removePublicationDocument(db, documentId);
  if (storagePath) await deleteDocumentObject(storagePath);
  refreshPublication(publicationId);
}
