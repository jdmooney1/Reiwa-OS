import { redirect } from "next/navigation";
import { getSession, toDbSession } from "@/lib/auth/session";
import { listAssetsForNav } from "@/lib/data/assets";
import { countAwaitingReview } from "@/lib/data/ingestion";
import { Sidebar } from "@/components/layout/sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const dbSession = toDbSession(session);
  const canIngest = session.role !== "investor_viewer";

  const [assets, inboxCount] = await Promise.all([
    listAssetsForNav(dbSession),
    // Investors have no ingestion surface at all, so the count is not even read.
    canIngest ? countAwaitingReview(dbSession) : Promise.resolve(0),
  ]);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar
        user={{ name: session.name ?? session.email, role: session.role }}
        assets={assets}
        inboxCount={inboxCount}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
