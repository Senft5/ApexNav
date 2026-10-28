// Sign in with Apple from the iOS app (IDEAS O-05, App Review guideline 4.8). The app runs Apple's native sheet with the
// sha256 of a one-time nonce and posts the identity token it gets back, with the raw nonce and (first time only) the name.
// The token reaches us from the phone, not from Apple, so unlike Google's its signature is verified here against Apple's
// published keys, then iss, aud (the app's bundle id), exp and the nonce. An Apple account is stored as `apple:<sub>` in
// users.google_sub (the column holds the sign-in identity; bans key on it too), so no migration was needed.
import { Env, HttpError, b64urlDecode, body, sha256hex, str } from "./util";
import { startSession } from "./auth";

export const APPLE_ISS = "https://appleid.apple.com";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
const BUNDLE_ID = "com.senft.ApexNav";
const KEYS_TTL_MS = 3600_000;

interface Jwk { kid: string; kty: string; alg?: string; n: string; e: string }
let keyCache: { at: number; keys: Jwk[] } | null = null;

/** Tests set the key set instead of fetching Apple's. */
export function setAppleKeysForTest(keys: Jwk[] | null): void { keyCache = keys ? { at: Infinity, keys } : null; }

async function appleKeys(refresh: boolean): Promise<Jwk[]> {
  if (keyCache && !refresh && Date.now() - keyCache.at < KEYS_TTL_MS) return keyCache.keys;
  if (keyCache && keyCache.at === Infinity) return keyCache.keys;
  const res = await fetch(APPLE_KEYS_URL);
  if (!res.ok) throw new HttpError(503, "apple_keys_unavailable");
  const keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
  keyCache = { at: Date.now(), keys };
  return keys;
}

export interface AppleClaims { iss?: string; aud?: string; exp?: number; sub?: string; email?: string; nonce?: string }

/** The verified claims of an Apple identity token, or a 401. `nonceRaw` is what the app hashed into the request. */
export async function verifyAppleToken(token: string, nonceRaw: string, nowS = Math.floor(Date.now() / 1000)): Promise<AppleClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "bad_id_token");
  let header: { kid?: string; alg?: string }, claims: AppleClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch { throw new HttpError(401, "bad_id_token"); }
  if (header.alg !== "RS256" || !header.kid) throw new HttpError(401, "bad_id_token");
  let jwk = (await appleKeys(false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await appleKeys(true)).find((k) => k.kid === header.kid);   // Apple rotated its keys
  if (!jwk) throw new HttpError(401, "bad_id_token");
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok || claims.iss !== APPLE_ISS || claims.aud !== BUNDLE_ID || !claims.exp || claims.exp < nowS || !claims.sub
      || claims.nonce !== (await sha256hex(nonceRaw))) throw new HttpError(401, "bad_id_token");
  return claims;
}

/** Apple sends the name only on the first authorization and may hide the email behind a relay address; keep what we have. */
export async function upsertAppleUser(env: Env, sub: string, email: string | null, name: string | null): Promise<string> {
  const ident = `apple:${sub}`;
  const found = await env.DB.prepare("SELECT id FROM users WHERE google_sub = ?").bind(ident).first<{ id: string }>();
  if (!found) {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, google_sub, email, display_name) VALUES (?, ?, ?, ?)").bind(id, ident, email ?? "", name).run();
    return id;
  }
  await env.DB.prepare("UPDATE users SET email = COALESCE(?, email), display_name = COALESCE(?, display_name) WHERE id = ?")
    .bind(email, name, found.id).run();
  return found.id;
}

/** POST /api/auth/apple {id_token, nonce, name?} from the app: a session token, like the Google code exchange. */
export async function appleSignIn(req: Request, env: Env): Promise<Response> {
  const b = await body<{ id_token?: unknown; nonce?: unknown; name?: unknown }>(req);
  const token = str(b.id_token, "id_token", 20, 4096), nonce = str(b.nonce, "nonce", 16, 128);
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : null;
  const claims = await verifyAppleToken(token, nonce);
  const userId = await upsertAppleUser(env, claims.sub!, claims.email ?? null, name);
  return new Response(JSON.stringify({ token: await startSession(env, userId) }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
