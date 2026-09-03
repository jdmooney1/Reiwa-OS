import { requireAdminAuth } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

/**
 * Every route under /admin is the Investment Portal admin surface: Reiwa
 * administrators only. Non-admin staff receive a 404 (see requireAdminAuth);
 * the database write policies enforce the same boundary regardless.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminAuth();
  return <>{children}</>;
}
