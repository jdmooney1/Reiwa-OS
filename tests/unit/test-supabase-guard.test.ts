// ============================================================================
// The Supabase isolation gate refuses. No Supabase project required, by design.
// ----------------------------------------------------------------------------
// These are the tests that would have caught the second half of the original
// defect. The database gate was correct and complete, and it made the whole
// arrangement look safe — while every Auth user the seeder created and every
// Storage object the suite uploaded went to the APPLICATION's project, because
// nothing had ever asked where those were going.
//
// Every case below asserts a REFUSAL. Two groups matter most:
//
//   * "never falls back" — the gate must refuse when the test variables are
//     absent even though the application's are present and perfectly usable.
//     Usable is not the same as permitted, and this is the exact substitution
//     that caused the problem.
//   * "before Auth Admin use" — the refusal must happen before an admin client
//     is built, which is checked with a recording fake that must never be
//     called.
//
// No live project, no network, no database.
// ============================================================================
import { describe, it, expect, afterEach } from "vitest";
import {
  checkTestSupabaseEnv, TestSupabaseRefusal, SUPABASE_REFUSAL,
  TEST_SUPABASE_URL, TEST_SUPABASE_PUBLISHABLE_KEY, TEST_SUPABASE_SECRET_KEY,
  type EnvSource,
} from "@/lib/db/test-supabase";
import {
  projectRefFromApiUrl, projectRefFromDatabaseUrl, projectRefFromKey, supabaseKeyFormat,
} from "@/lib/supabase/project-ref";
import {
  useSupabaseProject, clearDeclaredSupabaseProject, declaredSupabaseProject,
  supabaseUrl, supabasePublishableKey, supabaseSecretKey, optionalSupabaseSessionConfig,
} from "@/lib/supabase/env";

// Two projects that are unmistakably different, in every variable.
const APP_REF = "liveprojectref";
const TEST_REF = "testprojectref";

const APP = {
  url: `https://${APP_REF}.supabase.co`,
  publishable: "sb_publishable_liveliveliveliveliv",
  secret: "sb_secret_livelivelivelivelive",
  database: `postgresql://postgres.${APP_REF}:hunter2@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
};
const TEST = {
  url: `https://${TEST_REF}.supabase.co`,
  publishable: "sb_publishable_testtesttesttesttes",
  secret: "sb_secret_testtesttesttesttest",
  database: `postgresql://postgres.${TEST_REF}:swordfish@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
};

/** A legacy JWT key carrying a project ref, the way the old key format did. */
function legacyKey(ref: string, role: "anon" | "service_role"): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ ref, role })}.signature`;
}

/** A fully correct environment. Each test spoils exactly one thing. */
function goodEnv(over: EnvSource = {}): EnvSource {
  return {
    NEXT_PUBLIC_SUPABASE_URL: APP.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: APP.publishable,
    SUPABASE_SECRET_KEY: APP.secret,
    DATABASE_URL: APP.database,
    TEST_DATABASE_URL: TEST.database,
    [TEST_SUPABASE_URL]: TEST.url,
    [TEST_SUPABASE_PUBLISHABLE_KEY]: TEST.publishable,
    [TEST_SUPABASE_SECRET_KEY]: TEST.secret,
    ...over,
  };
}

/** Every secret in play, so a refusal can be checked for leaking one. */
const ALL_SECRETS = [APP.publishable, APP.secret, TEST.publishable, TEST.secret, "hunter2", "swordfish"];

function refusalFor(env: EnvSource): TestSupabaseRefusal {
  try {
    checkTestSupabaseEnv(env);
  } catch (e) {
    expect(e).toBeInstanceOf(TestSupabaseRefusal);
    return e as TestSupabaseRefusal;
  }
  throw new Error("expected a refusal, but the gate approved the environment");
}

afterEach(() => clearDeclaredSupabaseProject());

describe("a correctly configured test project", () => {
  it("is approved, and reports the ref all four variables agree on", () => {
    const project = checkTestSupabaseEnv(goodEnv());
    expect(project).toEqual({
      url: TEST.url,
      publishableKey: TEST.publishable,
      secretKey: TEST.secret,
      projectRef: TEST_REF,
    });
  });

  it("accepts legacy JWT keys whose ref claim matches the project", () => {
    const project = checkTestSupabaseEnv(goodEnv({
      [TEST_SUPABASE_PUBLISHABLE_KEY]: legacyKey(TEST_REF, "anon"),
      [TEST_SUPABASE_SECRET_KEY]: legacyKey(TEST_REF, "service_role"),
    }));
    expect(project.projectRef).toBe(TEST_REF);
  });

  it("does not mutate the environment it was given", () => {
    const env = goodEnv();
    const before = JSON.stringify(env);
    checkTestSupabaseEnv(env);
    expect(JSON.stringify(env)).toBe(before);
  });
});

describe("a missing test variable refuses, and never falls back", () => {
  for (const name of [TEST_SUPABASE_URL, TEST_SUPABASE_PUBLISHABLE_KEY, TEST_SUPABASE_SECRET_KEY]) {
    it(`${name} absent`, () => {
      const refusal = refusalFor(goodEnv({ [name]: undefined }));
      expect(refusal.message).toContain(SUPABASE_REFUSAL);
      expect(refusal.reason).toContain(name);
      expect(refusal.reason).toContain("never falls back");
    });

    it(`${name} blank`, () => {
      expect(refusalFor(goodEnv({ [name]: "   " })).reason).toContain(name);
    });
  }

  it("refuses with ALL test variables absent, even though the application's are complete", () => {
    // The whole defect in one assertion: the application's credentials are
    // present, valid and would work. That is not authorisation to use them.
    const refusal = refusalFor({
      NEXT_PUBLIC_SUPABASE_URL: APP.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: APP.publishable,
      SUPABASE_SECRET_KEY: APP.secret,
      DATABASE_URL: APP.database,
      TEST_DATABASE_URL: TEST.database,
    });
    expect(refusal.reason).toContain(TEST_SUPABASE_URL);
  });
});

describe("the application's own project is refused, however it is spelled", () => {
  it("refuses a test URL identical to the application URL", () => {
    expect(refusalFor(goodEnv({ [TEST_SUPABASE_URL]: APP.url })).reason)
      .toContain("identical to NEXT_PUBLIC_SUPABASE_URL");
  });

  it("refuses a test publishable key identical to the application's", () => {
    expect(refusalFor(goodEnv({ [TEST_SUPABASE_PUBLISHABLE_KEY]: APP.publishable })).reason)
      .toContain("identical to NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  it("refuses a test secret key identical to the application's", () => {
    expect(refusalFor(goodEnv({ [TEST_SUPABASE_SECRET_KEY]: APP.secret })).reason)
      .toContain("identical to SUPABASE_SECRET_KEY");
  });

  it("refuses the application's project written a different way", () => {
    // Same project, different string: a trailing slash defeats a naive equality
    // check, which is why the comparison is on refs.
    const refusal = refusalFor(goodEnv({
      [TEST_SUPABASE_URL]: `https://${APP_REF}.supabase.co/`,
      TEST_DATABASE_URL: APP.database,
    }));
    expect(refusal.reason).toContain("same project as NEXT_PUBLIC_SUPABASE_URL");
  });
});

describe("all four test variables must describe one project", () => {
  it("refuses when the test database belongs to a different project", () => {
    const otherRef = "thirdprojectref";
    const refusal = refusalFor(goodEnv({
      TEST_DATABASE_URL:
        `postgresql://postgres.${otherRef}:x@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
    }));
    expect(refusal.reason).toContain(TEST_REF);
    expect(refusal.reason).toContain(otherRef);
    expect(refusal.reason).toContain("one single dedicated test project");
  });

  it("refuses when TEST_DATABASE_URL is absent, so there is nothing to agree with", () => {
    expect(refusalFor(goodEnv({ TEST_DATABASE_URL: undefined })).reason)
      .toContain("TEST_DATABASE_URL is not set");
  });

  it("refuses a connection string carrying no project ref", () => {
    // A direct, non-pooler connection has a bare `postgres` username and cannot
    // identify its project. Guessing is not an option here.
    expect(refusalFor(goodEnv({
      TEST_DATABASE_URL: "postgresql://postgres:x@db.example.com:5432/postgres",
    })).reason).toContain("does not carry a Supabase project ref");
  });

  it("refuses a legacy JWT key belonging to another project", () => {
    expect(refusalFor(goodEnv({
      [TEST_SUPABASE_SECRET_KEY]: legacyKey(APP_REF, "service_role"),
    })).reason).toContain(`belongs to project "${APP_REF}"`);
  });

  it("refuses a URL that is not a hosted Supabase project", () => {
    expect(refusalFor(goodEnv({ [TEST_SUPABASE_URL]: "https://example.com" })).reason)
      .toContain("not a hosted Supabase project URL");
  });
});

describe("keys must be the right kind of key", () => {
  it("refuses a swapped pair", () => {
    expect(refusalFor(goodEnv({
      [TEST_SUPABASE_PUBLISHABLE_KEY]: TEST.secret,
      [TEST_SUPABASE_SECRET_KEY]: TEST.publishable,
    })).reason).toContain("swapped");
  });

  it("refuses a placeholder", () => {
    expect(refusalFor(goodEnv({ [TEST_SUPABASE_SECRET_KEY]: "<your-key-here>" })).reason)
      .toContain("not a recognisable Supabase key");
  });

  it("refuses the same value used for both", () => {
    // Legacy keys, because a modern pair cannot reach this check: both slots
    // carry their privilege in the prefix, so an identical modern pair is
    // caught as a swap first — which is the more specific complaint of the two.
    const same = legacyKey(TEST_REF, "anon");
    expect(refusalFor(goodEnv({
      [TEST_SUPABASE_PUBLISHABLE_KEY]: same,
      [TEST_SUPABASE_SECRET_KEY]: same,
    })).reason).toContain("same value");
  });
});

describe("a refusal never prints a secret", () => {
  const spoilers: Array<[string, EnvSource]> = [
    ["missing url", { [TEST_SUPABASE_URL]: undefined }],
    ["missing publishable", { [TEST_SUPABASE_PUBLISHABLE_KEY]: undefined }],
    ["missing secret", { [TEST_SUPABASE_SECRET_KEY]: undefined }],
    ["borrowed secret", { [TEST_SUPABASE_SECRET_KEY]: APP.secret }],
    ["swapped keys", {
      [TEST_SUPABASE_PUBLISHABLE_KEY]: TEST.secret,
      [TEST_SUPABASE_SECRET_KEY]: TEST.publishable,
    }],
    ["mismatched database", {
      TEST_DATABASE_URL:
        "postgresql://postgres.thirdprojectref:x@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
    }],
  ];

  for (const [name, over] of spoilers) {
    it(name, () => {
      const message = refusalFor(goodEnv(over)).message;
      for (const secret of ALL_SECRETS) {
        expect(message, `refusal leaked ${secret.slice(0, 12)}…`).not.toContain(secret);
      }
    });
  }
});

describe("the refusal happens BEFORE an Auth Admin client exists", () => {
  /**
   * The gate, followed by the thing it guards. The fake stands in for
   * createSupabaseAdminClient(): if it is ever reached with a bad environment,
   * a real one would have been built with real credentials and the next call
   * would have created a user somewhere.
   */
  function provisionBehindGate(env: EnvSource, createAdmin: () => void): void {
    checkTestSupabaseEnv(env);
    createAdmin();
  }

  const badEnvironments: Array<[string, EnvSource]> = [
    ["no test secret key", goodEnv({ [TEST_SUPABASE_SECRET_KEY]: undefined })],
    ["no test url", goodEnv({ [TEST_SUPABASE_URL]: undefined })],
    ["no test variables at all", { DATABASE_URL: APP.database, SUPABASE_SECRET_KEY: APP.secret }],
    ["the application's project", goodEnv({ [TEST_SUPABASE_URL]: APP.url })],
    ["a project mismatch", goodEnv({ TEST_DATABASE_URL: APP.database })],
  ];

  for (const [name, env] of badEnvironments) {
    it(`builds no admin client: ${name}`, () => {
      let built = 0;
      expect(() => provisionBehindGate(env, () => { built += 1; })).toThrow(SUPABASE_REFUSAL);
      expect(built, "an Auth Admin client was built despite the refusal").toBe(0);
    });
  }
});

describe("the application's own configuration is untouched", () => {
  it("resolves from the environment when no project has been declared", () => {
    expect(declaredSupabaseProject()).toBeNull();
    const saved = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      secret: process.env.SUPABASE_SECRET_KEY,
    };
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = APP.url;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = APP.publishable;
      process.env.SUPABASE_SECRET_KEY = APP.secret;
      expect(supabaseUrl()).toBe(APP.url);
      expect(supabasePublishableKey()).toBe(APP.publishable);
      expect(supabaseSecretKey()).toBe(APP.secret);
      expect(optionalSupabaseSessionConfig()).toEqual({ url: APP.url, key: APP.publishable });
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.key;
      process.env.SUPABASE_SECRET_KEY = saved.secret;
    }
  });

  it("declaring the test project does not rewrite the application's variables", () => {
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = APP.url;
      const project = checkTestSupabaseEnv(goodEnv());
      useSupabaseProject(project, "a unit test");

      // Clients follow the declaration...
      expect(supabaseUrl()).toBe(TEST.url);
      expect(supabaseSecretKey()).toBe(TEST.secret);
      // ...and NEXT_PUBLIC_SUPABASE_URL still means what it always meant, which
      // is what keeps "is the test project the application project?" answerable.
      expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe(APP.url);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
    }
  });

  it("refuses a second, different declaration rather than picking one", () => {
    useSupabaseProject(
      { url: TEST.url, publishableKey: TEST.publishable, secretKey: TEST.secret }, "first");
    // The same declaration again is fine: every Vitest worker arms the same one.
    expect(() => useSupabaseProject(
      { url: TEST.url, publishableKey: TEST.publishable, secretKey: TEST.secret }, "second"),
    ).not.toThrow();
    // A different one is not.
    expect(() => useSupabaseProject(
      { url: APP.url, publishableKey: APP.publishable, secretKey: APP.secret }, "third"),
    ).toThrow(/already declared by first/);
  });
});

describe("project refs are read, not guessed", () => {
  it("reads a ref from an API URL", () => {
    expect(projectRefFromApiUrl(TEST.url)).toBe(TEST_REF);
    expect(projectRefFromApiUrl("https://example.com")).toBeNull();
    expect(projectRefFromApiUrl("not a url")).toBeNull();
    expect(projectRefFromApiUrl(undefined)).toBeNull();
  });

  it("reads a ref from a pooler connection string", () => {
    expect(projectRefFromDatabaseUrl(TEST.database)).toBe(TEST_REF);
    expect(projectRefFromDatabaseUrl("postgresql://postgres:x@db.example.com:5432/postgres"))
      .toBeNull();
  });

  it("reads a ref from a legacy JWT and finds none in a modern key", () => {
    expect(projectRefFromKey(legacyKey(TEST_REF, "anon"))).toBe(TEST_REF);
    // The honest half: a modern key carries no ref, and this must say so rather
    // than invent one. The gate is built around that being true.
    expect(projectRefFromKey(TEST.publishable)).toBeNull();
    expect(projectRefFromKey(TEST.secret)).toBeNull();
  });

  it("classifies key formats", () => {
    expect(supabaseKeyFormat(TEST.publishable)).toBe("publishable");
    expect(supabaseKeyFormat(TEST.secret)).toBe("secret");
    expect(supabaseKeyFormat(legacyKey(TEST_REF, "anon"))).toBe("legacy-jwt");
    expect(supabaseKeyFormat("nonsense")).toBe("unrecognised");
  });
});
