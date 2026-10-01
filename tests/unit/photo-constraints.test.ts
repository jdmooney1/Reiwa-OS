// ============================================================================
// Asset-photo validation, naming, ordering and access: all pure.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  checkPhoto, sniffImageType, ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES, PHOTO_BUCKET,
  DEFAULT_PHOTO_VISIBILITY, PHOTO_VISIBILITIES, isPhotoVisibility,
} from "@/lib/photos/constraints";
import { fitWithin, moveItem, MAX_EDGE } from "@/lib/photos/client";
import { mayReadPhoto } from "@/lib/photos/access";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script>");

describe("checkPhoto", () => {
  it("accepts JPEG, PNG and WebP whose bytes agree with what they claim", () => {
    expect(checkPhoto("image/jpeg", 1000, JPEG)).toEqual({ ok: true, mimeType: "image/jpeg", sizeBytes: 1000 });
    expect(checkPhoto("image/png", 1000, PNG).ok).toBe(true);
    expect(checkPhoto("image/webp", 1000, WEBP).ok).toBe(true);
    expect(checkPhoto("IMAGE/JPEG; charset=x", 1000, JPEG).ok).toBe(true);
  });

  it("refuses anything that is not one of the three types, by declared type", () => {
    for (const t of ["image/svg+xml", "image/gif", "image/heic", "application/pdf", "text/html", ""]) {
      expect(checkPhoto(t, 1000, JPEG).ok, t).toBe(false);
    }
    expect(Object.keys(ALLOWED_PHOTO_TYPES).sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("refuses a file that is not an image whatever it is called", () => {
    const r = checkPhoto("image/jpeg", HTML.length, HTML);
    expect(r).toEqual({ ok: false, reason: "The file is not a JPEG, PNG or WebP image." });
  });

  it("refuses a file whose bytes contradict its declared type", () => {
    const r = checkPhoto("image/png", 1000, JPEG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("image/jpeg");
  });

  it("enforces the 15 MB ceiling exactly, and refuses empty files", () => {
    expect(MAX_PHOTO_BYTES).toBe(15 * 1024 * 1024);
    expect(checkPhoto("image/jpeg", MAX_PHOTO_BYTES, JPEG).ok).toBe(true);
    expect(checkPhoto("image/jpeg", MAX_PHOTO_BYTES + 1, JPEG).ok).toBe(false);
    expect(checkPhoto("image/jpeg", 0, JPEG).ok).toBe(false);
    expect(checkPhoto("image/jpeg", NaN, JPEG).ok).toBe(false);
  });

  it("sniffs from the first bytes only, and returns null for short or unknown input", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("defaults and the bucket", () => {
  it("a photograph is internal until a person widens it", () => {
    expect(DEFAULT_PHOTO_VISIBILITY).toBe("internal");
    expect(isPhotoVisibility("internal")).toBe(true);
    expect(isPhotoVisibility("diligence")).toBe(true);
    expect(isPhotoVisibility("public")).toBe(false);
    expect(isPhotoVisibility(undefined)).toBe(false);
  });

  it("has no standard tier: a photo is never more exposed than the location pin", () => {
    expect(isPhotoVisibility("standard")).toBe(false);
    expect([...PHOTO_VISIBILITIES]).toEqual(["internal", "diligence"]);
  });

  it("has its own bucket, distinct from documents", () => {
    expect(PHOTO_BUCKET).toBe("property-photos");
  });
});

describe("shrinking and ordering in the browser", () => {
  it("never enlarges, and caps the longest edge keeping the aspect ratio", () => {
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(4800, 3200)).toEqual({ width: MAX_EDGE, height: 1600 });
    expect(fitWithin(3000, 6000)).toEqual({ width: 1200, height: MAX_EDGE });
    expect(fitWithin(1, 100000)).toEqual({ width: 1, height: MAX_EDGE });
  });

  it("moves an item and leaves the original alone", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moveItem(ids, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(ids, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("treats a nonsense move as no move", () => {
    expect(moveItem(["a", "b"], -1, 1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("who may read a photograph", () => {
  it("internal staff read every tier", () => {
    for (const role of ["reiwa_admin", "org_user"] as const) {
      for (const tier of ["internal", "diligence"] as const) {
        expect(mayReadPhoto(role, tier), `${role}/${tier}`).toBe(true);
      }
    }
  });

  it("the read-only role and anything unknown read nothing at any tier", () => {
    for (const role of ["investor_viewer", null, undefined, "investor", "anon"]) {
      for (const tier of ["internal", "diligence"] as const) {
        expect(mayReadPhoto(role as never, tier), `${String(role)}/${tier}`).toBe(false);
      }
    }
  });
});
