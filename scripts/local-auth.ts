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
//   POST /auth/v1/admin/generate_link              real OTP for a test (P3)
//
// It also stands in for Supabase Storage, so the private-bucket document path
// (P6) is exercised end to end rather than mocked:
//
//   POST   /storage/v1/bucket                      create a bucket
//   GET    /storage/v1/bucket/:id                  read one
//   POST   /storage/v1/object/:bucket/*            upload an object
//   POST   /storage/v1/object/sign/:bucket/*       mint a signed URL
//   GET    /storage/v1/object/sign/:bucket/*       redeem one (expiry enforced)
//   GET    /storage/v1/object/public/:bucket/*     refused for a private bucket
//   DELETE /storage/v1/object/:bucket              remove objects by path
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
// A Supabase project's email OTP length is a project setting: 6 by default, but
// 8 (or more) once an operator raises it. The application must never assume one,
// so the harness mints whatever length LOCAL_AUTH_OTP_DIGITS asks for.
const OTP_DIGITS = Math.max(4, Math.min(10, Number(process.env.LOCAL_AUTH_OTP_DIGITS ?? 6)));

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const b64url = (b: Buffer): string => b.toString("base64url");

/** A numeric OTP of the project's configured length, mirroring GoTrue. */
function mintOtp(): string {
  let code = "";
  for (let i = 0; i < OTP_DIGITS; i += 1) code += String(Math.floor(Math.random() * 10));
  return code;
}

/** Store (or replace) the pending OTP for an email, as GoTrue would on send. */
async function storeOtp(email: string, code: string): Promise<void> {
  await getPool().query(
    `insert into auth._local_otp(email, code, expires_at)
     values (lower($1), $2, now() + interval '10 minutes')
     on conflict (email) do update set code = excluded.code,
       expires_at = excluded.expires_at, created_at = now()`,
    [email, code],
  );
}

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

// ---- Storage stand-in ------------------------------------------------------

/** Raw request body, for object uploads (which are not JSON). */
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** A signature over exactly what the URL grants, and until when. */
function signObject(bucket: string, path: string, expiresAt: number): string {
  return createHmac("sha256", JWT_SECRET).update(`${bucket}:${path}:${expiresAt}`).digest("hex");
}

async function handleStorage(
  req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string,
): Promise<boolean> {
  const pool = getPool();

  // ---- Buckets ------------------------------------------------------------
  if (path === "/storage/v1/bucket" && method === "POST") {
    const body = await readJson(req);
    const id = String(body.id ?? body.name ?? "").trim();
    if (!id) return send(res, 400, { message: "bucket id is required" }), true;
    await pool.query(
      `insert into storage._local_buckets(id, name, public, file_size_limit, allowed_mime_types)
       values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
      [id, String(body.name ?? id), body.public === true,
       body.file_size_limit ?? null, (body.allowed_mime_types as string[]) ?? null]);
    return send(res, 200, { name: id }), true;
  }

  const bucketGet = path.match(/^\/storage\/v1\/bucket\/([^/]+)$/);
  if (bucketGet && method === "GET") {
    const { rows } = await pool.query(
      "select id, name, public, created_at from storage._local_buckets where id = $1",
      [decodeURIComponent(bucketGet[1])]);
    if (!rows[0]) return send(res, 404, { message: "Bucket not found" }), true;
    return send(res, 200, rows[0]), true;
  }

  // ---- Sign (mint) --------------------------------------------------------
  const sign = path.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
  if (sign && method === "POST") {
    const bucket = decodeURIComponent(sign[1]);
    const objectPath = decodeURIComponent(sign[2]);
    const body = await readJson(req);
    const { rows } = await pool.query(
      "select 1 from storage._local_objects where bucket_id = $1 and path = $2",
      [bucket, objectPath]);
    if (!rows[0]) return send(res, 404, { message: "Object not found" }), true;
    const expiresAt = Math.floor(Date.now() / 1000) + Number(body.expiresIn ?? 60);
    const token = `${expiresAt}.${signObject(bucket, objectPath, expiresAt)}`;
    // GoTrue's storage API returns a RELATIVE url; storage-js prefixes it.
    return send(res, 200, {
      signedURL: `/object/sign/${bucket}/${encodeURI(objectPath)}?token=${token}`,
    }), true;
  }

  // ---- Sign (redeem) ------------------------------------------------------
  if (sign && method === "GET") {
    const bucket = decodeURIComponent(sign[1]);
    const objectPath = decodeURIComponent(sign[2]);
    const [expiryRaw, signature] = String(url.searchParams.get("token") ?? "").split(".");
    const expiresAt = Number(expiryRaw);
    if (!signature || !Number.isFinite(expiresAt)) {
      return send(res, 400, { message: "Invalid token" }), true;
    }
    if (signature !== signObject(bucket, objectPath, expiresAt)) {
      return send(res, 403, { message: "Invalid signature" }), true;
    }
    if (expiresAt < Date.now() / 1000) {
      return send(res, 400, { message: "Expired signature" }), true;
    }
    const { rows } = await pool.query<{ content: Buffer; mime_type: string | null }>(
      "select content, mime_type from storage._local_objects where bucket_id = $1 and path = $2",
      [bucket, objectPath]);
    if (!rows[0]) return send(res, 404, { message: "Object not found" }), true;
    const download = url.searchParams.get("download");
    res.writeHead(200, {
      "content-type": rows[0].mime_type ?? "application/octet-stream",
      "content-length": rows[0].content.length,
      ...(download ? { "content-disposition": `attachment; filename="${download}"` } : {}),
    });
    res.end(rows[0].content);
    return true;
  }

  // ---- Public URL: never valid for a private bucket ------------------------
  const publicGet = path.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (publicGet && method === "GET") {
    const { rows } = await pool.query<{ public: boolean }>(
      "select public from storage._local_buckets where id = $1", [decodeURIComponent(publicGet[1])]);
    if (!rows[0]?.public) return send(res, 400, { message: "Bucket not found" }), true;
    return send(res, 404, { message: "Object not found" }), true;
  }

  // ---- Remove -------------------------------------------------------------
  const objectBucket = path.match(/^\/storage\/v1\/object\/([^/]+)$/);
  if (objectBucket && method === "DELETE") {
    const body = await readJson(req);
    const prefixes = Array.isArray(body.prefixes) ? body.prefixes.map(String) : [];
    await pool.query(
      "delete from storage._local_objects where bucket_id = $1 and path = any($2::text[])",
      [decodeURIComponent(objectBucket[1]), prefixes]);
    return send(res, 200, prefixes.map((p) => ({ name: p }))), true;
  }

  // ---- Upload -------------------------------------------------------------
  const upload = path.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
  if (upload && method === "POST") {
    const bucket = decodeURIComponent(upload[1]);
    const objectPath = decodeURIComponent(upload[2]);
    const { rows } = await pool.query("select 1 from storage._local_buckets where id = $1", [bucket]);
    if (!rows[0]) return send(res, 404, { message: "Bucket not found" }), true;
    const content = await readBody(req);
    const mime = String(req.headers["content-type"] ?? "application/octet-stream");
    const upsert = String(req.headers["x-upsert"] ?? "false") === "true";
    const { rowCount } = await pool.query(
      upsert
        ? `insert into storage._local_objects(bucket_id, path, mime_type, content)
           values ($1,$2,$3,$4)
           on conflict (bucket_id, path) do update set content = excluded.content,
             mime_type = excluded.mime_type`
        : `insert into storage._local_objects(bucket_id, path, mime_type, content)
           values ($1,$2,$3,$4) on conflict (bucket_id, path) do nothing`,
      [bucket, objectPath, mime, content]);
    if (!rowCount) {
      return send(res, 409, { message: "The resource already exists" }), true;
    }
    return send(res, 200, { Key: `${bucket}/${objectPath}`, Id: objectPath }), true;
  }

  return false;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method ?? "GET";

  if (path.startsWith("/storage/v1/")) {
    if (await handleStorage(req, res, url, path, method)) return;
    return send(res, 404, { message: `No storage route for ${method} ${path}` });
  }

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
    await storeOtp(email, mintOtp());
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
  // GoTrue's supported way to obtain the plaintext OTP a project would have
  // emailed: it mints the code, returns it over the service-role connection and
  // sends no mail. Hosted Supabase stores only a hash, so this is the only way a
  // test can redeem a genuine code through the public verify path.
  if (path === "/auth/v1/admin/generate_link" && method === "POST") {
    const body = await readJson(req);
    const email = String(body.email ?? "").trim();
    const type = String(body.type ?? "magiclink");
    if (!email) return send(res, 422, { code: 422, msg: "email is required" });
    if (!["magiclink", "signup", "invite", "recovery"].includes(type)) {
      return send(res, 400, { code: 400, msg: `Unsupported generate_link type ${type}` });
    }
    const user = await userByEmail(email);
    // magiclink is a link for an EXISTING user; GoTrue refuses an unknown one.
    if (!user) {
      return send(res, 422, { code: 422, error_code: "user_not_found", msg: "User not found" });
    }
    const code = mintOtp();
    await storeOtp(email, code);
    const hashedToken = sha256(code);
    const redirectTo = String(body.redirect_to ?? body.redirectTo ?? "");
    // GoTrue answers with a FLAT object; supabase-js splits the link properties
    // out of it into `data.properties` and the remainder into `data.user`.
    return send(res, 200, {
      ...userJson(user),
      action_link:
        `http://127.0.0.1:${PORT}/auth/v1/verify?token=${hashedToken}` +
        `&type=${type}&redirect_to=${encodeURIComponent(redirectTo)}`,
      email_otp: code,
      hashed_token: hashedToken,
      redirect_to: redirectTo,
      verification_type: type,
    });
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
