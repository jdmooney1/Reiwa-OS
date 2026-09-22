"use server";

import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import {
  applyDdTemplate, setDdStatus, updateDdItem,
  addContact, deleteContact,
  addDocument, deleteDocument,
  addDecision,
  type DdStatus, type DecisionType,
} from "@/lib/data/deal-file";
import type { DdTemplateId } from "@/lib/dd/templates";

const text = (v: FormDataEntryValue | null): string => String(v ?? "").trim();
const orNull = (v: FormDataEntryValue | null): string | null => text(v) || null;

const refresh = (opportunityId: string) =>
  revalidatePath(`/opportunities/${opportunityId}`);

// ---- Due diligence ---------------------------------------------------------

export async function applyDdTemplateAction(
  opportunityId: string, templateId: DdTemplateId,
): Promise<void> {
  const session = await requireDbSession();
  await applyDdTemplate(session, opportunityId, templateId);
  refresh(opportunityId);
}

export async function setDdStatusAction(
  opportunityId: string, itemId: string, status: DdStatus,
): Promise<void> {
  const session = await requireDbSession();
  await setDdStatus(session, itemId, status);
  refresh(opportunityId);
}

export async function updateDdItemAction(
  opportunityId: string, itemId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  await updateDdItem(session, itemId, {
    owner: orNull(formData.get("owner")),
    dueDate: orNull(formData.get("dueDate")),
    notes: orNull(formData.get("notes")),
  });
  refresh(opportunityId);
}

// ---- Contacts --------------------------------------------------------------

export async function addContactAction(
  opportunityId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  const name = text(formData.get("name"));
  if (!name) throw new Error("A contact needs a name");
  await addContact(session, opportunityId, {
    name,
    company: orNull(formData.get("company")),
    role: orNull(formData.get("role")),
    email: orNull(formData.get("email")),
    phone: orNull(formData.get("phone")),
    notes: orNull(formData.get("notes")),
  });
  refresh(opportunityId);
}

export async function deleteContactAction(
  opportunityId: string, contactId: string,
): Promise<void> {
  const session = await requireDbSession();
  await deleteContact(session, contactId);
  refresh(opportunityId);
}

// ---- Documents (register) --------------------------------------------------

export async function addDocumentAction(
  opportunityId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  const fileName = text(formData.get("fileName"));
  if (!fileName) throw new Error("A document needs a file name");
  await addDocument(session, opportunityId, {
    fileName,
    category: text(formData.get("category")) || "Other",
    notes: orNull(formData.get("notes")),
  });
  refresh(opportunityId);
}

export async function deleteDocumentAction(
  opportunityId: string, documentId: string,
): Promise<void> {
  const session = await requireDbSession();
  await deleteDocument(session, documentId);
  refresh(opportunityId);
}

// ---- Decision log ----------------------------------------------------------

export async function addDecisionAction(
  opportunityId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  const decision = text(formData.get("decision"));
  if (!decision) throw new Error("A decision entry needs a decision");
  await addDecision(session, opportunityId, {
    decision,
    decisionType: (text(formData.get("decisionType")) || "other") as DecisionType,
    decisionDate: orNull(formData.get("decisionDate")),
    rationale: orNull(formData.get("rationale")),
    nextSteps: orNull(formData.get("nextSteps")),
    author: orNull(formData.get("author")),
  });
  refresh(opportunityId);
}
