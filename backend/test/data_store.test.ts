// src/data_store.ts + src/github_oidc.ts: CI uploads the map data to R2 with a GitHub OIDC token (no secret), and the
// graph, context-grid and camera routes serve R2 first, GitHub raw after.
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, freshDb } from "./helpers";
import { AUDIENCE, ISSUER, setJwksForTest, verifyGitHubOidc } from "../src/github_oidc";
import { resetDataForTest } from "../src/data_store";

const DATA = (env as unknown as { DATA: R2Bucket }).DATA;
let priv: CryptoKey, jwk: JsonWebKey;
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: unknown) => b64(new TextEncoder().encode(JSON.stringify(o)));

async function token(over: Record<string, unknown> = {}, kid = "k1"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: ISSUER, aud: AUDIENCE, repository: "Senft5/ApexNav", ref: "refs/heads/main", workflow: "Map data to R2", run_id: "77",
    repository_id: "1432495043", repository_owner_id: "55918175", event_name: "workflow_run",
    workflow_ref: "Senft5/ApexNav/.github/workflows/data-mirror.yml@refs/heads/main", sha: "abcdef1234567890", iat: now, nbf: now - 5, exp: now + 300, ...over };
  const h = enc({ alg: "RS256", kid, typ: "JWT" }), p = enc(body);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", priv, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(sig)}`;
}
const put = async (key: string, bytes: Uint8Array | string, tok?: string) =>
  exports.default.fetch(new Request(`${ORIGIN}/api/ops/data?key=${encodeURIComponent(key)}`, { method: "PUT", body: bytes,
    headers: { origin: ORIGIN, "x-apexnav": "1", ...(tok === undefined ? { authorization: `Bearer ${await token()}` } : tok ? { authorization: `Bearer ${tok}` } : {}) } }));
const get = (path: string) => exports.default.fetch(new Request(ORIGIN + path));

beforeAll(async () => {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  priv = kp.privateKey;
  jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey) as JsonWebKey), kid: "k1" } as JsonWebKey;
  setJwksForTest(async () => [jwk]);
});
async function emptyBucket() {
  for (let more = true; more;) { const l = await DATA.list(); if (l.objects.length) await DATA.delete(l.objects.map((o) => o.key)); more = l.truncated; }
}
beforeEach(async () => { await freshDb(); resetDataForTest(); await emptyBucket(); });
afterEach(() => resetDataForTest());

describe("GitHub OIDC", () => {
  it("lets in this repository's main branch only, signed by GitHub's key, for our audience, not expired", async () => {
    expect(await verifyGitHubOidc(await token())).toMatchObject({ repository: "Senft5/ApexNav", ref: "refs/heads/main", run_id: "77" });
    for (const bad of [{ repository: "someone/ApexNav" }, { ref: "refs/heads/feature" }, { ref: "refs/pull/9/merge" }, { aud: "other" },
      { iss: "https://example.test" }, { exp: Math.floor(Date.now() / 1000) - 600 },
      { repository_id: "999" }, { repository_owner_id: "999" }, { event_name: "pull_request_target" },     // a reused name; a PR's code
      { workflow_ref: "Senft5/ApexNav/.github/workflows/core-tests.yml@refs/heads/main" }]) {                 // any other workflow
      expect(await verifyGitHubOidc(await token(bad))).toBeNull();
    }
    expect(await verifyGitHubOidc(await token({}, "unknown-kid"))).toBeNull();
    const t = await token(), [h, , s] = t.split(".");
    expect(await verifyGitHubOidc(`${h}.${enc({ iss: ISSUER, aud: AUDIENCE, repository: "Senft5/ApexNav", ref: "refs/heads/main", exp: 9e9 })}.${s}`)).toBeNull();   // a forged body
    expect(await verifyGitHubOidc("not.a.jwt")).toBeNull();
  });
});

describe("map data in R2", () => {
  const tileBytes = new Uint8Array([86, 71, 82, 49, 1, 2, 3]);
  const index = (build: string, tiles = ["10_20", "10_21"]) => JSON.stringify({ build, tiles: Object.fromEntries(tiles.map((t) => [t, { bytes: 7 }])) });

  it("refuses an upload without a valid token or outside the known keys", async () => {
    expect((await put("graph/v1/b/b1/10_20.vgr", tileBytes, "")).status).toBe(401);
    expect((await put("graph/v1/b/b1/10_20.vgr", tileBytes, await token({ ref: "refs/heads/x" }))).status).toBe(401);
    expect((await put("../secrets.txt", tileBytes)).status).toBe(400);
    expect((await put("graph/v1/b/b1/../../x.vgr", tileBytes)).status).toBe(400);
    expect((await DATA.list()).objects).toHaveLength(0);
  });

  it("switches the index only once every tile is there, then serves R2 first and drops builds older than the last two", async () => {
    expect((await put("graph/v1/b/b1/10_20.vgr", tileBytes)).status).toBe(201);
    const early = await put("graph/v1/index.json", index("b1"));
    expect(early.status).toBe(409);   // 10_21 not uploaded yet
    expect((await put("graph/v1/b/b1/10_21.vgr", tileBytes)).status).toBe(201);
    expect((await put("graph/v1/index.json", index("b1"))).status).toBe(201);
    const same = await put("graph/v1/b/b1/10_21.vgr", tileBytes);
    expect(await same.json()).toMatchObject({ same: true });   // the same bytes again: no write

    const ix = await get("/api/graph/v1/index.json");
    expect(JSON.parse(await ix.text()).build).toBe("b1");
    const t = await get("/api/graph/v1/10_20.vgr");
    expect(t.status).toBe(200);
    expect(t.headers.get("x-cache")).toBe("r2");
    expect(new Uint8Array(await t.arrayBuffer())).toEqual(tileBytes);
    expect((await get("/api/graph/v1/99_99.vgr")).status).toBe(404);   // not in the index

    for (const b of ["b2", "b3"]) {
      for (const n of ["10_20", "10_21"]) await put(`graph/v1/b/${b}/${n}.vgr`, tileBytes);
      resetDataForTest();
      expect((await put("graph/v1/index.json", index(b))).status).toBe(201);
    }
    // the sweep runs after the response (ctx.waitUntil)
    const builds = async () => [...new Set((await DATA.list({ prefix: "graph/v1/b/" })).objects.map((o) => o.key.split("/")[3]))].sort();
    for (let i = 0; i < 50 && (await builds()).length > 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await builds()).toEqual(["b2", "b3"]);
  });

  it("serves the camera list and context bundles from R2", async () => {
    const cams = JSON.stringify({ tiles: [], cams: [[1, 2]] });
    expect((await put("cameras/v1/region.json", cams)).status).toBe(201);
    const c = await get("/api/cameras/v1/region.json");
    expect(c.headers.get("x-cache")).toBe("r2");
    expect(await c.text()).toBe(cams);
    expect((await put("ctx/v1/8/66/97.vcg", tileBytes)).status).toBe(201);
    const x = await get("/api/ctx/v1/8/66/97.vcg");
    expect(x.status).toBe(200);
    expect(new Uint8Array(await x.arrayBuffer())).toEqual(tileBytes);
  });
});
