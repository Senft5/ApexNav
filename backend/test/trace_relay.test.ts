import { afterEach, describe, expect, it } from "vitest";
import { api } from "./helpers";
import { ATTRS, MAX_POINTS, VALHALLA, stageLine } from "../src/trace_relay";
import fx from "./fixtures/trace_stage.json";

// A real trace_attributes answer for Colerain Avenue by Northgate (valhalla1.openstreetmap.de; OSM ODbL), its first edges.
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });
type Seen = { url: string; body: string }[];
const stub = (answer: () => Response, seen: Seen = []) => {
  globalThis.fetch = (async (url: string, o?: RequestInit) => { seen.push({ url: String(url), body: String(o?.body ?? "") }); return answer(); }) as typeof fetch;
  return seen;
};
const good = () => new Response(JSON.stringify(fx.answer), { headers: { "content-type": "application/json" } });
const enc = (s: string) => encodeURIComponent(s);
function encode6(pts: [number, number][]): string {
  let out = "", pl = 0, po = 0;
  const e = (v: number) => { v = v < 0 ? ~(v << 1) : v << 1; let r = ""; while (v >= 0x20) { r += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return r + String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * 1e6), b = Math.round(lo * 1e6); out += e(a - pl) + e(b - po); pl = a; po = b; }
  return out;
}

describe("stage trace relay (/api/ctx/trace)", () => {
  it("asks the router for a stage's edges once, map_snap with the phone's attributes, and keeps them", async () => {
    const seen = stub(good);
    const r = await api(null, "GET", `/api/ctx/trace?shape=${enc(fx.shape)}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-cache")).toBe("miss");
    const body = (await r.json()) as { units: string; edges: unknown[] };
    expect(body.edges.length).toBe(12);
    expect(Object.keys(body).sort()).toEqual(["edges", "units"]);                                 // nothing else of the answer
    expect(seen.length).toBe(1);
    expect(seen[0].url).toBe(VALHALLA);
    const asked = JSON.parse(seen[0].body);
    expect(asked).toEqual({ encoded_polyline: fx.shape, costing: "auto", shape_match: "map_snap", filters: { action: "include", attributes: ATTRS } });
    const later = stub(() => new Response("{}", { status: 500 }));
    const again = await api(null, "GET", `/api/ctx/trace?shape=${enc(fx.shape)}`);
    expect(again.status).toBe(200);
    expect(again.headers.get("x-cache")).toBe("hit");
    expect(later).toEqual([]);
  });

  it("refuses what isn't a stage's line, and says when the router fails", async () => {
    stub(good);
    for (const s of ["", "not a polyline ~~", "_p~iF~ps|U"]) expect((await api(null, "GET", `/api/ctx/trace?shape=${enc(s)}`)).status).toBe(400);
    const pts = stageLine(fx.shape)!;
    expect(pts.length).toBeGreaterThan(1);
    expect(pts.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(stageLine(encode6(Array.from({ length: MAX_POINTS + 1 }, (_, i) => [39 + i * 1e-4, -84.5] as [number, number])))).toBeNull();
    expect(stageLine(encode6([[39, -84.5], [39.5, -84.5]]))).toBeNull();                     // 55 km: not a stage
    stub(() => new Response("{}", { status: 503 }));
    expect((await api(null, "GET", `/api/ctx/trace?shape=${enc(encode6(pts.slice().reverse()))}`)).status).toBe(502);
  });
});
