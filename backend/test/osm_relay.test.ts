import { afterEach, describe, expect, it } from "vitest";
import { api } from "./helpers";
import { env } from "cloudflare:workers";
import { builtTile, bundleKey, compact, KEEP, MIRRORS, osmTile, query, resetBuiltForTest, tileOf } from "../src/osm_relay";
import fx from "./fixtures/overpass_tile.json";

// A real Overpass answer's elements (Dry Ridge Road, Colerain Township; OSM ODbL) with two tags the phone never reads.
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });
const BOX = "39.25,-84.65,39.3,-84.6";                     // tile 785_-1693
let n = 0;
const fresh = () => { n++; return `${(39.25 + 0.05 * n).toFixed(2)},-84.65,${(39.3 + 0.05 * n).toFixed(2)},-84.6`; };   // a tile no other test has cached
type Seen = { url: string; body: string }[];
const stub = (answer: (url: string) => Response | Promise<Response>, seen: Seen = []) => {
  globalThis.fetch = (async (url: string, o?: RequestInit) => { seen.push({ url: String(url), body: String(o?.body ?? "") }); return answer(String(url)); }) as typeof fetch;
  return seen;
};
const ok = () => new Response(JSON.stringify({ elements: fx.elements }), { headers: { "content-type": "application/json" } });

describe("OSM relay (/api/ctx/osm)", () => {
  it("answers one 0.05° tile's elements with only the tags the phone reads, signed out", async () => {
    const seen = stub(ok);
    const r = await api(null, "GET", `/api/ctx/osm?bbox=${BOX}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { elements: { type: string; id: number; tags?: Record<string, string> }[] };
    expect(body.elements.length).toBe(fx.elements.length);
    expect(body.elements.map((e) => e.id)).toEqual(fx.elements.map((e) => e.id));            // the same elements, in order
    for (const e of body.elements) for (const k of Object.keys(e.tags ?? {})) expect(KEEP.has(k)).toBe(true);
    expect(body.elements.some((e) => e.tags && "note" in e.tags)).toBe(false);
    // the mirrors get the tile's box, never anything else about the request
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => MIRRORS.includes(s.url))).toBe(true);
    expect(decodeURIComponent(seen[0].body.slice(5))).toBe(query(["785_-1693"]));
  });

  it("keeps the tile: the second ask answers from the cache without asking a mirror", async () => {
    const box = fresh();
    stub(ok);
    expect((await api(null, "GET", `/api/ctx/osm?bbox=${box}`)).headers.get("x-cache")).toBe("miss");
    const seen = stub(() => new Response("{}", { status: 500 }));
    const again = await api(null, "GET", `/api/ctx/osm?bbox=${box}`);
    expect(again.status).toBe(200);
    expect(again.headers.get("x-cache")).toBe("hit");
    expect(again.headers.get("cache-control")).toBe("public, max-age=604800");
    expect(seen).toEqual([]);
  });

  it("takes the first good mirror, skips a busy one, and says when none answers", async () => {
    stub((url) => (url.includes("overpass-api.de") ? new Response("busy", { status: 504 }) : url.includes("kumi") ? ok() : new Promise<Response>(() => {})));
    expect((await api(null, "GET", `/api/ctx/osm?bbox=${fresh()}`)).status).toBe(200);
    stub(() => new Response(JSON.stringify({ remark: "runtime error: timed out", elements: [] })));
    expect((await api(null, "GET", `/api/ctx/osm?bbox=${fresh()}`)).status).toBe(502);
  });

  it("a slow miss answers 504 at the wait, keeps fetching, and the next ask has it", async () => {
    const box = fresh();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    stub(async () => { await gate; return ok(); });
    const later: Promise<unknown>[] = [];
    const first = await osmTile(new URL(`https://x/api/ctx/osm?bbox=${box}`), {}, { waitUntil: (p) => later.push(p) }, globalThis.fetch, 50);
    expect(first.status).toBe(504);
    release();
    await Promise.all(later);
    const again = await osmTile(new URL(`https://x/api/ctx/osm?bbox=${box}`), {}, undefined, (async () => { throw new Error("no"); }) as typeof fetch);
    expect(again.status).toBe(200);
    expect(again.headers.get("x-cache")).toBe("hit");
  });

  it("refuses anything but one tile of the grid", async () => {
    stub(ok);
    for (const b of ["39.26,-84.65,39.31,-84.6", "39.25,-84.65,39.35,-84.6", "39.25,-84.65,39.27,-84.63", "39.25,-84.65", "a,b,c,d", ""]) {
      expect((await api(null, "GET", `/api/ctx/osm?bbox=${b}`)).status).toBe(400);
    }
    expect(tileOf(BOX)).toBe("785_-1693");
    expect(tileOf("39.2500,-84.6500,39.3000,-84.6000")).toBe("785_-1693");
  });

  it("compact keeps positions to 6 decimals and drops everything else", () => {
    const c = compact({ elements: [{ type: "node", id: 1, lat: 39.123456789, lon: -84.1, tags: { highway: "stop", note: "x" }, user: "someone", version: 3 }] });
    expect(c).toEqual({ elements: [{ type: "node", id: 1, lat: 39.123457, lon: -84.1, tags: { highway: "stop" } }] });
  });

  describe("built tiles (tools/osm_ctx/build.py, R2 osm/v1)", () => {
    const DATA = (env as unknown as { DATA: R2Bucket }).DATA;
    const gz = async (text: string) => new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    // tiles 700_-1600 .. 704_-1596 are one bundle (140_-320); 700_-1600 and 700_-1599 are in it, 701_-1600 isn't (a border)
    const line = (t: string, els: unknown[]) => `${t}\t${JSON.stringify({ elements: els })}\n`;
    const way = { type: "way", id: 7, tags: { highway: "secondary", name: "Built Road" }, geometry: [{ lat: 35, lon: -80 }, { lat: 35.01, lon: -80 }], nodes: [1, 2] };
    const put = async () => { resetBuiltForTest(); await DATA.put("osm/v1/140_-320.txt.gz", await gz(line("700_-1600", [way]) + line("700_-1599", []))); };

    it("answers a built tile from R2 without asking Overpass, and keeps it in the cache", async () => {
      await put();
      const seen = stub(() => new Response("{}", { status: 500 }));
      const r = await api(null, "GET", "/api/ctx/osm?bbox=35,-80,35.05,-79.95");
      expect(r.status).toBe(200);
      expect(r.headers.get("x-cache")).toBe("built");
      expect(await r.json()).toEqual({ elements: [way] });
      const empty = await api(null, "GET", "/api/ctx/osm?bbox=35,-79.95,35.05,-79.9");
      expect(empty.status).toBe(200);
      expect(await empty.json()).toEqual({ elements: [] });                 // built and empty: no roads there, not unknown
      expect(seen).toEqual([]);
      await DATA.delete("osm/v1/140_-320.txt.gz"); resetBuiltForTest();
      expect((await api(null, "GET", "/api/ctx/osm?bbox=35,-80,35.05,-79.95")).headers.get("x-cache")).toBe("hit");
    });

    it("a tile its bundle leaves out (across the border) or with no bundle goes to Overpass", async () => {
      await put();
      const seen = stub(ok);
      const r = await api(null, "GET", "/api/ctx/osm?bbox=35.05,-80,35.1,-79.95");
      expect(r.status).toBe(200);
      expect(r.headers.get("x-cache")).toBe("miss");
      expect(seen.length).toBeGreaterThan(0);
      expect(await builtTile(DATA, "690_-1600")).toBeNull();
      expect(await builtTile(undefined, "700_-1600")).toBeNull();
      expect(bundleKey("700_-1600")).toBe("osm/v1/140_-320.txt.gz");
      expect(bundleKey("-3_-1")).toBe("osm/v1/-1_-1.txt.gz");
      await DATA.delete("osm/v1/140_-320.txt.gz"); resetBuiltForTest();
    });
  });
});
