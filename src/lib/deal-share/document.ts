// ============================================================================
// What a prospect is shown, cut down to exactly that. Pure.
// ----------------------------------------------------------------------------
// A stored memo's content holds EVERY format (all seventeen sections, the committee's
// minute, the score), because a memo is a version and the formats are renderings of it.
// A prospect is entitled to two renderings only, so this is where the rest is dropped:
// the data layer hands a stored memo in, and what comes out is the Snapshot's grid and
// the Teaser's sections and nothing that was not asked for. The page renders THIS, never
// the stored content, so an internal section cannot reach the screen by a rendering slip.
//
// A frozen picture is served through the share's own route. A picture that is still a
// LIVE reference (a Snapshot finalised before pictures were frozen) is dropped: showing it
// would mean reaching property_photos, which this surface never does.
// ============================================================================
import {
  resolveSection, sectionsFor, normaliseContent,
  type ComposedSnapshot, type MemoOverrides, type ResolvedSection,
} from "@/lib/memo/compose";
import { SECTION_LABEL, type MemoSectionKey } from "@/lib/memo/sections";

export interface ProspectSnapshot {
  data: ComposedSnapshot;
  /** Frozen pictures this snapshot can show. */
  pictures: { photo: boolean; map: boolean };
}

export interface ProspectTeaser {
  assetName: string;
  currency: string;
  finalizedAt: string | null;
  sections: { key: MemoSectionKey; label: string; resolved: ResolvedSection }[];
}

export interface ProspectDocument {
  snapshot: ProspectSnapshot | null;
  teaser: ProspectTeaser | null;
}

/** The Snapshot, with live picture references and workspace-only gap notes removed. */
export function prospectSnapshot(rawContent: unknown): ProspectSnapshot | null {
  const memo = normaliseContent(rawContent);
  const s = memo?.snapshot;
  if (!s) return null;
  const photo = s.photo?.source === "frozen" ? s.photo : null;
  const map = s.map?.source === "frozen" ? s.map : null;
  return { data: { ...s, photo, map, gaps: [] }, pictures: { photo: photo !== null, map: map !== null } };
}

/** The Teaser's sections only, resolved the way an external reader sees them. */
export function prospectTeaser(rawContent: unknown, rawOverrides: unknown, finalizedAt: string | null): ProspectTeaser | null {
  const memo = normaliseContent(rawContent);
  if (!memo) return null;
  const overrides = (rawOverrides && typeof rawOverrides === "object" ? rawOverrides : {}) as MemoOverrides;
  return {
    assetName: memo.assetName, currency: memo.currency, finalizedAt,
    sections: sectionsFor("teaser").map((key) => ({
      key, label: SECTION_LABEL[key], resolved: resolveSection(memo.sections[key], overrides[key], "teaser"),
    })),
  };
}
