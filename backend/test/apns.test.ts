// Push send path (src/apns.ts): the provider token is a valid ES256 JWT, kept and remade when it should be; each APNs
// answer maps to keep / drop / retry; the reach check reads APNs' own JSON. Apple is answered here (setApnsFetchForTest).
import { afterEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { apnsConfigured, apnsReach, providerToken, sendAlert, setApnsFetchForTest } from "../src/apns";
import { b64urlDecode, Env } from "../src/util";
import { api } from "./helpers";

const TOKEN = "ab".repeat(32);
async function keyed(): Promise<{ e: Env; pub: CryptoKey }> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  return { e: { ...(env as unknown as Env), APPLE_TEAM_ID: "TEAM123456", APNS_KEY_ID: "KEY1234567", APNS_KEY_P8: pem }, pub: kp.publicKey };
}
const seen: { url: string; init: RequestInit }[] = [];
function answer(status: number, body: unknown = null, headers: Record<string, string> = {}) {
  setApnsFetchForTest(async (u, init) => { seen.push({ url: String(u), init: init ?? {} }); return new Response(body == null ? null : JSON.stringify(body), { status, headers }); });
}
afterEach(() => { setApnsFetchForTest(null); seen.length = 0; });

describe("APNs send path", () => {
  it("is off without a key, and takes the Sign in with Apple key when there is no APNs one", () => {
    const base = env as unknown as Env;
    expect(apnsConfigured({ ...base, APPLE_TEAM_ID: undefined, APNS_KEY_ID: undefined, APNS_KEY_P8: undefined, APPLE_SIWA_KEY_ID: undefined, APPLE_SIWA_KEY_P8: undefined })).toBe(false);
    expect(apnsConfigured({ ...base, APPLE_TEAM_ID: "T", APNS_KEY_ID: undefined, APNS_KEY_P8: undefined, APPLE_SIWA_KEY_ID: "K", APPLE_SIWA_KEY_P8: "p8" })).toBe(true);
  });

  it("signs a provider token Apple can check (ES256, kid, iss, iat) and keeps it for 50 minutes", async () => {
    const { e, pub } = await keyed();
    setApnsFetchForTest(null);
    const t = await providerToken(e, 1_800_000_000);
    const [h, b, s] = t.split(".");
    const dec = (x: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(x)));
    expect(dec(h)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(dec(b)).toEqual({ iss: "TEAM123456", iat: 1_800_000_000 });
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlDecode(s), new TextEncoder().encode(`${h}.${b}`))).toBe(true);
    expect(await providerToken(e, 1_800_000_000 + 49 * 60)).toBe(t);
    expect(await providerToken(e, 1_800_000_000 + 51 * 60)).not.toBe(t);
  });

  it("sends one alert with Apple's headers to the right host", async () => {
    const { e } = await keyed();
    answer(200, null, { "apns-id": "id-1" });
    const r = await sendAlert(e, TOKEN, { title: "Duel", body: "@sam beat your time on Cherohala.", thread: "duel-1", collapse: "duel-1", url: "apexnav://duel/1" }, "sandbox", 1_800_000_000_000);
    expect(r).toEqual({ ok: true, status: 200, reason: null, drop: false, retry: false, id: "id-1" });
    expect(seen[0].url).toBe(`https://api.sandbox.push.apple.com/3/device/${TOKEN}`);
    const hd = seen[0].init.headers as Record<string, string>;
    expect(hd["apns-topic"]).toBe("com.senft.ApexNav");
    expect(hd["apns-push-type"]).toBe("alert");
    expect(hd["apns-priority"]).toBe("10");
    expect(hd["apns-expiration"]).toBe(String(1_800_000_000 + 86400));
    expect(hd["apns-collapse-id"]).toBe("duel-1");
    expect(hd.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ aps: { alert: { title: "Duel", body: "@sam beat your time on Cherohala." }, sound: "default", "thread-id": "duel-1" }, url: "apexnav://duel/1" });
    await sendAlert(e, TOKEN, { title: "a", body: "b", passive: true });
    expect(seen[1].url.startsWith("https://api.push.apple.com/")).toBe(true);
    expect((seen[1].init.headers as Record<string, string>)["apns-priority"]).toBe("5");
  });

  it("says which tokens to forget and which sends to try again", async () => {
    const { e } = await keyed();
    const cases: [number, string | null, boolean, boolean][] = [
      [410, "Unregistered", true, false], [400, "BadDeviceToken", true, false], [400, "DeviceTokenNotForTopic", true, false],
      [429, "TooManyRequests", false, true], [503, "ServiceUnavailable", false, true], [403, "ExpiredProviderToken", false, true],
      [400, "PayloadTooLarge", false, false],
    ];
    for (const [status, reason, drop, retry] of cases) {
      answer(status, { reason });
      const r = await sendAlert(e, TOKEN, { title: "t", body: "b" });
      expect([r.status, r.reason, r.drop, r.retry]).toEqual([status, reason, drop, retry]);
    }
    setApnsFetchForTest(async () => { throw new TypeError("network"); });
    expect((await sendAlert(e, TOKEN, { title: "t", body: "b" })).retry).toBe(true);
    expect((await sendAlert(e, "not-a-token", { title: "t", body: "b" })).drop).toBe(true);
  });

  it("checks that APNs answers with no key, once an hour, and GET /api/push/status says so", async () => {
    answer(403, { reason: "MissingProviderToken" });
    expect(await apnsReach(1000)).toMatchObject({ http: 403, reason: "MissingProviderToken", ok: true });
    await apnsReach(2000);
    expect(seen.length).toBe(1);
    setApnsFetchForTest(async () => { throw new TypeError("protocol error"); });
    expect(await apnsReach()).toMatchObject({ http: null, ok: false });
    answer(403, { reason: "MissingProviderToken" });
    const j = (await (await api(null, "GET", "/api/push/status")).json()) as { configured: boolean; apns: { ok: boolean } };
    expect(j).toMatchObject({ configured: false, apns: { ok: true } });
  });
});
