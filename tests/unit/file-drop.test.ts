// ============================================================================
// Drag-and-drop uploads: the pieces that can be tested without a browser.
// The behaviour itself (highlight, drop, reorder untouched) was driven in real
// Chromium; these pin the rules so they cannot drift.
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasFiles, dropZoneClass, useFileDrop, type FileDrop } from "@/lib/ui/use-file-drop";
import { titleFromFileName } from "@/lib/documents/suggest-title";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("hasFiles", () => {
  it("is true only when the drag carries OS files", () => {
    expect(hasFiles(["Files"])).toBe(true);
    expect(hasFiles(["text/uri-list", "Files"])).toBe(true);
    expect(hasFiles(["text/plain"])).toBe(false);   // an in-page drag, such as a gallery reorder
    expect(hasFiles([])).toBe(false);
    expect(hasFiles(null)).toBe(false);
    expect(hasFiles(undefined)).toBe(false);
  });
});

describe("the drop zone's look", () => {
  it("dashed at rest, solid and tinted while a file is over it", () => {
    expect(dropZoneClass(false)).toContain("border-dashed");
    expect(dropZoneClass(false)).not.toContain("border-solid");
    expect(dropZoneClass(true)).toContain("border-solid");
    expect(dropZoneClass(true)).toContain("bg-purple/5");
    expect(dropZoneClass(true)).not.toContain("border-dashed");
  });
});

describe("the zone's handlers", () => {
  function zone(onFiles: (f: File[]) => void, disabled = false): FileDrop {
    let captured!: FileDrop;
    const C = () => { captured = useFileDrop(onFiles, { disabled }); return null; };
    const err = vi.spyOn(console, "error").mockImplementation(() => {}); // setState outside a mounted tree
    renderToStaticMarkup(createElement(C));
    err.mockRestore();
    return captured;
  }
  const ev = (types: string[], files: File[] = []) => {
    const e = { dataTransfer: { types, files, dropEffect: "" }, preventDefault: vi.fn() };
    return e as unknown as Parameters<FileDrop["bind"]["onDrop"]>[0] & { preventDefault: ReturnType<typeof vi.fn> };
  };
  const quiet = (fn: () => void) => { const e = vi.spyOn(console, "error").mockImplementation(() => {}); fn(); e.mockRestore(); };
  const png = new File(["x"], "a.png", { type: "image/png" });

  it("a file drop hands the files to the caller and takes the event", () => {
    const got: File[][] = []; const z = zone((f) => got.push(f));
    const e = ev(["Files"], [png]);
    quiet(() => z.bind.onDrop(e));
    expect(got).toEqual([[png]]);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("dragover over a file drag is allowed to drop; the drop effect is copy", () => {
    const z = zone(() => {}); const e = ev(["Files"]);
    z.bind.onDragOver(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.dataTransfer.dropEffect).toBe("copy");
  });

  it("an in-page drag (no Files) is ignored by every handler and never preventDefault()ed, so reordering gets it", () => {
    const got: File[][] = []; const z = zone((f) => got.push(f));
    for (const h of [z.bind.onDragEnter, z.bind.onDragOver, z.bind.onDragLeave, z.bind.onDrop]) {
      const e = ev(["text/plain"]);
      quiet(() => h(e));
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
    expect(got).toEqual([]);
  });

  it("a disabled zone (read-only) ignores files too", () => {
    const got: File[][] = []; const z = zone((f) => got.push(f), true);
    const e = ev(["Files"], [png]);
    z.bind.onDrop(e);
    expect(got).toEqual([]);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(z.over).toBe(false);
  });
});

describe("titleFromFileName", () => {
  it("strips the extension and turns underscores and hyphens into spaces", () => {
    expect(titleFromFileName("rent_roll_2026.xlsx")).toBe("rent roll 2026");
    expect(titleFromFileName("Lease-summary__final.v2.pdf")).toBe("Lease summary final.v2");
    expect(titleFromFileName("a - b.docx")).toBe("a b");
  });
  it("handles awkward names without inventing anything", () => {
    expect(titleFromFileName("noextension")).toBe("noextension");
    expect(titleFromFileName(".hidden")).toBe("");
    expect(titleFromFileName("")).toBe("");
    expect(titleFromFileName("C:\\fakepath\\Survey_Report.pdf")).toBe("Survey Report");
  });
});

describe("wiring", () => {
  const photos = read("src/components/workspace/photos-section.tsx");
  const docs = read("src/components/workspace/documents-section.tsx");

  it("the headline shows the whole photograph at its own proportions, and the grid stays a uniform crop", () => {
    const headline = photos.match(/<img[\s\S]*?alt="Headline photograph"[\s\S]*?\/>/)![0];
    expect(headline).toContain("max-h-[480px] w-full object-contain bg-surface-sunken");
    expect(headline).not.toMatch(/aspect-|object-cover/);
    expect(photos).toMatch(/alt=\{`Gallery photograph[^`]*`\}[\s\S]{0,120}aspect-\[4\/3\] w-full object-cover/);
  });

  it("both photo zones call the same upload() the buttons use, headline as headline", () => {
    expect(photos).toContain("useFileDrop(onFilesDropped(true)");
    expect(photos).toContain("useFileDrop(onFilesDropped(false)");
    expect(photos).toContain("void upload(files, asHeadline)");
    // read-only users get no zone at all
    expect(photos).toContain("disabled: !canWrite");
  });

  it("the reorder drag handlers are untouched and still gated on the internal dragId", () => {
    expect(photos).toContain("onDragOver={(e) => { if (canWrite && dragId) e.preventDefault(); }}");
    expect(photos).toContain("onDrop={(e) => { e.preventDefault(); drop(p.photoId); }}");
    expect(photos).toContain("draggable={canWrite}");
  });

  it("the documents zone fills the file input and a suggested title, and never submits or sets a category", () => {
    expect(docs).toContain("fileInput.current.files = dt.files");
    expect(docs).toContain('titleInput.current.value.trim() === ""');
    expect(docs).toContain("titleFromFileName(first.name)");
    const handler = docs.slice(docs.indexOf("const fileDrop"), docs.indexOf("const linkedByDoc"));
    expect(handler).not.toMatch(/requestSubmit|submit\(|formAction|category/i);
    expect(docs).toContain("Only the first file was used");
    // The existing control is still there and still works.
    expect(docs).toContain('<input name="file" type="file" required accept={UPLOAD_ACCEPT}');
  });
});
