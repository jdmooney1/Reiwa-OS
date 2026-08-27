"use server";

import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { addPerformancePeriod } from "@/lib/data/assets";

const numOrNull = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : Number(s);
};

export async function addPerformancePeriodAction(assetId: string, formData: FormData): Promise<void> {
  const session = await requireDbSession();
  await addPerformancePeriod(session, assetId, {
    periodLabel: String(formData.get("periodLabel") || "").trim(),
    periodEnd: String(formData.get("periodEnd") || "").trim(),
    noi: numOrNull(formData.get("noi")),
    grossRentalIncome: numOrNull(formData.get("grossRentalIncome")),
    operatingExpenses: numOrNull(formData.get("operatingExpenses")),
    occupancyPct: numOrNull(formData.get("occupancyPct")),
    capex: numOrNull(formData.get("capex")),
    valuation: numOrNull(formData.get("valuation")),
    debt: numOrNull(formData.get("debt")),
    ltvPct: numOrNull(formData.get("ltvPct")),
  });
  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/portfolio");
}
