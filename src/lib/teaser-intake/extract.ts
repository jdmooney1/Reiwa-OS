// ============================================================================
// The one call a teaser intake makes. SERVER-ONLY.
// ----------------------------------------------------------------------------
// Same discipline as lib/memo-review/review.ts: the official SDK for structured
// outputs, a pinned model, typed errors turned into words a person can act on,
// and no path from a model response to the database. This function is handed
// file bytes and returns a typed reading; it holds no session and no
// connection. What happens to the reading is decided by a person on the review
// screen and then by the deal-seed parser.
//
// A missing key is an ERROR, never an empty reading: "the teaser said nothing"
// and "the teaser was never read" must not look alike on the review screen.
// ============================================================================
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AppError } from "@/lib/errors";
import { TeaserExtractionSchema, type TeaserExtraction } from "@/lib/teaser-intake/schema";
import { INTAKE_SYSTEM_PROMPT, INTAKE_USER_TEXT } from "@/lib/teaser-intake/prompt";

/** Pinned, and stored with the deal it produced (source_facts.teaser_intake.model). */
export const INTAKE_MODEL = "claude-opus-5";

/** A full IM with a long tenancy schedule fits comfortably; a runaway answer stops. */
const MAX_TOKENS = 16000;

/** The reader's whole budget. The route allows five minutes; this leaves room to answer the browser. */
const TIMEOUT_MS = 240_000;

export type IntakeMediaType = "application/pdf" | "image/png" | "image/jpeg";

export interface ExtractionOutcome {
  model: string;
  extraction: TeaserExtraction;
}

export function intakeIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function extractTeaser(bytes: Uint8Array, mediaType: IntakeMediaType): Promise<ExtractionOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError("The reading service is not configured on this server, so the teaser was not read. You can still enter the deal by hand.");
  }

  const data = Buffer.from(bytes).toString("base64");
  const file: Anthropic.ContentBlockParam = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };

  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });

  let response;
  try {
    response = await client.messages.parse({
      model: INTAKE_MODEL,
      max_tokens: MAX_TOKENS,
      system: INTAKE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [file, { type: "text", text: INTAKE_USER_TEXT }] }],
      output_config: { format: zodOutputFormat(TeaserExtractionSchema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AppError("The reading service rejected this server's credentials, so the teaser was not read.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AppError("The reading service is busy. Wait a moment and try again.");
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      throw new AppError("Reading the teaser took too long. Try a shorter file (the teaser rather than the full IM), or enter the deal by hand.");
    }
    if (error instanceof Anthropic.BadRequestError) {
      throw new AppError("The reading service could not open this file. It may be password-protected, scanned at very low quality, or over 100 pages.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AppError("The reading service could not be reached, so the teaser was not read.");
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    throw new AppError("The reading service declined to read this file.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AppError("The reading did not finish within its limit. Try the teaser rather than the full IM.");
  }
  if (!response.parsed_output) {
    throw new AppError("The reading came back in a form this system could not use. Try again, or enter the deal by hand.");
  }
  return { model: response.model ?? INTAKE_MODEL, extraction: response.parsed_output };
}
