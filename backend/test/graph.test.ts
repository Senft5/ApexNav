import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, freshDb } from "./helpers";
import { RAW, TILE } from "../src/graph";

beforeEach(freshDb);
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

const clearCache = async () => {
  const c = (caches as unknown as { default: Cache }).default;
  await c.delete(new Request("https://apexnav.cache/graph/v1/index.json"));
};

/** raw.githubusercontent.com mocked: the index and one tile; every request it saw. */
function mock(build: string, tiles: Record<string, Uint8Array>, upstreamOk = true) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    if (!url.startsWith(RAW) || !upstreamOk) return new Response("no", { status: 404 });
    const name = url.slice(RAW.length);
    if (name === "index.json") return new Response(JSON.stringify({ version: 3, build, tiles: Object.fromEntries(Object.keys(tiles).map((k) => [k.replace(".vgr", ""), { bytes: tiles[k].length }])) }));
    return tiles[name] ? new Response(tiles[name]) : new Response("no", { status: 404 });
  }) as typeof fetch;
  return seen;
}

describe("graph tiles relayed from the graph-data branch", () => {
  it("serves the index and a listed tile, with an ETag from the build, cached", async () => {
    await clearCache();
    const bytes = new Uint8Array([0x56, 0x47, 0x52, 0x31, 3, 0]);
    const seen = mock("b1", { "382_516.vgr": bytes });
    const ix = await api(null, "GET", "/api/graph/v1/index.json");
    expect(ix.status).toBe(200);
    expect(((await ix.json()) as { tiles: Record<string, unknown> }).tiles["382_516"]).toBeTruthy();
    expect(ix.headers.get("etag")).toBe('"b1"');
    const r = await api(null, "GET", "/api/graph/v1/382_516.vgr");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(r.headers.get("etag")).toBe('"b1-382_516"');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
    // again: from the edge cache, raw GitHub not asked a second time for the tile or the index
    const n = seen.length;
    const again = await api(null, "GET", "/api/graph/v1/382_516.vgr");
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(bytes);
    expect(again.headers.get("x-cache")).toBe("hit");
    expect(seen.length).toBe(n);
    // the phone's revalidation: 304
    const nm = await api(null, "GET", "/api/graph/v1/382_516.vgr", undefined, { "if-none-match": '"b1-382_516"' });
    expect(nm.status).toBe(304);
  });

  it("refuses anything but a grid tile the index lists, without asking upstream for it", async () => {
    await clearCache();
    const seen = mock("b2", { "382_516.vgr": new Uint8Array([1]) });
    for (const p of ["/api/graph/v1/382_517.vgr", "/api/graph/v1/382_516.png", "/api/graph/v1/abc_1.vgr", "/api/graph/v1/..%2F..%2Fmain%2FREADME.md",
      "/api/graph/v1/12345_1.vgr", "/api/graph/v1/382_516.vgr.json"]) {
      expect((await api(null, "GET", p)).status, p).toBe(404);
    }
    expect(seen.every((u) => u === RAW + "index.json")).toBe(true);
    expect(TILE.test("382_516.vgr") && !TILE.test("../x.vgr") && !TILE.test("382_516.vgr/x")).toBe(true);
  });

  it("no data branch yet: an empty index, and tiles are 404", async () => {
    await clearCache();
    mock("b3", {}, false);
    const ix = await api(null, "GET", "/api/graph/v1/index.json");
    expect(ix.status).toBe(200);
    expect(((await ix.json()) as { tiles: Record<string, unknown> }).tiles).toEqual({});
    expect((await api(null, "GET", "/api/graph/v1/382_516.vgr")).status).toBe(404);
  });
});
