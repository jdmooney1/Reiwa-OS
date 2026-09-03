// ============================================================================
// Local Auth server — a minimal GoTrue-compatible stand-in for environments
// that cannot reach the hosted Supabase project (see scripts/local-db.ts).
// ----------------------------------------------------------------------------
// Serves just the endpoints the application and the seed actually use, over the
// local `auth.users` table the shim creates:
//
//   POST /auth/v1/token?grant_type=password        sign-in (app + tests)
//   POST /auth/v1/token?grant_type=refresh_token   session refresh (middleware)
//   POST /auth/v1/otp                              email OTP request (P3);
//                                                  honours create_user=false
//   POST /auth/v1/verify                           email OTP verification (P3)
//   GET  /auth/v1/user                             token verification
//   POST /auth/v1/logout                           sign-out
//   GET  /auth/v1/admin/users                      seed: find user by email
//   POST /auth/v1/admin/users                      seed: provision user
//   DELETE /auth/v1/admin/users/:id                dev tidy-up
//
// OTP codes are not emailed locally — they are written to auth._local_otp so a
// developer or a test on the privileged connection can read what "was sent".
//
// DEVELOPMENT ONLY. Binds to 127.0.0.1, signs demo JWTs with a local secret and
// refuses to start unless the database carries the auth._local_shim marker, so
// it can never front a real Supabase project. Nothing in the application is
// aware of it — the app speaks ordinary Supabase Auth HTTP.
//
// Usage:
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres?sslmode=disable \
//     npx tsx scripts/local-auth.ts        # listens on 127.0.0.1:54321
// then point NEXT_PUBLIC_SUPABASE_URL at http://127.0.0.1:54321.
// ============================================================================
import "./env";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getPool } from "@/lib/db/client";

const PORT = Number(process.env.LOCAL_AUTH_PORT ?? 54321);
const JWT_SECRET = process.env.LOCAL_AUTH_JWT_SECRET ?? "reiwa-local-dev-jwt-secret";
const TOKEN_TTL_SECONDS = 3600;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const b64url = (b: Buffer): string => b.toString("base64url");

interface UserRow {
  id: string;
  email: string | null;
  password_sha256: string | null;
  user_metadata: Record<string, unknown>;
  created_at: string;
}

function userJson(u: UserRow): Record<string, unknown> {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.created_at,
    confirmed_at: u.created_at,
    last_sign_in_at: u.created_at,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: u.user_metadata ?? {},
    identities: [],
    created_at: u.created_at,
    updated_at: u.created_at,
  };
}

function signJwt(u: UserRow): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TOKEN_TTL_SECONDS;
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify({
    sub: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    iat: now, exp: expiresAt, session_id: randomUUID(), app_metadata: {}, user_metadata: u.user_metadata ?? {},
  })));
  const sig = b64url(createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest());
  return { token: `${header}.${payload}.${sig}`, expiresAt };
}

function verifyJwt(token: string): { sub: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const sig = b64url(createHmac("sha256", JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest());
  if (sig !== parts[2]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof payload.sub !== "string") return null;
    if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

async function sessionResponse(u: UserRow): Promise<Record<string, unknown>> {
  const { token, expiresAt } = signJwt(u);
  const refreshToken = randomUUID().replace(/-/g, "");
  await getPool().query(
    "insert into auth._local_refresh_tokens(token, user_id) values ($1, $2)", [refreshToken, u.id]);
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: TOKEN_TTL_SECONDS,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    user: userJson(u),
  };
}

async function userById(id: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>("select * from auth.users where id = $1", [id]);
  return rows[0] ?? null;
}

async function userByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>(
    "select * from auth.users where lower(email) = lower($1)", [email.trim()]);
  return rows[0] ?? null;
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method ?? "GET";

  // ---- Health -----------------------------------------------------------
  if (path === "/auth/v1/health") return send(res, 200, { name: "local-auth", description: "dev stand-in" });

  // ---- Sign-in / refresh -------------------------------------------------
  if (method === "POST" && path === "/auth/v1/token") {
    const grant = url.searchParams.get("grant_type");
    const body = await readJson(req);
    if (grant === "password") {
      const email = String(body.email ?? "");
      const password = String(body.password ?? "");
      const user = await userByEmail(email);
      if (!user || !user.password_sha256 || user.password_sha256 !== sha256(password)) {
        return send(res, 400, {
          code: 400, error_code: "invalid_credentials",
          error: "invalid_grant", error_description: "Invalid login credentials",
          msg: "Invalid login credentials",
        });
      }
      return send(res, 200, await sessionResponse(user));
    }
    if (grant === "refresh_token") {
      const token = String(body.refresh_token ?? "");
      const { rows } = await getPool().query<{ user_id: string }>(
        "delete from auth._local_refresh_tokens where token = $1 returning user_id", [token]);
      const user = rows[0] ? await userById(rows[0].user_id) : null;
      if (!user) {
        return send(res, 400, {
          code: 400, error_code: "refresh_token_not_found",
          error: "invalid_grant", error_description: "Invalid Refresh Token",
          msg: "Invalid Refresh Token",
        });
      }
      return send(res, 200, await sessionResponse(user));
    }
    return send(res, 400, { error: "unsupported_grant_type", msg: `Unsupported grant_type ${grant}` });
  }

  // ---- Email OTP (P3) -----------------------------------------------------
  if (method === "POST" && path === "/auth/v1/otp") {
    const body = await readJson(req);
    const email = String(body.email ?? "").trim();
    if (!email) return send(res, 422, { code: 422, msg: "email is required" });
    const user = await userByEmail(email);
    // GoTrue semantics: with create_user=false an unknown email is refused and
    // no Auth user is ever created.
    if (!user) {
      if (body.create_user === false) {
        return send(res, 422, {
          code: 422, error_code: "otp_disabled", msg: "Signups not allowed for otp",
        });
      }
      return send(res, 422, { code: 422, error_code: "signup_disabled", msg: "Signups not allowed" });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await getPool().query(
      `insert into auth._local_otp(email, code, expires_at)
       values (lower($1), $2, now() + interval '10 minutes')
       on conflict (email) do update set code = excluded.code,
         expires_at = excluded.expires_at, created_at = now()`,
      [email, code]);
    return send(res, 200, {});
  }

  if (method === "POST" && path === "/auth/v1/verify") {
    const body = await readJson(req);
    const email = String(body.email ?? "").trim();
    const token = String(body.token ?? "").trim();
    const type = String(body.type ?? "");
    if (!["email", "magiclink", "signup"].includes(type)) {
      return send(res, 400, { code: 400, msg: `Unsupported verify type ${type}` });
    }
    const { rows } = await getPool().query<{ email: string }>(
      `delete from auth._local_otp
        where email = lower($1) and code = $2 and expires_at > now()
        returning email`,
      [email, token]);
    const user = rows[0] ? await userByEmail(email) : null;
    if (!user) {
      return send(res, 403, {
        code: 403, error_code: "otp_expired",
        msg: "Token has expired or is invalid",
      });
    }
    return send(res, 200, await sessionResponse(user));
  }

  // ---- Token verification ------------------------------------------------
  if (method === "GET" && path === "/auth/v1/user") {
    const auth = String(req.headers.authorization ?? "");
    const claims = auth.startsWith("Bearer ") ? verifyJwt(auth.slice(7)) : null;
    const user = claims ? await userById(claims.sub) : null;
    if (!user) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    return send(res, 200, userJson(user));
  }

  if (method === "POST" && path === "/auth/v1/logout") return send(res, 204);

  // ---- Admin API (used by the seed) --------------------------------------
  if (path === "/auth/v1/admin/users" && method === "GET") {
    const page = Number(url.searchParams.get("page") ?? 1);
    const perPage = Number(url.searchParams.get("per_page") ?? 50);
    const { rows } = await getPool().query<UserRow>(
      "select * from auth.users order by created_at, id limit $1 offset $2",
      [perPage, (page - 1) * perPage]);
    return send(res, 200, { users: rows.map(userJson), aud: "authenticated" });
  }
  if (path === "/auth/v1/admin/users" && method === "POST") {
    const body = await readJson(req);
    const email = String(body.email ?? "").trim();
    if (!email) return send(res, 422, { code: 422, msg: "email is required" });
    if (await userByEmail(email)) {
      return send(res, 422, { code: 422, error_code: "email_exists", msg: "Email address already registered" });
    }
    const { rows } = await getPool().query<UserRow>(
      `insert into auth.users(email, password_sha256, user_metadata)
       values ($1, $2, $3) returning *`,
      [email, body.password ? sha256(String(body.password)) : null,
       JSON.stringify(body.user_metadata ?? {})]);
    return send(res, 200, userJson(rows[0]));
  }
  const adminUser = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
  if (adminUser && method === "DELETE") {
    await getPool().query("delete from auth.users where id = $1", [adminUser[1]]);
    return send(res, 200, {});
  }

  send(res, 404, { code: 404, msg: `No route for ${method} ${path}` });
}

async function main(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`scripts/local-auth.ts serves a LOCAL database only; DATABASE_URL points at ${url.hostname}`);
  }
  const { rows } = await getPool().query(
    "select 1 from pg_tables where schemaname = 'auth' and tablename = '_local_shim'");
  if (!rows[0]) {
    throw new Error("Local shim not found — run scripts/local-db.ts first.");
  }
  createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error("[local-auth]", e instanceof Error ? e.message : e);
      send(res, 500, { code: 500, msg: "internal error" });
    });
  }).listen(PORT, "127.0.0.1", () => {
    console.log(`[local-auth] GoTrue stand-in listening on http://127.0.0.1:${PORT}`);
  });
}

main().catch((e) => {
  console.error("[local-auth] failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
