// ============================================================================
// Numbers that arrive from a form. SERVER-SIDE.
// ----------------------------------------------------------------------------
// Every action used `Number(string)`, which accepts "12e3" (12,000), " 0x10 "
// (16), "Infinity", and "1,5" (NaN, which then reached the database or was
// silently turned into null). `<input type="number">` is no defence: the browser
// lets "e" through, and a form can be posted without a browser. A percentage of
// 150, an IRR of -15 and a probability of 999 all saved without complaint.
//
// One strict parser, one place. A refusal is an AppError, which the action
// layer already treats as "a message written for the person reading it".
// ============================================================================
import { AppError } from "@/lib/errors";

export interface Bounds {
  min?: number;
  max?: number;
}

/** 0-100, the way every percentage in this application is stored. */
export const PERCENT: Bounds = { min: 0, max: 100 };
/** Zero or more: prices, costs, debt, income. */
export const NON_NEGATIVE: Bounds = { min: 0 };
/** Anything that can genuinely be negative, such as NOI on a vacant building. */
export const ANY_AMOUNT: Bounds = {};

// Optional sign, digits, optional fraction. No exponent, no separators, no
// leading "+", no hex, no "Infinity", no surrounding text. Leading "." is
// refused too: ".5" is far likelier a typo than a decision.
const PLAIN = /^-?\d+(\.\d+)?$/;

/** Beyond this a value cannot be a real amount and would overflow numeric columns. */
const LIMIT = 1e15;

/**
 * Parse one form value. Blank is "unknown" and returns null: it is never
 * imputed as zero. Anything else must be a plain number inside `bounds`.
 */
export function parseNumber(
  raw: FormDataEntryValue | null | undefined, label: string, bounds: Bounds = ANY_AMOUNT,
): number | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  if (!PLAIN.test(s)) {
    throw new AppError(`${label} must be a plain number such as 12.5. "${s.slice(0, 20)}" is not.`);
  }
  const n = Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > LIMIT) {
    throw new AppError(`${label} is out of range.`);
  }
  if (bounds.min !== undefined && n < bounds.min) {
    throw new AppError(`${label} cannot be below ${bounds.min}.`);
  }
  if (bounds.max !== undefined && n > bounds.max) {
    throw new AppError(`${label} cannot be above ${bounds.max}.`);
  }
  return n;
}
