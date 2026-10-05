import { requireAdminAuth } from "@/lib/auth/admin";
import { toDbSession } from "@/lib/auth/session";
import { listFxRates, todayUtc } from "@/lib/data/fx-rates";
import { FX_CURRENCIES, FX_STALE_AFTER_DAYS } from "@/lib/fx";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { FxRatesCard } from "@/components/admin/fx-rates-card";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const auth = await requireAdminAuth();
  const rates = await listFxRates(toDbSession(auth));
  const missing = FX_CURRENCIES.filter((c) => !rates.some((r) => r.currency === c));

  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow="Investment Portal"
        title="Settings"
        description="Reference data the portfolio and the investment memos are valued in."
      />
      <div className="space-y-6 px-8 py-6">
        <Card>
          <CardHeader eyebrow="Reference data" title="Exchange rates" />
          <div className="border-b border-line px-5 py-3 text-xs leading-relaxed text-ink-muted">
            These are maintained by hand. There is no live feed: a rate is the number you enter, the source you name and the date
            it is good for. Every rate needs a source. A rate older than {FX_STALE_AFTER_DAYS} days is flagged on the portfolio
            and in any memo that uses it; nothing is blocked.
          </div>
          {missing.length > 0 && (
            <p className="border-b border-line px-5 py-3 text-xs text-negative" role="alert">
              No rate is recorded for {missing.join(", ")}. The portfolio cannot value assets in a currency with no rate.
            </p>
          )}
          <FxRatesCard rates={rates} today={todayUtc()} />
        </Card>
      </div>
    </div>
  );
}
