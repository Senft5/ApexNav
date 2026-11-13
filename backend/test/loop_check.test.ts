import { describe, expect, it } from "vitest";
import { loopOnRoads, requireOnRoads, MAX_SAMPLES, samplesOf, tileName, tilePolylines } from "../src/loop_check";
import type { Env } from "../src/util";

// Written by tools/graph_etl/tiles.py write_tile: tile 382_516 with a through road (class 3) along 39.1 N from 84.45 W to
// 84.40 W (both directions, one line) and a residential lane (class 6) north from it at 84.42 W for 1.1 km.
const TILE = "VkdSMQMAQAB+AQAABAIAAAMAAAADAAAAAAAAAAAAAAAAAAAAOwAAAAAAAAAZUQAAAAAAAAANAAACAAAAAAAAACBOIE7wVRAnIE6APgAAAAABAAAAAgAAAAMAAAAAAAAAAAAAAAAAAAAlAAAAAQAAAAAA+Kf4p/gqAAAAAAAA////////AAAABAAA////////////////AAAAAwMGAAAAAAAAAAAAAAAAAAAAAAvAuAKgnAEA0A8A0A8A0A8A0A8A0A8A0A8A0A8A0A8A0A8A0A8GwLgCgPoBoAYAoAYAoAYAoAYAoAYAAP//////////////////////////////////AAA=";
const bytes = () => Uint8Array.from(atob(TILE), (c) => c.charCodeAt(0));
const load = async (name: string) => (name === "382_516" ? bytes() : null);
const line = (a: [number, number], b: [number, number], n = 40): [number, number][] =>
  Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
const outAndBack = (a: [number, number], b: [number, number]) => [...line(a, b), ...line(b, a).slice(1)];

describe("loop on roads", () => {
  it("reads the tile's lines like web/graph_tiles.js", () => {
    const polys = tilePolylines(bytes());
    expect(polys.map((p) => [p.cls, p.pts.length / 2])).toEqual([[3, 11], [6, 6]]);   // the road's two directions share one line
    expect([polys[0].pts[0], polys[0].pts[1]]).toEqual([39.1, -84.45]);
    expect(tilePolylines(bytes(), [39.105, -84.43, 39.106, -84.425]).map((p) => p.cls)).toEqual([3, 6]);
    expect(tilePolylines(bytes(), [39.2, -84.3, 39.21, -84.29])).toEqual([]);           // far from both
    expect(() => tilePolylines(new Uint8Array(80))).toThrow();
    expect(tileName(39.1, -84.45)).toBe("382_516");
    expect(samplesOf(line([39.1, -84.45], [39.1, -84.4])).length).toBe(22);             // 4.3 km every 200 m
    const long = samplesOf(line([39.1, -84.45], [39.1, -83.9]));                          // 47 km: spread to MAX_SAMPLES
    expect(long.length).toBeGreaterThanOrEqual(MAX_SAMPLES);
    expect(long.length).toBeLessThanOrEqual(MAX_SAMPLES + 1);
    // with the samples, only lines that can come near one: the box holds both roads, the sample only the through road's end
    const box: [number, number, number, number] = [39.1, -84.45, 39.11, -84.4];
    expect(tilePolylines(bytes(), box, [[39.1, -84.45]]).map((p) => p.cls)).toEqual([3]);
    expect(tilePolylines(bytes(), box, [[39.3, -84.2]])).toEqual([]);
  });

  it("passes a loop on the through road, refuses one off the roads or on the lane", async () => {
    const road = await loopOnRoads(outAndBack([39.1001, -84.449], [39.0999, -84.401]), load);
    expect([road.checked, road.ok, road.off, road.minor]).toEqual([true, true, 0, 0]);
    const field = await loopOnRoads(outAndBack([39.105, -84.449], [39.105, -84.401]), load);   // 550 m north, across fields
    expect([field.checked, field.ok, field.off >= field.samples - 2]).toEqual([true, false, true]);   // all but where it crosses the lane
    const lane = await loopOnRoads(outAndBack([39.1003, -84.42], [39.11, -84.42]), load);
    expect([lane.checked, lane.ok, lane.minor > lane.samples / 2]).toEqual([true, false, true]);
  });

  it("doesn't refuse what it can't check", async () => {
    const r = await loopOnRoads(outAndBack([40.5, -83.0], [40.5, -82.95]), load);
    expect([r.checked, r.ok, r.samples]).toEqual([false, true, 0]);
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it("the Worker reads tiles through the region relay and answers 400 not_on_roads", async () => {
    const fetcher = (async (url: string) => {
      const u = String(url);
      if (u.endsWith("/index.json")) return new Response(JSON.stringify({ build: "t1", tiles: { "382_516": {} } }));
      if (u.includes("/382_516.vgr")) return new Response(bytes());
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const env = {} as Env;
    await expect(requireOnRoads(env, outAndBack([39.1001, -84.449], [39.0999, -84.401]), fetcher)).resolves.toMatchObject({ checked: true, ok: true });
    await expect(requireOnRoads(env, outAndBack([39.105, -84.449], [39.105, -84.401]), fetcher)).rejects.toMatchObject({ status: 400, message: "not_on_roads" });
    const none = (async () => new Response(null, { status: 502 })) as unknown as typeof fetch;
    // a fresh index would be cached at the edge; here the relay is down for a place no index lists
    await expect(requireOnRoads(env, outAndBack([40.5, -83.0], [40.5, -82.95]), none)).resolves.toMatchObject({ checked: false });
  });
});
