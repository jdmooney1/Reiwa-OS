// ============================================================================
// Saved pipeline views (migration 0037). A person's own named filter sets.
// ----------------------------------------------------------------------------
// Row level security does the scoping (your own rows only); nothing here filters by user
// as a substitute for it, though every statement also names the owner so a mistake in a
// policy could not widen it.
//
// THE TABLE MAY NOT EXIST YET. Migration 0037 is applied by hand, after review. Until it is,
// reading saved views answers "not available" instead of throwing, so the pipeline page keeps
// working with the menu hidden; a write answers with a sentence that says why.
//
// A definition is validated on the way IN (sanitiseViewState drops anything that is not a
// valid view) and again on the way OUT, so a hand-edited row can only ever put a valid view on
// screen.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { sanitiseViewState, type PipelineViewState } from "@/lib/pipeline/view-state";

export interface SavedView {
  viewId: string;
  name: string;
  state: PipelineViewState;
  updatedAt: string;
}

export const MAX_SAVED_VIEWS = 50;
export const NAME_MAX = 80;

const UNDEFINED_TABLE = "42P01";
const UNIQUE_VIOLATION = "23505";
const code = (e: unknown) => (e as { code?: string } | null)?.code;

/** True when the error is "the saved views table does not exist" (migration 0037 not applied). */
export function isMissingTable(e: unknown): boolean {
  return code(e) === UNDEFINED_TABLE;
}

export function cleanViewName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (name === "") throw new AppError("Give the view a name.");
  if (name.length > NAME_MAX) throw new AppError(`Keep the name to ${NAME_MAX} characters or fewer.`);
  return name;
}

const NOT_APPLIED = "Saved views are not available yet: the database update for them has not been applied.";

interface Row { view_id: string; name: string; definition: unknown; updated_at: string }
const toView = (r: Row): SavedView => ({
  viewId: r.view_id, name: r.name, state: sanitiseViewState(r.definition), updatedAt: String(r.updated_at),
});

export async function listSavedViews(session: Session): Promise<{ available: boolean; views: SavedView[] }> {
  try {
    const views = await withSession(session, async (tx) => {
      const { rows } = await tx.query<Row>(
        `select view_id, name, definition, updated_at from pipeline_saved_views
          where user_id = $1 order by lower(name)`, [session.userId]);
      return rows.map(toView);
    });
    return { available: true, views };
  } catch (e) {
    if (isMissingTable(e)) return { available: false, views: [] };
    throw e;
  }
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (isMissingTable(e)) throw new AppError(NOT_APPLIED);
    if (code(e) === UNIQUE_VIOLATION) throw new AppError("You already have a view with that name.");
    throw e;
  }
}

export async function createSavedView(session: Session, name: unknown, state: unknown): Promise<SavedView> {
  const n = cleanViewName(name);
  const definition = sanitiseViewState(state);
  return guarded(() => withSession(session, async (tx) => {
    const count = await tx.query<{ n: string }>("select count(*)::text n from pipeline_saved_views where user_id = $1", [session.userId]);
    if (Number(count.rows[0].n) >= MAX_SAVED_VIEWS) throw new AppError(`You can keep up to ${MAX_SAVED_VIEWS} saved views. Delete one first.`);
    const { rows } = await tx.query<Row>(
      `insert into pipeline_saved_views(user_id, name, definition) values ($1, $2, $3::jsonb)
       returning view_id, name, definition, updated_at`,
      [session.userId, n, JSON.stringify(definition)]);
    return toView(rows[0]);
  }));
}

/** Rename, or replace the stored filters with the ones now on screen, or both. */
export async function updateSavedView(
  session: Session, viewId: string, patch: { name?: unknown; state?: unknown },
): Promise<SavedView> {
  const sets: string[] = [];
  const params: unknown[] = [viewId, session.userId];
  if (patch.name !== undefined) { params.push(cleanViewName(patch.name)); sets.push(`name = $${params.length}`); }
  if (patch.state !== undefined) { params.push(JSON.stringify(sanitiseViewState(patch.state))); sets.push(`definition = $${params.length}::jsonb`); }
  if (sets.length === 0) throw new AppError("Nothing to change.");
  return guarded(() => withSession(session, async (tx) => {
    const { rows } = await tx.query<Row>(
      `update pipeline_saved_views set ${sets.join(", ")} where view_id = $1 and user_id = $2
       returning view_id, name, definition, updated_at`, params);
    if (!rows[0]) throw new AppError("That view could not be found.");
    return toView(rows[0]);
  }));
}

export async function deleteSavedView(session: Session, viewId: string): Promise<void> {
  await guarded(() => withSession(session, async (tx) => {
    const { rows } = await tx.query("delete from pipeline_saved_views where view_id = $1 and user_id = $2 returning view_id", [viewId, session.userId]);
    if (rows.length === 0) throw new AppError("That view could not be found.");
  }));
}
