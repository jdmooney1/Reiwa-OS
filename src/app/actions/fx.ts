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
import { loadEcbRates, applyEcbRates } from "@/lib/data/fx-sync";
import { withSession } from "@/lib/db/client";
import { FX_CURRENCIES } from "@/lib/fx";

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

/**
 * Hand a currency back to the daily ECB sync: fetch today's reference rate and
 * write it over the manual one. Runs as the administrator, under RLS, so the
 * fx_rates policy still decides who may do this. A fetch failure leaves the
 * manual rate exactly as it was.
 */
export async function adoptEcbRateAction(currency: unknown): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("admin.fx.adopt-ecb", { currency }, async () => {
    if (!isPortalAdmin(session)) throw new AppError("Only a Reiwa administrator can change exchange rates.");
    const code = String(currency ?? "").toUpperCase();
    if (!(FX_CURRENCIES as readonly string[]).includes(code)) throw new AppError("That currency is not kept.");
    let rows;
    try {
      rows = await loadEcbRates();
    } catch {
      throw new AppError("The ECB rate could not be fetched just now, so the current rate was left as it is. Try again shortly.");
    }
    const done = await withSession(session, (tx) => applyEcbRates(tx, rows, { only: [code], takeOverManual: true }));
    if (done.written.length === 0) throw new AppError("The ECB rate could not be applied.");
    revalidatePath("/admin/settings");
    revalidatePath("/portfolio");
  }, { ruleMessage: "This rate could not be saved." });
}
