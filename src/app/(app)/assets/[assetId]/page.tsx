import { notFound } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getAssetFile } from "@/lib/data/assets";
import { AssetHeader } from "@/components/asset-intelligence/asset-header";
import { AssetTabs } from "@/components/asset-intelligence/asset-tabs";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: { assetId: string } }) {
  const auth = await requireAuth();
  const file = await getAssetFile(toDbSession(auth), params.assetId);
  if (!file) notFound();

  return (
    <div className="min-h-full bg-surface pb-16">
      <AssetHeader file={file} portfolioName={null} />
      <AssetTabs file={file} canWrite={auth.role !== "investor_viewer"} />
    </div>
  );
}
