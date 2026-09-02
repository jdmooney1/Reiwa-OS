import { redirect } from "next/navigation";
import { getSession, toDbSession } from "@/lib/auth/session";
import { listAssetsForNav } from "@/lib/data/assets";
import { Sidebar } from "@/components/layout/sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const assets = await listAssetsForNav(toDbSession(session));

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar
        user={{ name: session.name ?? session.email, role: session.canWrite ? session.role : "read_only" }}
        assets={assets}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
