"use server";

import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { addPerformancePeriod } from "@/lib/data/assets";

import { parseNumber, PERCENT, NON_NEGATIVE, ANY_AMOUNT } from "@/lib/validation/numeric";

export async function addPerformancePeriodAction(assetId: string, formData: FormData): Promise<void> {
  const session = await requireDbSession();
  await addPerformancePeriod(session, assetId, {
    periodLabel: String(formData.get("periodLabel") || "").trim(),
    periodEnd: String(formData.get("periodEnd") || "").trim(),
    noi: parseNumber(formData.get("noi"), "Net operating income", ANY_AMOUNT),
    grossRentalIncome: parseNumber(formData.get("grossRentalIncome"), "Gross rental income", NON_NEGATIVE),
    operatingExpenses: parseNumber(formData.get("operatingExpenses"), "Operating expenses", NON_NEGATIVE),
    occupancyPct: parseNumber(formData.get("occupancyPct"), "Occupancy", PERCENT),
    capex: parseNumber(formData.get("capex"), "Capex", NON_NEGATIVE),
    valuation: parseNumber(formData.get("valuation"), "Valuation", NON_NEGATIVE),
    debt: parseNumber(formData.get("debt"), "Debt", NON_NEGATIVE),
    ltvPct: parseNumber(formData.get("ltvPct"), "LTV", PERCENT),
  });
  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/portfolio");
}
