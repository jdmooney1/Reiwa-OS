// ============================================================================
// What the translator is told. PURE: it returns text.
// ----------------------------------------------------------------------------
// The rules below are the contract the output is checked against afterwards
// (numbers.ts for the figures, schema.ts for the shape); the prompt asks, the code
// verifies. Nothing in here can be relied on as the only protection.
// ============================================================================
import { TEASER_KEYS } from "@/lib/memo-translation/sections";
import type { TranslationSource } from "@/lib/memo-translation/source";

/**
 * Japanese terms the firm already uses, taken from its own bilingual Asset Snapshot
 * template. Handing them over is how the Teaser and the Snapshot come to say the same
 * thing in Japanese. It is deliberately short: an anchor, not a dictionary.
 */
const GLOSSARY: [string, string][] = [
  ["Net initial yield (NIY)", "純初期利回り"],
  ["Passing rent", "現行賃料"],
  ["ERV (estimated rental value)", "想定賃料"],
  ["Occupancy", "稼働率"],
  ["Capex", "資本的支出"],
];

export const TRANSLATION_SYSTEM_PROMPT = [
  "You are translating an investor-facing property investment teaser from English into Japanese for Reiwa Capital. A member of staff will read your draft and decide what, if anything, to keep.",
  "",
  "Rules, all of them absolute:",
  "- NEVER change a figure. Every number, currency amount, percentage, multiple, area, count, year and date appears in your Japanese exactly as it appears in the English: the same digits, the same commas, the same decimal places, the same currency symbol. Use ordinary ASCII digits. Do not convert to 万 or 億, do not convert currencies or units, do not round, do not reformat a date, and do not write a number as a word. Translate only the language around the figures.",
  "- Do not add anything: no fact, no figure, no list numbering, no heading, no greeting, no disclaimer, no commentary, no translator's note.",
  "- Do not leave anything out or soften, strengthen, summarise or reorder what the English says. Keep each section's line breaks.",
  "- Keep proper names exactly as written in the English, in their original script: the asset's name, street names, company names and people.",
  "- Be consistent across the WHOLE document. The same English term is the same Japanese term in every section: choose one rendering the first time you meet a term and keep it. Use these terms where they apply, exactly:",
  ...GLOSSARY.map(([en, ja]) => `    ${en}: ${ja}`),
  "- Write in the polite register of a Japanese investment document (です・ます調), consistently.",
  "- If a section says something you cannot translate faithfully, translate as closely as you can and do not explain.",
  "",
  `Return only the structured result. It has one field per Teaser section (${TEASER_KEYS.join(", ")}). Fill in the sections you are given. For a section you are NOT given, return an empty string.`,
].join("\n");

export function buildTranslationPrompt(source: TranslationSource): string {
  const header = [
    "Translate the following Investor Teaser into Japanese.",
    "",
    `Asset: ${source.assetName} (a proper name: keep it as written)`,
    `Currency of money figures: ${source.currency}`,
    `Sections given: ${source.sections.map((s) => s.key).join(", ")}`,
    "",
    "=== TEASER (English) ===",
  ].join("\n");
  const body = source.sections.map((s) => `### ${s.key} (${s.label})\n${s.text}`);
  return [header, ...body].join("\n\n");
}
