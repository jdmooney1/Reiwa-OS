import { getAssetFiles, getOrganization } from "@/lib/asset-intelligence/mock";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { PortfolioDashboard } from "@/components/asset-intelligence/portfolio-dashboard";

export default function PortfolioPage() {
  const org = getOrganization();
  const files = getAssetFiles();

  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow={`${org.name} · Asset Intelligence`}
        title="Portfolio Dashboard"
        description="Where should management focus? Portfolio-level intelligence aggregated from each asset record."
        actions={<Badge tone="gold">Demo data</Badge>}
      />
      <PortfolioDashboard files={files} />
    </div>
  );
}
