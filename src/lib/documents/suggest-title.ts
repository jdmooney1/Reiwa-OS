// A suggested document title from a file name. Pure; imports nothing.
//
// Only a SUGGESTION, and only ever offered into an empty Title box: the person
// chooses the title, and a category is never guessed from the file at all.

/** `rent_roll_2026.xlsx` -> `rent roll 2026`: last extension off, _ and - to spaces. */
export function titleFromFileName(fileName: string): string {
  const base = (fileName ?? "").split(/[\\/]/).pop() ?? "";
  const noExt = base.replace(/\.[^.]*$/, "");
  return noExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
