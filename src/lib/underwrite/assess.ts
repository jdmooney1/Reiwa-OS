// ============================================================================
// The one call a deal assessment makes. SERVER-ONLY.
// ----------------------------------------------------------------------------
// Same posture as lib/memo-review/review.ts: structured output against a closed
// schema, a pinned model recorded on every row, and every failure loud. A
// missing key, a refusal, a truncated or unparseable answer is an error, never
// a silent "no assessment", because "it did not run" and "it found nothing to
// say" must not look alike.
//
// NOTHING HERE CAN WRITE. It takes text and returns an assessment. It is given
// no session and no database handle.
// ============================================================================
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AppError } from "@/lib/errors";
import { AssessmentSchema, type Assessment } from "@/lib/underwrite/assessment";

/** Pinned, and recorded on every row in deal_assessments. */
export const ASSESSMENT_MODEL = "claude-opus-5";

const MAX_TOKENS = 12000;

export function assessmentIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function runAssessment(systemPrompt: string, dealText: string): Promise<{ model: string; assessment: Assessment }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError("The assessment service is not configured on this server. The model figures were not affected; run without the assessment, or set ANTHROPIC_API_KEY.");
  }
  const client = new Anthropic({ apiKey });
  let response;
  try {
    response = await client.messages.parse({
      model: ASSESSMENT_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: dealText }],
      output_config: { format: zodOutputFormat(AssessmentSchema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AppError("The assessment service rejected this server's credentials, so no assessment was run.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AppError("The assessment service is busy. Wait a moment and run it again.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AppError("The assessment service could not be reached, so no assessment was run.");
    }
    throw error;
  }
  if (response.stop_reason === "refusal") {
    throw new AppError("The assessment service declined to assess this deal, so nothing was recorded.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AppError("The assessment did not finish within its limit, so nothing was recorded. Try again.");
  }
  if (!response.parsed_output) {
    throw new AppError("The assessment came back in a form this system could not read, so nothing was recorded.");
  }
  return { model: response.model ?? ASSESSMENT_MODEL, assessment: response.parsed_output };
}
