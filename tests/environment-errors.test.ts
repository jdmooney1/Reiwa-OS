// ============================================================================
// P6 — configuration, failure surfaces and OTP presentation.
// ----------------------------------------------------------------------------
// Three rules, each of which fails silently when it is broken, which is why
// each is pinned here rather than left to review:
//
//   * Configuration has no defaults. A fallback would let a misconfigured
//     deployment come up looking healthy and serve or write the wrong data.
//   * A failure tells the log everything and the screen nothing. A database
//     message is a map of the schema; a stack trace is a map of the code.
//   * The OTP length is a Supabase project setting, not a constant. A project
//     switched to 8 digits must not meet a UI that says "6-digit" or an input
//     that truncates.
// ============================================================================
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  REQUIRED_ENV, SERVER_ONLY_ENV, missingEnv, missingEnvMessage, requireEnvironment,
} from "@/lib/env";
import {
  AppError, NEUTRAL_MESSAGE, publicMessage, looksInternal, assertSafeForDisplay, reportError,
} from "@/lib/errors";

const run = promisify(execFile);
const SRC = join(process.cwd(), "src");

/**
 * The tsx CLI, invoked through this process's own `node` rather than `npx`.
 *
 * `npx` is `npx.cmd` on Windows, and since the argument-injection fix in Node
 * 18.20/20.12 `execFile` refuses to run a `.cmd` without `shell: true` — which
 * would mean quoting every argument through a shell for no benefit. Running the
 * CLI's entrypoint directly is portable, needs no shell, and spawns one fewer
 * process. What is under test is the script's refusal, not how it was launched.
 */
const TSX_CLI = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const runScript = (script: string, env: NodeJS.ProcessEnv) =>
  run(process.execPath, [TSX_CLI, script], { env });

interface SourceFile { file: string; text: string; code: string }

function collectSources(root: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const text = readFileSync(full, "utf8");
      out.push({
        file: full,
        text,
        // Comments stripped, so prose about a rule cannot trip the rule.
        code: text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
      });
    }
  };
  walk(root);
  return out;
}

const SOURCES = collectSources(SRC);
const CLIENT_FILES = SOURCES.filter((s) => /^\s*["']use client["']/.test(s.text));

// ============================================================================
describe("Configuration fails loudly and has no fallback", () => {
  it("requires exactly the four documented variables", () => {
    expect(Object.keys(REQUIRED_ENV).sort()).toEqual([
      "DATABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SECRET_KEY",
    ]);
  });

  it("reports every missing variable at once, not just the first", () => {
    const missing = missingEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" });
    expect(missing.sort()).toEqual([
      "DATABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
    ]);
    const message = missingEnvMessage(missing);
    for (const name of missing) expect(message).toContain(name);
    // ...and says what each one is for.
    expect(message).toContain("transaction pooler");
    expect(message).toContain("never expose to a client");
  });

  it("treats a blank variable as missing", () => {
    expect(missingEnv({ ...process.env, DATABASE_URL: "   " })).toContain("DATABASE_URL");
  });

  it("throws rather than continuing when configuration is incomplete", () => {
    expect(() => requireEnvironment({})).toThrow(/not configured/i);
    expect(() => requireEnvironment(process.env)).not.toThrow();
  });

  it("defines no default for any required variable", () => {
    // A `??` or `||` fallback on a required variable is the one line that turns
    // a misconfiguration into silently wrong data.
    const offenders = SOURCES.filter(({ code }) =>
      Object.keys(REQUIRED_ENV).some((name) =>
        new RegExp(`process\\.env\\.${name}\\s*(\\?\\?|\\|\\|)\\s*["'\`]`).test(code)));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("references the local test harness nowhere in the application", () => {
    // No harness fallback: src/ must not know the harness exists, so it can
    // never be reached other than by pointing the real variables at it.
    const offenders = SOURCES.filter(({ code }) =>
      /_local_shim|_local_otp|_local_refresh_tokens|local-auth|local-db|54321/.test(code));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("keeps .env.local out of version control", async () => {
    const ignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.env\*\.local$/m);
    const { stdout } = await run("git", ["check-ignore", "-v", ".env.local"]);
    expect(stdout).toContain(".env.local");
  });

  it("tracks no .env file in the repository", async () => {
    const { stdout } = await run("git", ["ls-files"]);
    const tracked = stdout.split("\n").filter((f) => /(^|\/)\.env($|\.)/.test(f));
    expect(tracked.filter((f) => !f.endsWith(".env.example"))).toEqual([]);
  });
});

// ============================================================================
describe("Server-only secrets stay on the server", () => {
  /** Every module a client component pulls in, transitively. */
  function clientImportGraph(): Set<string> {
    const seen = new Set<string>();
    const byPath = new Map(SOURCES.map((s) => [s.file, s]));

    const resolveImport = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/")
        ? join(SRC, spec.slice(2))
        : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
      if (!base) return null;
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
        if (byPath.has(candidate)) return candidate;
      }
      return null;
    };

    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = byPath.get(file);
      if (!source) return;
      // A "use server" module is a server boundary: the client gets an RPC stub,
      // not the module, so its own imports never reach the browser. Traversing
      // through one would flag every action file's data layer as client code.
      if (/^\s*["']use server["']/.test(source.text)) return;
      // Whole statements, not lines: an import clause routinely spans several
      // lines, and `import type { … }` over four lines is still erased.
      const statements = source.code.matchAll(
        /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\bfrom\s+["']([^"']+)["']/g);
      for (const [, clause, spec] of statements) {
        // `import type` is erased at compile time and emits nothing.
        if (/^\s*type\b/.test(clause)) continue;
        const target = resolveImport(file, spec);
        if (target) visit(target);
      }
    };

    for (const entry of CLIENT_FILES) visit(entry.file);
    return seen;
  }

  it("has client components to check", () => {
    expect(CLIENT_FILES.length).toBeGreaterThan(5);
  });

  /**
   * The walk below is only meaningful if it actually walks. A parser that
   * silently resolved nothing would make every assertion here pass, so this
   * pins a module that IS legitimately in the client bundle, reached through a
   * value import two levels down.
   */
  it("traverses real value imports, so a leak would actually be found", () => {
    const graph = clientImportGraph();
    expect(graph.size).toBeGreaterThan(CLIENT_FILES.length);
    expect(graph.has(join(SRC, "lib/documents/constraints.ts"))).toBe(true);
    expect(graph.has(join(SRC, "lib/portal-labels.ts"))).toBe(true);
  });

  it("reads no server-only variable from any client component", () => {
    const offenders = CLIENT_FILES.filter(({ code }) =>
      SERVER_ONLY_ENV.some((name) => code.includes(`process.env.${name}`)));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("reads no non-public environment variable from any client component", () => {
    // NODE_ENV is the one exception, and it is not a secret: Next inlines it at
    // build time, and it is the supported way to keep a development-only
    // affordance (the demonstration credentials on /sign-in) out of the
    // production bundle entirely rather than merely hidden with CSS.
    const ALLOWED = new Set(["NODE_ENV"]);
    const offenders: string[] = [];
    for (const { file, code } of CLIENT_FILES) {
      for (const match of code.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        const name = match[1];
        if (name.startsWith("NEXT_PUBLIC_") || ALLOWED.has(name)) continue;
        offenders.push(`${file}:${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The important one. A client component importing the database client, the
   * Supabase admin client or the storage module would pull the secret key (and
   * `pg`) into the browser bundle — the failure mode "use client" makes easy
   * and code review makes hard to spot.
   */
  it("pulls no server-only module into the client bundle, at any import depth", () => {
    const graph = clientImportGraph();
    const forbidden = [
      join(SRC, "lib/db/client.ts"),
      join(SRC, "lib/db/seed.ts"),
      join(SRC, "lib/db/reset.ts"),
      join(SRC, "lib/supabase/admin.ts"),
      join(SRC, "lib/supabase/server.ts"),
      join(SRC, "lib/supabase/investor-admin.ts"),
      join(SRC, "lib/documents/storage.ts"),
      join(SRC, "lib/documents/secure-delivery.ts"),
      join(SRC, "lib/auth/invite-session.ts"),
      join(SRC, "lib/data/investor-invites.ts"),
      join(SRC, "lib/data/portal-feed.ts"),
      join(SRC, "lib/errors.ts"),
    ];
    expect(forbidden.filter((f) => graph.has(f))).toEqual([]);
  });
});

// ============================================================================
describe("The local harness cannot be pointed at a real database", () => {
  const nonLocal = {
    ...process.env,
    DATABASE_URL:
      "postgresql://postgres.example:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
  };

  it("refuses to prepare a database that is not on localhost", async () => {
    await expect(runScript("scripts/local-db.ts", nonLocal))
      .rejects.toMatchObject({ code: 1 });
  }, 60_000);

  it("says exactly which host it refused", async () => {
    const result = await runScript("scripts/local-db.ts", nonLocal)
      .catch((e: { stderr: string }) => e);
    expect((result as { stderr: string }).stderr).toContain("LOCAL database only");
    expect((result as { stderr: string }).stderr).toContain("pooler.supabase.com");
  }, 60_000);

  it("refuses to serve auth for a database that is not on localhost", async () => {
    const result = await runScript("scripts/local-auth.ts", nonLocal)
      .catch((e: { stderr: string }) => e);
    expect((result as { stderr: string }).stderr).toContain("LOCAL database only");
  }, 60_000);
});

// ============================================================================
describe("Failures tell the log everything and the screen nothing", () => {
  it("shows the message of an error written for a person", () => {
    expect(publicMessage(new AppError("The file is larger than the 50 MB limit.")))
      .toBe("The file is larger than the 50 MB limit.");
  });

  it("collapses every other failure to a neutral sentence", () => {
    const pgError = Object.assign(
      new Error('duplicate key value violates unique constraint "investor_contacts_email_key"'),
      { code: "23505", table: "investor_contacts", constraint: "investor_contacts_email_key" });
    expect(publicMessage(pgError)).toBe(NEUTRAL_MESSAGE);
    expect(publicMessage(new Error("permission denied for table publication_documents")))
      .toBe(NEUTRAL_MESSAGE);
    expect(publicMessage("anything at all")).toBe(NEUTRAL_MESSAGE);
  });

  it("recognises a SQLSTATE, a stack frame, a table name and a uuid as internal", () => {
    expect(looksInternal("error 42501 while reading")).toBe(true);
    expect(looksInternal("at loadFeed (/app/src/lib/data/portal-feed.ts:42:11)")).toBe(true);
    expect(looksInternal("relation public.publication_documents does not exist")).toBe(true);
    expect(looksInternal("violates foreign key constraint")).toBe(true);
    expect(looksInternal("document 3f2504e0-4f89-41d3-9a0c-0305e82c3301 missing")).toBe(true);
    expect(looksInternal("The file is larger than the 50 MB limit.")).toBe(false);
  });

  it("downgrades a safe-looking message that turns out to carry internals", () => {
    expect(assertSafeForDisplay('duplicate key violates constraint "x"')).toBe(NEUTRAL_MESSAGE);
    expect(assertSafeForDisplay("Choose a file to upload.")).toBe("Choose a file to upload.");
  });

  it("logs the diagnostic detail and returns only a reference", () => {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    try {
      const pgError = Object.assign(new Error("permission denied for table investor_saved"), {
        code: "42501", table: "investor_saved", detail: "role authenticated",
      });
      const reported = reportError("portal.save", pgError, { publicationId: "abc" });

      expect(reported.message).toBe(NEUTRAL_MESSAGE);
      expect(reported.reference).toMatch(/^[0-9a-f]{8}$/);

      const flat = JSON.stringify(logged);
      // Everything an operator needs is in the log...
      expect(flat).toContain("portal.save");
      expect(flat).toContain("42501");
      expect(flat).toContain("investor_saved");
      expect(flat).toContain(reported.reference);
      // ...and none of it is in what gets displayed.
      expect(reported.message).not.toContain("42501");
      expect(reported.message).not.toContain("investor_saved");
    } finally {
      console.error = original;
    }
  });

  it("mounts an error boundary for staff, for investors and for the root", () => {
    for (const path of ["(app)/error.tsx", "(portal)/error.tsx", "global-error.tsx"]) {
      expect(() => readFileSync(join(SRC, "app", path), "utf8")).not.toThrow();
    }
  });

  it("renders no error message in any boundary — only the digest", () => {
    for (const path of ["(app)/error.tsx", "(portal)/error.tsx", "global-error.tsx"]) {
      const code = readFileSync(join(SRC, "app", path), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect({ path, rendersMessage: /\{\s*error\.message\s*\}/.test(code) })
        .toEqual({ path, rendersMessage: false });
      expect({ path, rendersStack: /error\.stack/.test(code) })
        .toEqual({ path, rendersStack: false });
      expect({ path, rendersDigest: /error\.digest/.test(code) })
        .toEqual({ path, rendersDigest: true });
    }
  });
});

// ============================================================================
describe("The OTP UI assumes no code length", () => {
  const verifyForm = readFileSync(join(SRC, "components/portal/verify-form.tsx"), "utf8");

  it("says nothing about six digits anywhere in the application", () => {
    const offenders = SOURCES.filter(({ code }) => /\b(six|6)[\s-]?digit/i.test(code));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("puts no length limit on the code input", () => {
    const code = verifyForm.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(code).not.toMatch(/maxLength/);
    expect(code).not.toMatch(/minLength/);
    expect(code).not.toMatch(/pattern\s*=/);
  });

  it("applies no client-side length check before submitting", () => {
    const offenders = SOURCES.filter(({ code }) =>
      /code\.length\s*[!=<>]==?\s*\d/.test(code));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("keeps the one-time-code affordances that do not assume a length", () => {
    expect(verifyForm).toMatch(/autoComplete="one-time-code"/);
    expect(verifyForm).toMatch(/inputMode="numeric"/);
  });

  it("normalises only whitespace before verifying", () => {
    const action = readFileSync(join(SRC, "app/actions/portal-access.ts"), "utf8");
    expect(action).toMatch(/formData\.get\("code"\).*\n?.*replace\(\/\\s\+\/g, ""\)/);
    expect(action).not.toMatch(/slice\(0,\s*\d\)/);
  });
});
