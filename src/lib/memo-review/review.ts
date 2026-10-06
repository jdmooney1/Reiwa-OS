// ============================================================================
// The one call a pre-finalisation review makes. SERVER-ONLY.
// ----------------------------------------------------------------------------
// Unlike lib/email/send.ts, which is one POST and deliberately carries no SDK,
// this uses the official SDK for one reason: STRUCTURED OUTPUTS. The reviewer
// must come back as a closed list of typed findings, and letting the API enforce
// the schema is the difference between a reviewer and a model writing prose at
// somebody about to finalise a document. The schema is the contract; the prompt
// only explains it.
//
// ANTHROPIC_API_KEY is server-only and is never given a NEXT_PUBLIC_ prefix.
// A missing key is an ERROR, never a silent empty review: "no findings" and
// "the review did not run" must never look alike to the person reading the
// panel, because the first would wrongly read as reassurance.
//
// NOTHING HERE CAN WRITE. It takes text, it returns findings. It is handed no
// session, no database handle and no memo id, so there is no path from a model
// response to memos.content, to memos.overrides, or to any other row.
// ============================================================================
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AppError } from "@/lib/errors";
import { ReviewSchema, type Finding } from "@/lib/memo-review/findings";

/**
 * Pinned, and recorded on every row in memo_ai_reviews. A review is only
 * interpretable against the model that produced it, so this changing is a fact
 * the audit trail has to carry rather than a detail of deployment.
 */
export const REVIEW_MODEL = "claude-opus-5";

/** Generous for a list of short findings; small enough that a runaway answer stops. */
const MAX_TOKENS = 8000;

export interface ReviewOutcome {
  model: string;
  findings: Finding[];
}

export function reviewIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * Run one review over already-composed memo text.
 *
 * Throws an AppError the workspace can show when the review cannot run. It never
 * returns an empty list to mean a failure: an empty list means the model read
 * the memo and raised nothing.
 */
export async function runReview(systemPrompt: string, memoText: string): Promise<ReviewOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError("The review service is not configured on this server, so no review was run.");
  }

  const client = new Anthropic({ apiKey });

  let response;
  try {
    response = await client.messages.parse({
      model: REVIEW_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: memoText }],
      output_config: { format: zodOutputFormat(ReviewSchema) },
    });
  } catch (error) {
    // Typed, most specific first. The service's own message is not shown: it is
    // written for a developer, and errors.ts exists to keep that out of the UI.
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AppError("The review service rejected this server's credentials, so no review was run.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AppError("The review service is busy. Wait a moment and run the review again.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AppError("The review service could not be reached, so no review was run.");
    }
    throw error;
  }

  // A policy decline arrives as a successful response, not an exception, and
  // leaves `content` empty. Checked before anything reads the body.
  if (response.stop_reason === "refusal") {
    throw new AppError("The review service declined to review this memo, so no review was run.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AppError("The review did not finish within its limit, so no review was recorded. Try again.");
  }

  // Null when the response did not parse against the schema. Treated as a
  // failure, never as "nothing found".
  if (!response.parsed_output) {
    throw new AppError("The review came back in a form this system could not read, so nothing was recorded.");
  }

  return { model: response.model ?? REVIEW_MODEL, findings: response.parsed_output.findings };
}
