// ============================================================================
// The one call a translation makes. SERVER-ONLY.
// ----------------------------------------------------------------------------
// Same discipline as src/lib/memo-review/review.ts, deliberately: structured output
// through the SDK already in the project, ANTHROPIC_API_KEY on the server only, and
// every way the call can fail is an ERROR - "the translation did not run" and "the
// translation came back empty" must never look alike to the person reading the panel.
//
// ONE CALL, WHOLE TEASER. Terminology has to be consistent across sections ("net initial
// yield" must not become two Japanese phrases), and only the whole document in one
// context gives the model that. So this is never called once per section.
//
// NOTHING HERE CAN WRITE. It takes text and returns text. It is handed no session, no
// database handle and no memo id, so there is no path from a model response to
// memos.ja_overrides, memos.overrides or any other row.
// ============================================================================
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AppError } from "@/lib/errors";
import type { MemoSectionKey } from "@/lib/memo/sections";
import { TranslationSchema, validateTranslation } from "@/lib/memo-translation/schema";

/**
 * Pinned, and recorded on every row in memo_translation_drafts: a draft is only
 * interpretable against the model that wrote it.
 */
export const TRANSLATION_MODEL = "claude-opus-5-5";

/** A whole Teaser in Japanese is a few thousand tokens; this stops a runaway answer. */
const MAX_TOKENS = 16000;

export interface TranslationOutcome {
  model: string;
  sections: Partial<Record<MemoSectionKey, string>>;
}

/** The slice of the SDK this uses, so a test can stand in for the network. */
export interface TranslationClient {
  messages: { parse: Anthropic["messages"]["parse"] };
}

export function translationIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function runTranslation(
  systemPrompt: string, teaserText: string, sent: readonly MemoSectionKey[],
  deps: { client?: TranslationClient } = {},
): Promise<TranslationOutcome> {
  let client = deps.client;
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new AppError("The translation service is not configured on this server, so nothing was translated.");
    }
    client = new Anthropic({ apiKey });
  }

  let response;
  try {
    response = await client.messages.parse({
      model: TRANSLATION_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: teaserText }],
      output_config: { format: zodOutputFormat(TranslationSchema) },
    });
  } catch (error) {
    // Most specific first. The service's own message is not shown: it is written for a
    // developer, and errors.ts exists to keep that out of the UI.
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AppError("The translation service rejected this server's credentials, so nothing was translated.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AppError("The translation service is busy. Wait a moment and try again.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AppError("The translation service could not be reached, so nothing was translated.");
    }
    throw error;
  }

  // A policy decline arrives as a successful response with empty content.
  if (response.stop_reason === "refusal") {
    throw new AppError("The translation service declined to translate this text, so nothing was recorded.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AppError("The translation did not finish within its limit, so nothing was recorded. Try again.");
  }
  // Null when the response did not parse against the schema: a failure, never "empty".
  if (!response.parsed_output) {
    throw new AppError("The translation came back in a form this system could not read, so nothing was recorded.");
  }
  const parsed = TranslationSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new AppError("The translation came back in a form this system could not read, so nothing was recorded.");
  }

  return { model: response.model ?? TRANSLATION_MODEL, sections: validateTranslation(sent, parsed.data) };
}
