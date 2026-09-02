// ============================================================================
// LOCAL DEV/TEST ONLY — GoTrue-compatible auth stub.
// ----------------------------------------------------------------------------
// Emulates the small slice of Supabase Auth's HTTP API the app uses
// (password grant, refresh, /user, /logout) against the local auth shim's
// auth.users table, so the REAL @supabase/ssr runtime code path can be
// exercised without network access to a hosted Supabase project.
// Never deployed; not part of the application runtime.
//
//   DATABASE_URL=postgres://... node scripts/dev-auth-stub.mjs
//
// Point NEXT_PUBLIC_SUPABASE_URL at http://127.0.0.1:9999 for local dev.
// ============================================================================
import http from "node:http";
import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import pg from "pg";

const PORT = Number(process.env.AUTH_STUB_PORT || 9999);
const SECRET = new TextEncoder().encode(
  process.env.SUPABASE_JWT_SECRET ||
  "super-secret-jwt-token-with-at-least-32-characters-long");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function findUser(where, params) {
  const { rows } = await pool.query(`select * from auth.users where ${where}`, params);
  return rows[0] ?? null;
}

function userJson(u) {
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    email_confirmed_at: u.email_confirmed_at, phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: u.raw_user_meta_data ?? {},
    created_at: u.created_at, updated_at: u.updated_at,
  };
}

async function issueTokens(u) {
  const expiresIn = 3600;
  const access_token = await new SignJWT({
    sub: u.id, email: u.email, role: "authenticated", aud: "authenticated",
    session_id: randomUUID(), app_metadata: { provider: "email" }, user_metadata: u.raw_user_meta_data ?? {},
  }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt().setExpirationTime(`${expiresIn}s`).sign(SECRET);
  return {
    access_token, token_type: "bearer", expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: Buffer.from(u.id).toString("base64url"),
    user: userJson(u),
  };
}

function send(res, status, body) {
  const data = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === "POST" && url.pathname === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      const body = await readBody(req);
      if (grant === "password") {
        const u = await findUser("lower(email) = lower($1)", [String(body.email || "")]);
        if (!u) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
        const ok = (await pool.query(
          "select (encrypted_password = crypt($1, encrypted_password)) as ok from auth.users where id = $2",
          [String(body.password || ""), u.id])).rows[0]?.ok === true;
        if (!ok) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
        return send(res, 200, await issueTokens(u));
      }
      if (grant === "refresh_token") {
        let id = "";
        try { id = Buffer.from(String(body.refresh_token || ""), "base64url").toString("utf8"); } catch { /* fallthrough */ }
        const u = id ? await findUser("id = $1", [id]) : null;
        if (!u) return send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
        return send(res, 200, await issueTokens(u));
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }

    if (req.method === "GET" && url.pathname === "/auth/v1/user") {
      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      try {
        const { payload } = await jwtVerify(token, SECRET);
        const u = await findUser("id = $1", [String(payload.sub)]);
        if (!u) return send(res, 401, { code: 401, msg: "User not found" });
        return send(res, 200, userJson(u));
      } catch {
        return send(res, 401, { code: 401, msg: "Invalid token" });
      }
    }

    if (req.method === "POST" && url.pathname === "/auth/v1/logout") {
      res.writeHead(204); return res.end();
    }

    if (url.pathname === "/auth/v1/health") return send(res, 200, { name: "dev-auth-stub" });
    return send(res, 404, { code: 404, msg: "Not found" });
  } catch (e) {
    return send(res, 500, { code: 500, msg: String(e?.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`dev-auth-stub listening on http://127.0.0.1:${PORT} (LOCAL ONLY)`));
