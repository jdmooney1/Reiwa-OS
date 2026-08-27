import { notFound } from "next/navigation";
import { getAssetFile, getPortfolios } from "@/lib/asset-intelligence/mock";
import { AssetHeader } from "@/components/asset-intelligence/asset-header";
import { AssetTabs } from "@/components/asset-intelligence/asset-tabs";

export default function AssetPage({ params }: { params: { assetId: string } }) {
  const file = getAssetFile(params.assetId);
  if (!file) notFound();

  const portfolio = getPortfolios().find((p) => p.portfolio_id === file.asset.portfolio_id);

  return (
    <div className="min-h-full bg-surface pb-16">
      <AssetHeader file={file} portfolioName={portfolio?.name ?? null} />
      <AssetTabs file={file} />
    </div>
  );
}
