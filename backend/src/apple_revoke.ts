// Sign in with Apple token revocation (App Review 5.1.1(v)): an app that offers Sign in with Apple must revoke the person's
// Apple tokens when they delete their account. At sign-in the app also sends the one-time authorization code; the Worker
// trades it with Apple for a refresh token (within Apple's 5 minutes) and keeps only that, under `siwa/<user id>` in the
// PHOTOS KV namespace (not D1, so it never rides in a database backup). Delete account revokes it with Apple and drops it.
// Needs three secrets from the owner (docs/OWNER_TODO.md): APPLE_TEAM_ID, APPLE_SIWA_KEY_ID and APPLE_SIWA_KEY_P8 (the
// .p8 file's text). Without them nothing is traded or kept, and sign-in and deletion work exactly as before.
import { Env, b64urlDecode } from "./util";
import { serverError } from "./errors";
import { APPLE_ISS, BUNDLE_ID } from "./apple";

const TOKEN_URL = "https://appleid.apple.com/auth/token", REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const kvKey = (userId: string) => `siwa/${userId}`;

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests answer for Apple. */
export function setAppleFetchForTest(f: typeof fetch | null): void { fetchImpl = f ?? ((...a) => fetch(...a)); }

export const siwaConfigured = (env: Env): boolean => !!(env.APPLE_TEAM_ID && env.APPLE_SIWA_KEY_ID && env.APPLE_SIWA_KEY_P8 && env.PHOTOS);

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json64 = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** Apple's client secret: an ES256 JWT signed with the Sign in with Apple key, good for five minutes. */
export async function clientSecret(env: Env, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const pem = String(env.APPLE_SIWA_KEY_P8).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = b64urlDecode(pem.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = json64({ alg: "ES256", kid: env.APPLE_SIWA_KEY_ID }), body = json64({ iss: env.APPLE_TEAM_ID, iat: nowS, exp: nowS + 300, aud: APPLE_ISS, sub: BUNDLE_ID });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));   // r||s, as JWS wants
  return `${head}.${body}.${b64url(sig)}`;
}

const form = (o: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });

/** At sign-in: trade the authorization code for a refresh token and keep it. Never fails the sign-in. */
export async function keepAppleRefresh(env: Env, userId: string, code: string): Promise<void> {
  if (!siwaConfigured(env) || !code) return;
  try {
    const r = await fetchImpl(TOKEN_URL, form({ client_id: BUNDLE_ID, client_secret: await clientSecret(env), code, grant_type: "authorization_code" }));
    if (!r.ok) throw new Error(`apple token ${r.status}`);
    const t = ((await r.json()) as { refresh_token?: string }).refresh_token;
    if (t) await env.PHOTOS!.put(kvKey(userId), t);
  } catch (e) { await serverError(env, "apple token", e); }
}

/** At Delete account: revoke the kept refresh token with Apple and drop it. Never blocks the deletion. */
export async function revokeApple(env: Env, userId: string): Promise<void> {
  if (!env.PHOTOS) return;
  const t = await env.PHOTOS.get(kvKey(userId));
  if (!t) return;
  try {
    if (siwaConfigured(env)) {
      const r = await fetchImpl(REVOKE_URL, form({ client_id: BUNDLE_ID, client_secret: await clientSecret(env), token: t, token_type_hint: "refresh_token" }));
      if (!r.ok) throw new Error(`apple revoke ${r.status}`);
    }
  } catch (e) { await serverError(env, "apple revoke", e); }
  await env.PHOTOS.delete(kvKey(userId));
}
