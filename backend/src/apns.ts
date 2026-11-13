// Push notifications through Apple's APNs (big bet #3, docs/notes/2026-11-13-apns-send-path.md). The send path only:
// device tokens, who gets told what and when (never while driving, C-06) are the social side's to build on top.
//
// APNs speaks HTTP/2 only. A Worker's fetch() reaches it: `apnsReach` POSTs with no credentials and APNs answers
// 403 MissingProviderToken in its own JSON, which an HTTP/1.1 path could not get back (GET /api/push/status shows it).
//
// Auth is a provider token: an ES256 JWT (kid = key id, iss = team id, iat) signed with an APNs .p8 key. Apple wants it
// reused for up to an hour and refreshed no more than every 20 minutes, so each isolate keeps one for 50 minutes.
// Keys: APNS_KEY_ID + APNS_KEY_P8, or else the Sign in with Apple key (APPLE_SIWA_KEY_*) when the owner enables APNs on
// that same key in the developer portal. APPLE_TEAM_ID either way.
import { Env, b64urlDecode } from "./util";
import { BUNDLE_ID } from "./apple";

export const HOSTS = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" } as const;
export type ApnsEnv = keyof typeof HOSTS;
/** A device token as the app hands it over: 64 hex characters today; Apple says not to rely on the length, so up to 200. */
export const TOKEN = /^[0-9a-f]{64,200}$/;
const TOKEN_TTL_S = 50 * 60;

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests answer for Apple. */
export function setApnsFetchForTest(f: typeof fetch | null): void { fetchImpl = f ?? ((...a) => fetch(...a)); cached = null; reach = null; }

const keyOf = (env: Env) => (env.APNS_KEY_ID && env.APNS_KEY_P8 ? { kid: env.APNS_KEY_ID, p8: env.APNS_KEY_P8 }
  : env.APPLE_SIWA_KEY_ID && env.APPLE_SIWA_KEY_P8 ? { kid: env.APPLE_SIWA_KEY_ID, p8: env.APPLE_SIWA_KEY_P8 } : null);
export const apnsConfigured = (env: Env): boolean => !!(env.APPLE_TEAM_ID && keyOf(env));

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json64 = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

let cached: { jwt: string; kid: string; at: number } | null = null;
/** The provider token, kept per isolate for 50 minutes (and made again when the key changes). */
export async function providerToken(env: Env, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
  const k = keyOf(env);
  if (!k || !env.APPLE_TEAM_ID) throw new Error("apns not configured");
  if (cached && cached.kid === k.kid && nowS - cached.at < TOKEN_TTL_S) return cached.jwt;
  const pem = k.p8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = b64urlDecode(pem.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = json64({ alg: "ES256", kid: k.kid }), body = json64({ iss: env.APPLE_TEAM_ID, iat: nowS });
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
  cached = { jwt: `${head}.${body}.${b64url(sig)}`, kid: k.kid, at: nowS };
  return cached.jwt;
}

export interface Alert {
  title: string; body: string;
  /** Groups a person's notifications (one thread per duel, crew, ...). */
  thread?: string;
  /** A newer push with the same id replaces the older one on the phone (64 bytes at most). */
  collapse?: string;
  /** Where a tap goes: an apexnav:// link the app opens. */
  url?: string;
  /** Seconds APNs keeps trying a phone that is off; 0 = now or never. Default a day. */
  ttlS?: number;
  /** Quiet: no sound, delivered when the phone is ready (APNs priority 5). */
  passive?: boolean;
}

/** What APNs said. `drop`: the token is dead (uninstalled, or never valid here), forget it. `retry`: try again later. */
export interface Sent { ok: boolean; status: number; reason: string | null; drop: boolean; retry: boolean; id: string | null }

const DEAD = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

/** One alert to one device. Never throws for an APNs answer; throws only when push isn't configured. */
export async function sendAlert(env: Env, token: string, a: Alert, where: ApnsEnv = "production", now = Date.now()): Promise<Sent> {
  if (!TOKEN.test(token)) return { ok: false, status: 0, reason: "BadDeviceToken", drop: true, retry: false, id: null };
  const payload = {
    aps: { alert: { title: a.title.slice(0, 120), body: a.body.slice(0, 400) }, ...(a.passive ? {} : { sound: "default" }),
      ...(a.thread ? { "thread-id": a.thread.slice(0, 64) } : {}), ...(a.passive ? { "interruption-level": "passive" } : {}) },
    ...(a.url ? { url: a.url } : {}),
  };
  const headers: Record<string, string> = {
    authorization: `bearer ${await providerToken(env, Math.floor(now / 1000))}`,
    "apns-topic": BUNDLE_ID, "apns-push-type": "alert", "apns-priority": a.passive ? "5" : "10",
    "apns-expiration": String(a.ttlS === 0 ? 0 : Math.floor(now / 1000) + (a.ttlS ?? 86400)),
    "content-type": "application/json",
  };
  if (a.collapse) headers["apns-collapse-id"] = a.collapse.slice(0, 64);
  let r: Response;
  try { r = await fetchImpl(`${HOSTS[where]}/3/device/${token}`, { method: "POST", headers, body: JSON.stringify(payload) }); }
  catch { return { ok: false, status: 0, reason: "network", drop: false, retry: true, id: null }; }
  const id = r.headers.get("apns-id");
  if (r.status === 200) return { ok: true, status: 200, reason: null, drop: false, retry: false, id };
  let reason: string | null = null;
  try { reason = ((await r.json()) as { reason?: string }).reason ?? null; } catch { reason = null; }
  if (reason === "ExpiredProviderToken") cached = null;   // made again on the next send
  return { ok: false, status: r.status, reason, id, drop: r.status === 410 || (!!reason && DEAD.has(reason)),
    retry: r.status === 429 || r.status >= 500 || reason === "ExpiredProviderToken" };
}

let reach: { at: number; v: { http: number | null; reason: string | null; ms: number; ok: boolean } } | null = null;
/** Can this Worker talk to APNs? One credential-less POST to the sandbox, kept per isolate for an hour. `ok` when APNs
 *  itself answered (its JSON reason): proof that the HTTP/2 path works before any key exists. */
export async function apnsReach(now = Date.now()) {
  if (reach && now - reach.at < 3600_000) return reach.v;
  const t0 = Date.now();
  let v: { http: number | null; reason: string | null; ms: number; ok: boolean };
  try {
    const r = await fetchImpl(`${HOSTS.sandbox}/3/device/${"0".repeat(64)}`, { method: "POST", headers: { "apns-topic": BUNDLE_ID, "content-type": "application/json" }, body: "{}" });
    let reason: string | null = null;
    try { reason = ((await r.json()) as { reason?: string }).reason ?? null; } catch { reason = null; }
    v = { http: r.status, reason, ms: Date.now() - t0, ok: !!reason };
  } catch (e) {
    v = { http: null, reason: String((e as Error)?.message ?? e).slice(0, 120), ms: Date.now() - t0, ok: false };
  }
  reach = { at: now, v };
  return v;
}

/** GET /api/push/status: is push set up on this Worker, and does APNs answer it. Names no key and no person. */
export async function pushStatus(env: Env) {
  return { configured: apnsConfigured(env), apns: await apnsReach() };
}
