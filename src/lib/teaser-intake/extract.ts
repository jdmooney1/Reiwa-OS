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
import { TeaserExtractionSchema, normaliseReading, type TeaserExtraction } from "@/lib/teaser-intake/schema";
import { INTAKE_SYSTEM_PROMPT, INTAKE_USER_TEXT } from "@/lib/teaser-intake/prompt";

/** Pinned, and stored with the deal it produced (source_facts.teaser_intake.model). */
export const INTAKE_MODEL = "claude-opus-5";

/** A full IM with a long tenancy schedule fits comfortably; a runaway answer stops. */
const MAX_TOKENS = 16000;

/**
 * Two attempts must finish inside the route's five minutes, or the platform
 * ends the function before this code can say why: 2 x 130 s plus backoff.
 */
const TIMEOUT_MS = 130_000;
const MAX_RETRIES = 1;

/** Built once: the schema handed to the model. The answer is read by normaliseReading(), not by the SDK. */
const FORMAT = (() => { const { type, schema } = zodOutputFormat(TeaserExtractionSchema); return { type, schema }; })();

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
    throw new AppError("The reading service is not configured on this server, so the teaser was not read.");
  }
  const isImage = mediaType !== "application/pdf";

  const data = Buffer.from(bytes).toString("base64");
  const file: Anthropic.ContentBlockParam = isImage
    ? { type: "image", source: { type: "base64", media_type: mediaType, data } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data } };

  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES });

  let response: Anthropic.Message;
  try {
    // create(), not parse(): parse() throws a bare error on any answer that misses the schema
    // (a "Mixed-use" for "mixed use"), and that would lose the whole reading. The answer is
    // brought onto the schema below instead, and stop reasons are checked before it is read.
    response = await client.messages.create({
      model: INTAKE_MODEL,
      max_tokens: MAX_TOKENS,
      system: INTAKE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [file, { type: "text", text: INTAKE_USER_TEXT }] }],
      output_config: { format: FORMAT },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AppError("The reading service rejected this server's credentials, so the teaser was not read.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AppError("The reading service is busy. Wait a moment and try again.");
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      throw new AppError("Reading the teaser took too long. Try a shorter file (the teaser rather than the full IM).");
    }
    if (error instanceof Anthropic.BadRequestError) {
      throw new AppError(isImage
        ? "The reading service could not open this image. Try a smaller screenshot, or the PDF."
        : "The reading service could not open this file. It may be password-protected, scanned at very low quality, or over 100 pages.");
    }
    if (error instanceof Anthropic.AnthropicError) {
      throw new AppError("The reading service could not be reached, so the teaser was not read.");
    }
    throw error;
  }

  if (response.stop_reason === "refusal") throw new AppError("The reading service declined to read this file.");
  if (response.stop_reason === "max_tokens") throw new AppError("The reading did not finish within its limit. Try the teaser rather than the full IM.");

  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { raw = null; }
  const extraction = normaliseReading(raw);
  if (!extraction) throw new AppError("The reading came back in a form this system could not use. Try again.");
  return { model: response.model ?? INTAKE_MODEL, extraction };
}
