// ============================================================================
// Frozen memo assets: the pure half. A finalised Snapshot's pictures are copies under
// the memo's own id; nothing in the stored content refers back to a photograph.
// The same rule against real storage and a real database is in tests/memo-assets.test.ts.
// ============================================================================
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEMO_ASSET_BUCKET, frozenAssetPath, freezeSnapshotContent, isFrozenPathOf, liveRefsIn,
} from "@/lib/memo/assets";
import { snapshotImageUrl } from "@/lib/memo/snapshot-images";
import { composeMemo, normaliseContent } from "@/lib/memo/compose";
import { AssetSnapshot } from "@/components/memo/asset-snapshot";
import { snapshotSource } from "./memo-source.fixture";

const MEMO = "33333333-3333-4333-8333-333333333333";
const SHA = "ab".repeat(32);
const code = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const draftContent = () => JSON.parse(JSON.stringify(composeMemo(snapshotSource()))) as Record<string, unknown>;

describe("the frozen path", () => {
  it("is keyed by the memo and the slot, never by the photograph", () => {
    const p = frozenAssetPath(MEMO, "photo", SHA);
    expect(p).toBe(`memos/${MEMO}/photo-abababababababab.jpg`);
    expect(p).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(MEMO_ASSET_BUCKET).toBe("memo-assets");
  });

  it("is content-addressed: the same bytes give the same path (a retry), different bytes a different one", () => {
    expect(frozenAssetPath(MEMO, "map", SHA)).toBe(frozenAssetPath(MEMO, "map", SHA));
    expect(frozenAssetPath(MEMO, "map", SHA)).not.toBe(frozenAssetPath(MEMO, "map", "cd".repeat(32)));
    expect(frozenAssetPath(MEMO, "map", SHA)).not.toBe(frozenAssetPath(MEMO, "photo", SHA));
  });

  it("is only ever signed for the memo that owns it", () => {
    expect(isFrozenPathOf(MEMO, `memos/${MEMO}/photo-x.jpg`)).toBe(true);
    for (const bad of [`memos/other/photo-x.jpg`, `memos/${MEMO}/../other/x.jpg`, "properties/p/x.jpg", "", null, undefined, 5]) {
      expect(isFrozenPathOf(MEMO, bad), String(bad)).toBe(false);
    }
  });
});

describe("freezing the stored content", () => {
  const frozen = freezeSnapshotContent(draftContent(), {
    photo: frozenAssetPath(MEMO, "photo", SHA), map: frozenAssetPath(MEMO, "map", SHA),
  });

  it("swaps each picture for its frozen copy", () => {
    const s = (frozen.snapshot as Record<string, unknown>);
    expect(s.photo).toEqual({ source: "frozen", path: `memos/${MEMO}/photo-abababababababab.jpg` });
    expect(s.map).toEqual({ source: "frozen", path: `memos/${MEMO}/map-abababababababab.jpg` });
  });

  it("leaves NOTHING that resolves back to a photograph: no live reference, no legacy id, no photograph id anywhere", () => {
    const json = JSON.stringify(frozen);
    expect(liveRefsIn(frozen)).toEqual([]);
    expect(json).not.toContain('"source":"live"');
    expect(json).not.toContain('"photoId"');
    expect(json).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(json).not.toContain("22222222-2222-4222-8222-222222222222");
  });

  it("leaves everything else in the content exactly as it was", () => {
    const before = draftContent();
    const after = freezeSnapshotContent(before, { photo: "memos/x/photo-1.jpg" });
    expect(after.sections).toEqual(before.sections);
    expect(after.basis).toEqual(before.basis);
    const { photo: _p, map: _m, ...restAfter } = after.snapshot as Record<string, unknown>;
    const { photo: _p2, map: _m2, ...restBefore } = before.snapshot as Record<string, unknown>;
    void _p; void _m; void _p2; void _m2;
    expect(restAfter).toEqual(restBefore);
  });

  it("a slot with no copy keeps what it had: a picture is frozen or it is absent, never half-converted", () => {
    const only = freezeSnapshotContent(draftContent(), { photo: "memos/x/photo-1.jpg" });
    const s = only.snapshot as Record<string, unknown>;
    expect(s.photo).toEqual({ source: "frozen", path: "memos/x/photo-1.jpg" });
    expect((s.map as { source: string }).source).toBe("live");
  });

  it("a stored memo that predates the Snapshot is returned untouched", () => {
    const old = draftContent(); delete old.snapshot;
    expect(freezeSnapshotContent(old, { photo: "x" })).toEqual(old);
  });

  it("survives a round trip through normaliseContent as a frozen picture", () => {
    const back = normaliseContent(JSON.parse(JSON.stringify(frozen)))!;
    expect(back.snapshot!.photo).toEqual({ source: "frozen", path: `memos/${MEMO}/photo-abababababababab.jpg` });
  });
});

describe("what a draft still points at", () => {
  it("is live: staff see the current pictures while they iterate", () => {
    expect(liveRefsIn(draftContent())).toEqual([
      { slot: "photo", photoId: "11111111-1111-4111-8111-111111111111" },
      { slot: "map", photoId: "22222222-2222-4222-8222-222222222222" },
    ]);
  });

  it("a memo stored before pictures had a slot (a bare photoId) is read as the live photograph it was", () => {
    const legacy = draftContent();
    const snap = legacy.snapshot as Record<string, unknown>;
    delete snap.photo; delete snap.map; snap.photoId = "11111111-1111-4111-8111-111111111111";
    expect(liveRefsIn(legacy)).toEqual([{ slot: "photo", photoId: "11111111-1111-4111-8111-111111111111" }]);
    expect(normaliseContent(legacy)!.snapshot!.photo).toEqual({ source: "live", photoId: "11111111-1111-4111-8111-111111111111" });
    // ... and freezing it removes the legacy key.
    expect(JSON.stringify(freezeSnapshotContent(legacy, { photo: "memos/x/photo-1.jpg" }))).not.toContain("photoId");
  });
});

describe("where the page fetches a picture from", () => {
  it("a live picture goes through the photograph route; a frozen one through the memo's own route", () => {
    expect(snapshotImageUrl({ source: "live", photoId: "p1" }, MEMO, "photo")).toBe("/api/asset-photos/p1");
    expect(snapshotImageUrl({ source: "frozen", path: "memos/x/photo-1.jpg" }, MEMO, "photo")).toBe(`/api/memo-assets/${MEMO}/photo`);
    expect(snapshotImageUrl({ source: "frozen", path: "memos/x/map-1.jpg" }, MEMO, "map")).toBe(`/api/memo-assets/${MEMO}/map`);
  });

  it("the URL of a frozen picture carries no path and no photograph id", () => {
    const u = snapshotImageUrl({ source: "frozen", path: `memos/${MEMO}/photo-abababababababab.jpg` }, MEMO, "photo")!;
    expect(u).not.toContain("memos/");
    expect(u).not.toContain(".jpg");
  });

  it("a frozen picture without its memo cannot be drawn, rather than guessed at", () => {
    expect(snapshotImageUrl({ source: "frozen", path: "memos/x/photo-1.jpg" }, null, "photo")).toBeNull();
    expect(snapshotImageUrl(null, MEMO, "photo")).toBeNull();
  });

  it("a FINAL Snapshot renders from the frozen copy and never touches the photograph route", () => {
    const frozen = normaliseContent(freezeSnapshotContent(draftContent(), {
      photo: frozenAssetPath(MEMO, "photo", SHA), map: frozenAssetPath(MEMO, "map", SHA),
    }))!.snapshot!;
    const html = renderToStaticMarkup(createElement(AssetSnapshot, { data: frozen, surface: "print", memoId: MEMO }));
    expect(html).toContain(`src="/api/memo-assets/${MEMO}/photo"`);
    expect(html).toContain(`src="/api/memo-assets/${MEMO}/map"`);
    expect(html).not.toContain("/api/asset-photos/");
    expect(html).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  it("a DRAFT renders live, so a recompose picks up a changed photograph", () => {
    const draft = normaliseContent(draftContent())!.snapshot!;
    const html = renderToStaticMarkup(createElement(AssetSnapshot, { data: draft, surface: "print", memoId: MEMO }));
    expect(html).toContain('src="/api/asset-photos/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('src="/api/asset-photos/22222222-2222-4222-8222-222222222222"');
    expect(html).not.toContain("/api/memo-assets/");
  });
});

describe("the delivery of a frozen picture reads the memo and nothing else", () => {
  const route = code("src/app/api/memo-assets/[memoId]/[slot]/route.ts");
  const data = code("src/lib/data/memo-assets.ts");
  const download = data.slice(data.indexOf("export async function issueMemoAssetDownload"));

  it("the route and the download function name no photograph, no photograph table and no photograph store", () => {
    for (const src of [route, download]) {
      expect(src).not.toMatch(/property_photos|photo_id|object_path|@\/lib\/photos|PHOTO_BUCKET|asset-photos|issuePhotoDownload/);
    }
    expect(download).toContain("from memos where memo_id = $1");
  });

  it("the path is read from the memo row, must sit under that memo's own folder, and is only signed when frozen", () => {
    expect(download).toContain("isFrozenPathOf(memoId, row.path)");
    expect(download).toContain('row.source !== "frozen"');
  });

  it("is staff-only, and every refusal is the same bare 404", () => {
    expect(download).toContain("mayReadPhoto(session.role");
    expect(route).toContain("status: 404");
    expect(route).toContain("status: 303");
    expect(route).toContain("no-store");
  });

  it("the store has no update and no delete: a frozen asset is written once", () => {
    const store = code("src/lib/memo/assets-store.ts");
    expect(store).not.toMatch(/\.remove\(|\.update\(|\.move\(|upsert:\s*true/);
    expect(store).toContain("upsert: false");
    expect(store).toMatch(/public:\s*false/);
  });

  it("finalising goes through the freezing path, in one transaction with the status change", () => {
    expect(code("src/app/actions/memo.ts")).toContain("finaliseMemoFreezingAssets(session, memoId)");
    expect(code("src/app/actions/memo.ts")).not.toMatch(/\bfinalizeMemo\(/);
    const fin = data.slice(data.indexOf("export async function finaliseMemoFreezingAssets"), data.indexOf("export async function issueMemoAssetDownload"));
    expect(fin.indexOf("freezeSnapshotContent(")).toBeGreaterThan(-1);
    expect(fin.indexOf("freezeSnapshotContent(")).toBeLessThan(fin.indexOf("set status = 'final'"));
    expect(fin).toContain("for update");
  });
});
