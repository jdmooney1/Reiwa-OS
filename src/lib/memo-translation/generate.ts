// ============================================================================
// One generation, start to finish, with its dependencies handed in. No I/O of its own.
// ----------------------------------------------------------------------------
// refuse a final memo -> build the English source -> one translation call -> check every
// section's figures -> record the draft. The model call and the recording are PARAMETERS,
// so this orchestration is tested without a network and without a database, and the
// server action is only wiring.
//
// WHAT IT NEVER DOES: write to the memo. The only thing it can cause to be written is the
// record of the draft, through `record`. Accepting a section is a different function in a
// different module, reached only by a person pressing Accept.
// ============================================================================
import { AppError } from "@/lib/errors";
import type { ComposedMemo, MemoOverrides } from "@/lib/memo/compose";
import type { MemoSectionKey } from "@/lib/memo/sections";
import { translationRefusalReason } from "@/lib/memo-translation/eligibility";
import { checkFigures, type FigureCheck } from "@/lib/memo-translation/numbers";
import { TRANSLATION_SYSTEM_PROMPT, buildTranslationPrompt } from "@/lib/memo-translation/prompt";
import { buildTranslationSource } from "@/lib/memo-translation/source";

export interface TranslatableMemo {
  status: "draft" | "final";
  content: ComposedMemo;
  overrides: MemoOverrides;
}

export interface DraftSection {
  key: MemoSectionKey;
  label: string;
  source: string;
  draft: string;
  figures: FigureCheck;
}

export interface GeneratedDraft {
  draftId: string;
  model: string;
  createdAt: string;
  createdByName: string | null;
  sections: DraftSection[];
}

export interface GenerateDeps {
  translate: (
    system: string, teaser: string, sent: readonly MemoSectionKey[],
  ) => Promise<{ model: string; sections: Partial<Record<MemoSectionKey, string>> }>;
  record: (
    model: string, sections: Record<string, { source: string; draft: string }>,
  ) => Promise<{ draftId: string; createdAt: string; createdByName: string | null }>;
}

export async function generateTranslationDraft(memo: TranslatableMemo, deps: GenerateDeps): Promise<GeneratedDraft> {
  const refusal = translationRefusalReason(memo.status);
  if (refusal) throw new AppError(refusal);

  const source = buildTranslationSource(memo.content, memo.overrides);
  if (source.sections.length === 0) {
    throw new AppError("The Investor Teaser has nothing recorded to translate yet. Compose or write its sections first.");
  }

  const sent = source.sections.map((s) => s.key);
  const outcome = await deps.translate(TRANSLATION_SYSTEM_PROMPT, buildTranslationPrompt(source), sent);

  const stored: Record<string, { source: string; draft: string }> = {};
  const sections: DraftSection[] = source.sections.map((s) => {
    const draft = outcome.sections[s.key] ?? "";
    stored[s.key] = { source: s.text, draft };
    return { key: s.key, label: s.label, source: s.text, draft, figures: checkFigures(s.text, draft) };
  });

  const row = await deps.record(outcome.model, stored);
  return { draftId: row.draftId, model: outcome.model, createdAt: row.createdAt, createdByName: row.createdByName, sections };
}
