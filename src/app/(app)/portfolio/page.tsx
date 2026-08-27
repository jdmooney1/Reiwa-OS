import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getPortfolioData } from "@/lib/data/portfolio";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { PortfolioDashboard } from "@/components/asset-intelligence/portfolio-dashboard";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const auth = await requireAuth();
  const { files, fx } = await getPortfolioData(toDbSession(auth));
  const fxNote = `FX: ${fx.source}${fx.asOf ? ` as at ${formatDate(fx.asOf)}` : ""}`;

  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow="Asset Intelligence"
        title="Portfolio Dashboard"
        description="Where should management focus? Aggregated live from each asset record."
        actions={<Badge tone="gold">Demo data</Badge>}
      />
      <PortfolioDashboard files={files} rates={fx.rates} fxNote={fxNote} />
    </div>
  );
}
