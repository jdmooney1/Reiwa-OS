// The shape of the bug was "delete a stored file by a path read from a row, assuming that row
// is its only owner". These guards keep that shape from coming back: who may delete a file,
// that no code copies a row's path to a second row, and that the database enforces ownership.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("who may delete a publication-document file", () => {
  const callers = walk("src").filter((f) => /\bdeleteDocumentObject\b/.test(read(f)) && f !== "src/lib/documents/storage.ts");

  it("only the two failed-insert cleanups and the row-then-file remover", () => {
    expect(callers.sort()).toEqual([
      "src/app/actions/admin-portal.ts",
      "src/app/actions/workspace.ts",
      "src/lib/documents/publication-documents.ts",
    ]);
  });

  it.each(["src/app/actions/admin-portal.ts", "src/app/actions/workspace.ts"])(
    "%s deletes only an object it has just created itself, inside the catch for its own insert", (file) => {
      const src = read(file);
      const call = src.lastIndexOf("deleteDocumentObject(");
      const before = src.slice(Math.max(0, call - 1500), call);
      expect(before).toMatch(/new(Opportunity)?ObjectPath\(/);
      expect(before).toContain("catch");
    });

  it("the remover returns a path only after checking nothing else references it", () => {
    const portal = read("src/lib/data/investor-portal.ts");
    const fn = portal.slice(portal.indexOf("export async function removePublicationDocument("));
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toMatch(/publication_documents where storage_path[\s\S]*opportunity_documents where storage_path/);
  });
});

describe("no code gives two rows one file", () => {
  it("a draft's documents are copied through the object store, never by copying the path", () => {
    const src = read("src/lib/data/admin-portal.ts");
    expect(src).not.toMatch(/insert into publication_documents[\s\S]{0,400}\bselect\b[\s\S]{0,200}storage_path/);
    expect(src).toContain("options.objects.copy(");
  });

  it("the database enforces it: a unique index on publication_documents.storage_path (0034)", () => {
    expect(read("supabase/migrations/0034_publication_document_ownership.sql"))
      .toMatch(/create unique index if not exists publication_documents_storage_path_key\s+on public\.publication_documents \(storage_path\)/);
  });

  it("photographs are exclusive too (0019), and memo pictures are copies", () => {
    expect(read("supabase/migrations/0019_property_photos.sql")).toMatch(/create unique index if not exists property_photos_object_path_key/);
    expect(read("src/lib/data/memo-assets.ts")).toContain("object_path");
  });
});
