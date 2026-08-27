import { withSession, type Session } from "@/lib/db/client";

/** Orgs visible to the session (RLS: members see theirs, admin sees all). */
export async function listOrgs(session: Session): Promise<{ orgId: string; name: string }[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ org_id: string; name: string }>(
      "select org_id, name from organizations order by name");
    return rows.map((r) => ({ orgId: r.org_id, name: r.name }));
  });
}
