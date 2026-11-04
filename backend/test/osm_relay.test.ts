import { afterEach, describe, expect, it } from "vitest";
import { api } from "./helpers";
import { compact, KEEP, MIRRORS, osmTile, query, tileOf } from "../src/osm_relay";
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
});
