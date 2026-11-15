// src/road_library.ts: vettadrive.app/roads lists the library's roads by state and area, a road's page has its shape,
// facts and Drive it in Vetta link, unknown roads 404, and vettadrive.com's /roads goes to the app's name.
import { beforeEach, describe, expect, it } from "vitest";
import { routeHost } from "../src/hosts";
import { _resetLibrary, shapePath, type Library } from "../src/road_library";
import type { Env } from "../src/util";

const LIB: Library = {
  built: "2026-11-15", graph: "test",
  areas: [{ id: "robbinsville", name: "Robbinsville", state: "NC", lat: 35.3, lon: -83.8 }, { id: "cincinnati", name: "Cincinnati", state: "OH", lat: 39.1, lon: -84.5 }],
  roads: [
    { id: "cherohala-skyway-robbinsville", name: "Cherohala Skyway", area: "robbinsville", km: 40.5, corners: 110, score: 87, line: [[35.3, -83.8], [35.32, -83.9], [35.36, -84.2]], link: "r1.abc" },
    { id: "calderwood-highway-robbinsville", name: "Calderwood <Highway>", area: "robbinsville", km: 18.9, corners: 151, score: 109, line: [[35.4, -83.9], [35.5, -84.0]], link: "r1.def" },
    { id: "ky-22-cincinnati", name: "KY 22", area: "cincinnati", km: 20.6, corners: 87, score: 71, line: [[38.9, -84.4], [38.8, -84.3]], link: null },
  ],
};
let asked = 0;
const cards = new Map<string, Uint8Array>([["roads/v1/cherohala-skyway-robbinsville.jpg", new Uint8Array([0xff, 0xd8, 0xff, 9])]]);
const DATA = { head: async (k: string) => (cards.has(k) ? { key: k } : null), get: async (k: string) => (cards.has(k) ? { body: new Blob([cards.get(k)!]).stream() } : null) };
const env = { DATA, ASSETS: { fetch: async (r: Request) => { asked++; const u = new URL(r.url); return u.pathname === "/data/road_library.json" ? Response.json(LIB) : new Response("asset", { headers: { "content-type": "text/html" } }); } } } as unknown as Env;
const get = async (u: string) => (await routeHost(new Request(u), env))!;

describe("road library", () => {
  beforeEach(() => { _resetLibrary(); asked = 0; });

  it("lists every state, then each area's roads best first, with no script on the page", async () => {
    const r = await get("https://vettadrive.app/roads");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    const t = await r.text();
    expect(t).toContain('href="/roads/nc">North Carolina');
    expect(t).toContain('href="/roads/oh">Ohio');
    expect(t.indexOf("Calderwood")).toBeLessThan(t.indexOf("Cherohala"));   // score 109 before 87
    expect(t).toContain("Calderwood &lt;Highway&gt;");
    expect(t).not.toContain("<script");
    expect(t).toContain("OpenStreetMap contributors");
    expect(t).not.toMatch(/racing|time attack/i);
  });

  it("a state's page has only its roads", async () => {
    const t = await (await get("https://vettadrive.app/roads/oh")).text();
    expect(t).toContain("KY 22");
    expect(t).not.toContain("Cherohala");
    expect(t).toContain("<title>Great roads in Ohio · Vetta</title>");
  });

  it("a road's page: its facts, its shape, the road's own link and the roads near it", async () => {
    const t = await (await get("https://vettadrive.app/roads/cherohala-skyway-robbinsville")).text();
    expect(t).toContain("<h1>Cherohala Skyway</h1>");
    expect(t).toContain("Near Robbinsville, NC");
    expect(t).toContain("<b>25</b><span>miles</span>");
    expect(t).toContain("<b>110</b><span>corners</span>");
    expect(t).toContain('href="https://vettadrive.app/#road=r1.abc">Drive it in Vetta');
    expect(t).toContain('href="/roads/calderwood-highway-robbinsville"');
    expect(t).toContain('property="og:title" content="Cherohala Skyway · near Robbinsville, NC · Vetta"');
    expect(t).toContain('<link rel="canonical" href="https://vettadrive.app/roads/cherohala-skyway-robbinsville" />');
  });

  it("a road with a card in R2 names it for link previews, large; one without names the app icon", async () => {
    const t = await (await get("https://vettadrive.app/roads/cherohala-skyway-robbinsville")).text();
    expect(t).toContain('property="og:image" content="https://vettadrive.app/roads/cherohala-skyway-robbinsville.jpg"');
    expect(t).toContain('name="twitter:card" content="summary_large_image"');
    const u = await (await get("https://vettadrive.app/roads/ky-22-cincinnati")).text();
    expect(u).toContain('property="og:image" content="https://vettadrive.app/brand/icon-1024.png"');
    expect(u).toContain('name="twitter:card" content="summary"');
    const img = await get("https://vettadrive.app/roads/cherohala-skyway-robbinsville.jpg");
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect([...new Uint8Array(await img.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff, 9]);
    expect((await get("https://vettadrive.app/roads/ky-22-cincinnati.jpg")).status).toBe(404);
    expect((await get("https://vettadrive.app/roads/not-a-road.jpg")).status).toBe(404);
  });

  it("a road with no link opens the app's front page; an unknown road is a 404 page", async () => {
    expect(await (await get("https://vettadrive.app/roads/ky-22-cincinnati")).text()).toContain('href="https://vettadrive.app/">Drive it in Vetta');
    const r = await get("https://vettadrive.app/roads/no-such-road");
    expect(r.status).toBe(404);
    expect(await r.text()).toContain("No road here");
    expect((await get("https://vettadrive.app/roads/%3Cx%3E")).status).toBe(404);
  });

  it("reads the library once, not on every page", async () => {
    await get("https://vettadrive.app/roads"); await get("https://vettadrive.app/roads/oh"); await get("https://vettadrive.app/roads/ky-22-cincinnati");
    expect(asked).toBe(1);
  });

  it("a sitemap of every page; vettadrive.com's /roads goes to vettadrive.app", async () => {
    const x = await (await get("https://vettadrive.app/roads/sitemap.xml")).text();
    expect(x).toContain("<loc>https://vettadrive.app/roads/nc</loc>");
    expect(x).toContain("<loc>https://vettadrive.app/roads/ky-22-cincinnati</loc>");
    const r = await get("https://vettadrive.com/roads/oh");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://vettadrive.app/roads/oh");
  });

  it("the shape fits its box, north up", () => {
    const d = shapePath([[35, -84], [35.1, -84], [35.1, -83.9]], 1000, 560, 40);
    const pts = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    expect(pts).toHaveLength(3);
    for (const [x, y] of pts) { expect(x).toBeGreaterThanOrEqual(39.9); expect(x).toBeLessThanOrEqual(960.1); expect(y).toBeGreaterThanOrEqual(39.9); expect(y).toBeLessThanOrEqual(520.1); }
    expect(pts[1][1]).toBeLessThan(pts[0][1]);   // further north is higher up
  });
});
