// node-postgres returns numeric/bigint as strings — coerce at the
// data-layer boundary so calculations use real numbers.
export const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
export const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);
export const bool = (v: unknown): boolean => v === true || v === "true" || v === "t";
