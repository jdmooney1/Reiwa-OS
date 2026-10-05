"use server";

// ============================================================================
// Exchange-rate server action (admin settings).
// ----------------------------------------------------------------------------
// Two gates, as with the other admin actions: the session must be a Reiwa
// administrator here, and the database's fx_rates policy (app.is_admin(),
// migration 0025) says the same again. The source is validated as REQUIRED on
// every submission (src/lib/fx.ts); the browser's idea of "today" is not used.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { isPortalAdmin } from "@/lib/auth/admin";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { validateRateSubmission } from "@/lib/fx";
import { saveFxRate, todayUtc } from "@/lib/data/fx-rates";

export async function saveFxRateAction(raw: unknown): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("admin.fx.save", { currency: (raw as { currency?: unknown } | null)?.currency }, async () => {
    if (!isPortalAdmin(session)) throw new AppError("Only a Reiwa administrator can change exchange rates.");
    const checked = validateRateSubmission((raw ?? {}) as Record<string, unknown>, todayUtc());
    if (!checked.ok) throw new AppError(checked.error);
    await saveFxRate(session, checked.value);
    revalidatePath("/admin/settings");
    revalidatePath("/portfolio");
  }, { ruleMessage: "This rate could not be saved." });
}
