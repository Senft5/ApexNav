// Sign-in with Google (OpenID Connect authorization-code flow with PKCE, state and nonce), sessions, invites.
// No library: the id_token is received directly from Google's token endpoint over TLS, so per the OIDC spec its
// signature need not be re-verified; we still check iss, aud, exp, nonce and email_verified.
import {
  Env, HttpError, b64urlDecode, body, cookie, getCookie, randomToken, sha256b64url, sha256hex, sqlTime, str,
} from "./util";

export const SESSION_COOKIE = "__Host-ax_session";
const OAUTH_COOKIE = "__Host-ax_oauth";
const SESSION_DAYS = 30;

export interface Viewer { id: string; email: string; handle: string | null; displayName: string | null; member: boolean }

const origin = (req: Request, env: Env) => env.PUBLIC_ORIGIN ?? new URL(req.url).origin;

// ---- sessions ----------------------------------------------------------------------------------
export async function viewer(req: Request, env: Env): Promise<Viewer | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.handle, u.display_name AS displayName, (m.user_id IS NOT NULL) AS member
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN members m ON m.user_id = u.id
      WHERE s.id_hash = ? AND s.expires_at > datetime('now')`,
  ).bind(await sha256hex(token)).first<{ id: string; email: string; handle: string | null; displayName: string | null; member: number }>();
  return row ? { ...row, member: !!row.member } : null;
}

export async function requireUser(req: Request, env: Env): Promise<Viewer> {
  const v = await viewer(req, env);
  if (!v) throw new HttpError(401, "sign_in_required");
  return v;
}

/** Every route that touches shared data uses this: signed in AND let in by an invite (or the owner bootstrap). */
export async function requireMember(req: Request, env: Env): Promise<Viewer> {
  const v = await requireUser(req, env);
  if (!v.member) throw new HttpError(403, "invite_required");
  return v;
}

async function startSession(env: Env, userId: string): Promise<string> {
  const token = randomToken(32);
  await env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256hex(token), userId, sqlTime(Date.now() + SESSION_DAYS * 86400_000)).run();
  return token;
}

export async function logout(req: Request, env: Env): Promise<Response> {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256hex(token)).run();
  return new Response(null, { status: 204, headers: { "set-cookie": cookie(SESSION_COOKIE, "", 0) } });
}

/** State-changing requests must come from our own pages: same Origin and a custom header (cookie is SameSite=Lax too). */
export function csrfCheck(req: Request, env: Env): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const o = req.headers.get("origin");
  if (!o || o !== origin(req, env)) throw new HttpError(403, "bad_origin");
  if (req.headers.get("x-apexnav") !== "1") throw new HttpError(403, "missing_header");
}

// ---- Google OIDC -------------------------------------------------------------------------------
export async function googleStart(req: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new HttpError(503, "google_not_configured");
  const state = randomToken(16), verifier = randomToken(32), nonce = randomToken(16);
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${origin(req, env)}/api/auth/google/callback`, response_type: "code",
    scope: "openid email profile", state, nonce, code_challenge: await sha256b64url(verifier), code_challenge_method: "S256",
    prompt: "select_account",
  });
  return new Response(null, {
    status: 302,
    headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, "set-cookie": cookie(OAUTH_COOKIE, `${state}.${verifier}.${nonce}`, 600) },
  });
}

export interface IdClaims { iss?: string; aud?: string; exp?: number; sub?: string; email?: string; email_verified?: boolean; name?: string; nonce?: string }

export function checkClaims(c: IdClaims, clientId: string, nonce: string, nowS = Math.floor(Date.now() / 1000)): void {
  const okIss = c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com";
  if (!okIss || c.aud !== clientId || !c.exp || c.exp < nowS || c.nonce !== nonce || !c.sub || !c.email || c.email_verified !== true) {
    throw new HttpError(401, "bad_id_token");
  }
}

export async function googleCallback(req: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new HttpError(503, "google_not_configured");
  const url = new URL(req.url);
  const saved = (getCookie(req, OAUTH_COOKIE) ?? "").split(".");
  const [state, verifier, nonce] = saved;
  if (!state || !verifier || !nonce || url.searchParams.get("state") !== state) throw new HttpError(400, "bad_state");
  const code = url.searchParams.get("code");
  if (!code) throw new HttpError(400, "no_code");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin(req, env)}/api/auth/google/callback`, grant_type: "authorization_code", code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new HttpError(401, "token_exchange_failed");
  const { id_token } = (await res.json()) as { id_token?: string };
  const part = id_token?.split(".")[1];
  if (!part) throw new HttpError(401, "bad_id_token");
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(part))) as IdClaims;
  checkClaims(claims, env.GOOGLE_CLIENT_ID, nonce);

  const userId = await upsertGoogleUser(env, claims.sub!, claims.email!, claims.name ?? null);
  const token = await startSession(env, userId);
  const headers = new Headers({ location: "/" });
  headers.append("set-cookie", cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400));
  headers.append("set-cookie", cookie(OAUTH_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

/** Creates or finds the user. The owner (OWNER_EMAIL secret) is let in automatically when nobody is a member yet. */
export async function upsertGoogleUser(env: Env, sub: string, email: string, name: string | null): Promise<string> {
  const found = await env.DB.prepare("SELECT id FROM users WHERE google_sub = ?").bind(sub).first<{ id: string }>();
  const id = found?.id ?? crypto.randomUUID();
  if (!found) await env.DB.prepare("INSERT INTO users (id, google_sub, email, display_name) VALUES (?, ?, ?, ?)").bind(id, sub, email, name).run();
  if (env.OWNER_EMAIL && email.toLowerCase() === env.OWNER_EMAIL.toLowerCase()) {
    await env.DB.prepare(
      "INSERT INTO members (user_id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM members)",
    ).bind(id).run();
  }
  return id;
}

// ---- invites -----------------------------------------------------------------------------------
export async function createInvite(env: Env, v: Viewer, req: Request): Promise<{ token: string; url: string }> {
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM invites WHERE created_by = ? AND used_at IS NULL AND expires_at > datetime('now')")
    .bind(v.id).first<{ n: number }>();
  if ((open?.n ?? 0) >= 10) throw new HttpError(429, "too_many_open_invites");
  const token = randomToken(24);
  await env.DB.prepare("INSERT INTO invites (token_hash, created_by, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256hex(token), v.id, sqlTime(Date.now() + 7 * 86400_000)).run();
  return { token, url: `${origin(req, env)}/?invite=${token}` };
}

export async function redeemInvite(env: Env, v: Viewer, req: Request): Promise<void> {
  const { token } = await body<{ token?: string }>(req);
  const hash = await sha256hex(str(token, "token", 10, 100));
  // one atomic step: only an unused, unexpired invite flips to used, and only then is the user made a member
  const used = await env.DB.prepare(
    "UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now') RETURNING created_by",
  ).bind(v.id, hash).first<{ created_by: string }>();
  if (!used) throw new HttpError(400, "invalid_invite");
  await env.DB.prepare("INSERT OR IGNORE INTO members (user_id, invited_by) VALUES (?, ?)").bind(v.id, used.created_by).run();
}
