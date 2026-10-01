// ============================================================================
// The server-side re-encode is the control that removes metadata.
// ----------------------------------------------------------------------------
// Real sharp, real bytes, no database. The fixtures carry EXIF with GPS, an
// owner name and an orientation tag; the assertions look at the STORED output,
// not at anything the browser produced.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { reencodePhoto } from "@/lib/photos/process";
import { checkPhoto, FULL_EDGE, THUMB_EDGE, thumbPathFor, sniffImageType } from "@/lib/photos/constraints";

/** The marker of every segment before the image data starts, e.g. 0xe1 = APP1 (EXIF/XMP). */
function jpegMarkers(buf: Uint8Array): number[] {
  expect([buf[0], buf[1]]).toEqual([0xff, 0xd8]);
  const out: number[] = [];
  let i = 2;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    out.push(marker);
    if (marker === 0xda) break; // start of scan: the pixels follow
    i += 2 + ((buf[i + 2] << 8) | buf[i + 3]);
  }
  return out;
}

const GPS = {
  IFD0: { Copyright: "secret-owner", Make: "PhoneCo" },
  IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" },
};

async function phonePhoto(width = 40, height = 20, orientation?: number): Promise<Buffer> {
  let img = sharp({ create: { width, height, channels: 3, background: "#cc3333" } }).jpeg().withExif(GPS);
  if (orientation) img = img.withMetadata({ orientation });
  return img.toBuffer();
}

describe("metadata is removed from what is stored", () => {
  it("the fixture really carries EXIF, GPS and an owner (so the test can fail)", async () => {
    const input = await phonePhoto();
    expect(jpegMarkers(input)).toContain(0xe1);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    expect(input.includes(Buffer.from("secret-owner"))).toBe(true);
  });

  it("neither the full image nor the thumbnail keeps any EXIF, XMP, IPTC, ICC or comment segment", async () => {
    const { full, thumb } = await reencodePhoto(await phonePhoto(3000, 2000, 6));
    for (const out of [full, thumb]) {
      const markers = jpegMarkers(out);
      for (const m of [0xe1 /* EXIF, XMP */, 0xe2 /* ICC */, 0xed /* IPTC */, 0xfe /* comment */]) {
        expect(markers, `marker ${m.toString(16)}`).not.toContain(m);
      }
      const meta = await sharp(out).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(out.includes(Buffer.from("secret-owner"))).toBe(false);
      expect(out.includes(Buffer.from("PhoneCo"))).toBe(false);
      expect(out.includes(Buffer.from("Exif"))).toBe(false);
    }
  });

  it("a PNG or WebP upload is stored as JPEG too", async () => {
    const png = await sharp({ create: { width: 30, height: 30, channels: 3, background: "#0a0" } }).png().toBuffer();
    const webp = await sharp({ create: { width: 30, height: 30, channels: 3, background: "#0a0" } }).webp().toBuffer();
    for (const input of [png, webp]) {
      const { full, thumb } = await reencodePhoto(input);
      expect(sniffImageType(full)).toBe("image/jpeg");
      expect(sniffImageType(thumb)).toBe("image/jpeg");
    }
  });
});

describe("orientation is kept, as pixels", () => {
  it("a photo taken on its side (EXIF orientation 6) comes out upright and untagged", async () => {
    // Stored 40 wide x 20 high with orientation 6 = displayed 20 wide x 40 high.
    const input = await phonePhoto(40, 20, 6);
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const { full } = await reencodePhoto(input);
    const meta = await sharp(full).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(meta.orientation).toBeUndefined();
  });

  it("the pixels moved, not just the numbers: the red/blue split lands where the rotation says", async () => {
    // Left half red, right half blue, tagged orientation 6 (rotate 90 clockwise):
    // upright, the red half is the TOP and the blue half the BOTTOM.
    const left = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const input = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#0000ff" } })
      .composite([{ input: left, left: 0, top: 0 }]).jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toBuffer();
    const { full } = await reencodePhoto(input);
    const { data, info } = await sharp(full).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const top = px(10, 5), bottom = px(10, 35);
    expect(top[0]).toBeGreaterThan(200);    // red on top
    expect(bottom[2]).toBeGreaterThan(200); // blue below
  });
});

describe("sizes", () => {
  it("caps the longest edge at 2400 and 480, keeping the aspect ratio", async () => {
    const { full, thumb } = await reencodePhoto(await phonePhoto(5000, 3000));
    const f = await sharp(full).metadata();
    const t = await sharp(thumb).metadata();
    expect([f.width, f.height]).toEqual([FULL_EDGE, 1440]);
    expect([t.width, t.height]).toEqual([THUMB_EDGE, 288]);
  });

  it("never enlarges a photo that is already small", async () => {
    const { full, thumb } = await reencodePhoto(await phonePhoto(300, 200));
    expect((await sharp(full).metadata()).width).toBe(300);
    expect((await sharp(thumb).metadata()).width).toBe(300);
  });

  it("the thumbnail is much smaller than the full image", async () => {
    const noisy = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } } }).jpeg().toBuffer();
    const { full, thumb } = await reencodePhoto(noisy);
    expect(thumb.length).toBeLessThan(full.length / 5);
  });

  it("flattens transparency onto white, not black", async () => {
    const clear = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { full } = await reencodePhoto(clear);
    const { data } = await sharp(full).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
  });
});

describe("a file that only looks like an image", () => {
  it("passes the header check but the re-encode refuses it", async () => {
    const lie = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("<html>not pixels</html>")]);
    expect(checkPhoto("image/jpeg", lie.length, lie).ok).toBe(true);
    await expect(reencodePhoto(lie)).rejects.toBeTruthy();
  });
});

describe("thumbPathFor", () => {
  it("inserts -thumb before the extension and nothing else", () => {
    expect(thumbPathFor("properties/p1/0b9e.jpg")).toBe("properties/p1/0b9e-thumb.jpg");
    expect(thumbPathFor("a/b.c/d.JPG")).toBe("a/b.c/d-thumb.JPG");
  });

  it("is deterministic, injective and never equals its input", () => {
    const p = "properties/3f2/9a1c4e.jpg";
    expect(thumbPathFor(p)).toBe(thumbPathFor(p));
    expect(thumbPathFor(p)).not.toBe(p);
    expect(thumbPathFor("properties/3f2/9a1c4f.jpg")).not.toBe(thumbPathFor(p));
  });

  it("round-trips: stripping the suffix recovers the full path", () => {
    const p = "properties/3f2/9a1c4e.jpg";
    expect(thumbPathFor(p).replace("-thumb", "")).toBe(p);
  });
});

describe("the upload path uses it, always", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const action = read("src/app/actions/photos.ts");
  const upload = action.slice(action.indexOf("export async function uploadPhotoAction"), action.indexOf("export async function makeHeadlinePhotoAction"));

  it("re-encodes before anything is stored, with no condition on visibility or role", () => {
    expect(upload.indexOf("reencodePhoto(")).toBeGreaterThan(-1);
    expect(upload.indexOf("reencodePhoto(")).toBeLessThan(upload.indexOf("putPhotoObject("));
    expect(upload).not.toMatch(/visibility|diligence/);
  });

  it("stores the RE-ENCODED bytes, never the upload, and both renditions", () => {
    expect(upload).toContain("putPhotoObject(objectPath, processed.full,");
    expect(upload).toContain("putPhotoObject(thumbPathFor(objectPath), processed.thumb,");
    expect(upload).not.toMatch(/putPhotoObject\([^)]*\bbytes\b/);
    expect(upload).toContain("STORED_PHOTO_TYPE");
  });

  it("removes both objects when any step fails, before the row exists", () => {
    const tryBlock = upload.slice(upload.indexOf("try {\n      await putPhotoObject"));
    expect(tryBlock.indexOf("recordPhoto(")).toBeGreaterThan(tryBlock.indexOf("putPhotoObject(thumbPathFor"));
    expect(tryBlock).toContain("await deletePhotoObject(objectPath)");
    const storage = read("src/lib/photos/storage.ts");
    expect(storage).toContain("remove([objectPath, thumbPathFor(objectPath)])");
  });

  it("the metadata-keeping option is nowhere in the process module", () => {
    expect(read("src/lib/photos/process.ts")).not.toMatch(/withMetadata|withExif|keepMetadata|keepExif/);
  });

  it("the route serves the thumbnail only for an exact variant=thumb, with the same authorisation", () => {
    const route = read("src/app/api/asset-photos/[photoId]/route.ts");
    expect(route).toContain('searchParams.get("variant") === "thumb"');
    const delivery = read("src/lib/photos/delivery.ts");
    expect(delivery.indexOf("mayReadPhoto(session.role, row.visibility)")).toBeLessThan(delivery.indexOf("thumbPathFor(row.object_path)"));
  });

  it("the board card and the gallery grid ask for the thumbnail; the headline slot does not", () => {
    expect(read("src/components/opportunities/opportunity-pipeline.tsx")).toContain("?variant=thumb");
    const section = read("src/components/workspace/photos-section.tsx");
    expect(section.match(/\?variant=thumb/g)).toHaveLength(1); // the grid
    expect(section).toContain("src={`/api/asset-photos/${headline.photoId}`}");
  });

  it("sharp is a server-external package, so the platform bundles its binary", () => {
    expect(readFileSync(join(process.cwd(), "next.config.mjs"), "utf8")).toMatch(/serverComponentsExternalPackages: \["pg", "sharp"\]/);
  });
});
