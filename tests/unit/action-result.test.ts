// ============================================================================
// A refusal you can act on stays on the screen. A fault still goes to the
// boundary.
// ----------------------------------------------------------------------------
// The defect this protects: every workspace write threw, so an oversized
// upload, a duplicate click or a missing title replaced the investment file
// with "This screen could not be loaded" — and the message written for that
// exact case was never shown to anybody.
//
// No database: the classification is a property of the error, not of the query.
// ============================================================================
import { describe, it, expect, vi, afterEach } from "vitest";
import { runAction } from "@/lib/actions/run-action";
import { ACTION_IDLE } from "@/lib/actions/result";
import { AppError, NEUTRAL_MESSAGE } from "@/lib/errors";

/** A pg error, in the shape node-postgres actually produces. */
function pgError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** Next signals redirect()/notFound() by throwing an error with a digest. */
function nextControlFlow(digest: string): Error & { digest: string } {
  return Object.assign(new Error(digest), { digest });
}

afterEach(() => vi.restoreAllMocks());

const silenceLog = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("A recoverable error stays local", () => {
  it("returns the AppError's own message rather than throwing", async () => {
    const result = await runAction("test.upload", {}, async () => {
      throw new AppError("The file is larger than the 50 MB limit.");
    });
    expect(result).toEqual({ error: "The file is larger than the 50 MB limit." });
  });

  it("carries a duplicate-action message back to the screen", async () => {
    // The exact case from the audit: clicking "Raise risk" twice.
    const result = await runAction("test.promote", {}, async () => {
      throw new AppError("This finding has already been promoted to a risk.");
    });
    expect(result.error).toBe("This finding has already been promoted to a risk.");
  });

  it("does not log a user error as a fault", async () => {
    const log = silenceLog();
    await runAction("test.validate", {}, async () => { throw new AppError("A risk needs a title."); });
    expect(log).not.toHaveBeenCalled();
  });

  it("reports success plainly", async () => {
    expect(await runAction("test.ok", {}, async () => {})).toEqual({ ok: true });
  });

  it("starts idle, which is neither ok nor an error", async () => {
    expect(ACTION_IDLE.ok).toBeUndefined();
    expect(ACTION_IDLE.error).toBeUndefined();
  });
});

describe("A rule the database refused stays local, in our words", () => {
  const immutable = () => pgError(
    "P0001",
    // What the trigger actually raises — note the row id in it.
    "Approved investment case 3f1b8c2a-0000-4000-8000-0000000000aa is immutable");

  it("shows the caller's sentence for an invalid underwriting transition", async () => {
    const log = silenceLog();
    const result = await runAction("test.underwriting", {}, async () => { throw immutable(); }, {
      ruleMessage: "Approved underwriting cannot be edited. Create the next version instead.",
    });
    expect(result.error).toBe("Approved underwriting cannot be edited. Create the next version instead.");
    // Still logged: knowing which rule fires is how you learn the screen is
    // offering something it should not.
    expect(log).toHaveBeenCalled();
  });

  it("never leaks the trigger's own text, which names a real row", async () => {
    silenceLog();
    const result = await runAction("test.underwriting", {}, async () => { throw immutable(); }, {
      ruleMessage: "Approved underwriting cannot be edited.",
    });
    expect(result.error).not.toMatch(/3f1b8c2a/);
    expect(result.error).not.toMatch(/investment case/i);
  });

  it("falls back to the neutral sentence if a caller writes an unsafe message", async () => {
    silenceLog();
    const result = await runAction("test.underwriting", {}, async () => { throw immutable(); }, {
      // Somebody pastes the database's message in as the "friendly" one.
      ruleMessage: "public.investment_cases violates constraint",
    });
    expect(result.error).toBe(NEUTRAL_MESSAGE);
  });

  it("treats an unanticipated rule as a fault, because it is news", async () => {
    silenceLog();
    // Same P0001, but the caller supplied no sentence for it.
    await expect(runAction("test.underwriting", {}, async () => { throw immutable(); }))
      .rejects.toThrow(/immutable/);
  });
});

describe("An unexpected error remains exceptional", () => {
  it("rethrows so the route boundary still handles it", async () => {
    silenceLog();
    const boom = pgError("42501", "permission denied for table opportunity_documents");
    await expect(runAction("test.write", {}, async () => { throw boom; })).rejects.toBe(boom);
  });

  it("logs it with the scope and context first", async () => {
    const log = silenceLog();
    await expect(runAction("workspace.document.upload", { opportunityId: "opp-1" }, async () => {
      throw new Error("connection terminated unexpectedly");
    })).rejects.toThrow();

    expect(log).toHaveBeenCalled();
    const [line, context] = log.mock.calls[0];
    expect(String(line)).toContain("workspace.document.upload");
    expect(context).toMatchObject({ opportunityId: "opp-1" });
  });

  it("does not turn a plain Error into a displayed message", async () => {
    silenceLog();
    // A domain error that was never marked as person-readable must not be shown
    // on the off-chance: that is how a schema detail reaches a screenshot.
    await expect(runAction("test.write", {}, async () => {
      throw new Error("duplicate key value violates unique constraint");
    })).rejects.toThrow();
  });
});

describe("Framework navigation is not a failure", () => {
  it("lets redirect() through untouched and unlogged", async () => {
    const log = silenceLog();
    const redirect = nextControlFlow("NEXT_REDIRECT;replace;/admin/publications/1;307;");
    await expect(runAction("test.prepare", {}, async () => { throw redirect; }))
      .rejects.toBe(redirect);
    expect(log).not.toHaveBeenCalled();
  });

  it("lets notFound() through untouched", async () => {
    const log = silenceLog();
    const missing = nextControlFlow("NEXT_NOT_FOUND");
    await expect(runAction("test.open", {}, async () => { throw missing; })).rejects.toBe(missing);
    expect(log).not.toHaveBeenCalled();
  });
});
