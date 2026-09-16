import { notFound, redirect } from "next/navigation";
import { requireAuth, toDbSession } from "@/lib/auth/session";
import { getItem, listCandidates } from "@/lib/data/ingestion";
import { ItemReview } from "@/components/inbox/item-review";

export const dynamic = "force-dynamic";

export default async function InboxItemPage({ params }: { params: { itemId: string } }) {
  const auth = await requireAuth();
  if (auth.role === "investor_viewer") redirect("/pipeline");

  const session = toDbSession(auth);
  const item = await getItem(session, params.itemId);
  if (!item) notFound();

  const candidates = await listCandidates(session, params.itemId);
  return <ItemReview item={item} candidates={candidates} />;
}
