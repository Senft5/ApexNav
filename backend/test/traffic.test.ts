import { afterEach, describe, expect, it } from "vitest";
import { api } from "./helpers";
import { IN_EVENTS, KY_WZDX, OHGO, parseIndiana, parseOhgo, parseWzdx, trafficEvents } from "../src/traffic";
import inFeed from "./fixtures/traffic_in.json";
import kyFeed from "./fixtures/traffic_ky.json";

const NOW = Date.parse("2026-11-14T03:00:00Z");
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });
const byId = <T extends { id: string }>(rows: T[]): Record<string, T> => Object.fromEntries(rows.map((r) => [r.id, r]));

describe("INDOT CARS events, compacted", () => {
  const rows = byId(parseIndiana(inFeed, NOW));
  it("keeps closures, lanes, roadwork, slow traffic and events, with their road and end", () => {
    expect(rows["dot:IN:CARSy-113"]).toMatchObject({ kind: "closure", label: "Road closed", road: "IN 114", src: "INDOT" });
    expect(rows["dot:IN:CARSy-1935"]).toMatchObject({ kind: "closure" });
    expect(rows["dot:IN:CARSy-1288"]).toMatchObject({ kind: "closed_way", label: "Closed eastbound", road: "I-70", heading: 90 });
    expect(rows["dot:IN:CARSy-113"].heading).toBeUndefined();          // both ways: no heading
    expect(rows["dot:IN:CARSy-1289"]).toMatchObject({ kind: "lane", label: "Lane closed", heading: 270 });
    expect(rows["dot:IN:CARSx-469755"]).toMatchObject({ kind: "lane", label: "Ramp closed" });
    expect(rows["dot:IN:CARSx-328098"]).toMatchObject({ kind: "roadwork", label: "Roadwork", road: "I-65" });
    expect(rows["dot:IN:CARSy-2241"]).toMatchObject({ kind: "slow", label: "Slow traffic" });
    expect(rows["dot:IN:CARSy-3101"]).toBeUndefined();                  // a parade next month: CURRENT in the feed, not begun
    const parade = JSON.parse(JSON.stringify((inFeed as any[]).find((x) => x["event-id"] === "CARSy-3101")));
    parade.details[0]["start-time"].time = NOW - 60000;
    expect(parseIndiana([parade], NOW)[0]).toMatchObject({ kind: "traffic", label: "Parade" });
    const r = rows["dot:IN:CARSy-113"];
    expect(r.lat).toBeCloseTo(40.99913, 4); expect(r.lon).toBeCloseTo(-85.78140, 4);
    expect(typeof r.until).toBe("number");
  });
  it("leaves out truck restrictions and shoulder closures", () => {
    expect(rows["dot:IN:CARSy-10"]).toBeUndefined();
    expect(rows["dot:IN:CARSy-3169"]).toBeUndefined();
  });
  it("leaves out an event that has ended or not begun, and survives junk", () => {
    const e = JSON.parse(JSON.stringify((inFeed as any[]).find((x) => x["event-id"] === "CARSy-113")));
    e.details[0]["end-time"].time = NOW - 1;
    const f = JSON.parse(JSON.stringify(e)); delete f.details[0]["end-time"]; f.details[0]["start-time"].time = NOW + 60000;
    expect(parseIndiana([e, f, null, 7, { status: "CURRENT" }], NOW)).toEqual([]);
    expect(parseIndiana({ nope: 1 }, NOW)).toEqual([]);
  });
});

describe("KYTC WZDx work zones", () => {
  it("keeps current zones at their start, a closed general lane as Lane closed, and drops one that has ended", () => {
    const rows = byId(parseWzdx(kyFeed, NOW, "KY", "KYTC"));
    expect(rows["dot:KY:TRIMARC-292980"]).toMatchObject({ kind: "lane", label: "Lane closed", road: "I-71/75", src: "KYTC", lat: 39.07277, lon: -84.51871 });
    expect(rows["dot:KY:TRIMARC-292104"]).toMatchObject({ kind: "roadwork", label: "Roadwork", road: "I-65" });
    expect(rows["dot:KY:TRIMARC-310577"]).toBeUndefined();
  });
  it("calls all lanes closed one way closed that way", () => {
    const f = JSON.parse(JSON.stringify((kyFeed as any).features[2])); f.properties.vehicle_impact = "all-lanes-closed";
    expect(parseWzdx({ features: [f] }, NOW, "KY", "KYTC")[0]).toMatchObject({ kind: "closed_way" });
  });
});

describe("OHGO (with the owner's free key)", () => {
  it("compacts incidents and construction", () => {
    const rows = parseOhgo({ results: [
      { id: "a1", latitude: 39.96, longitude: -83.0, category: "Crash", roadStatus: "Open", routeName: "I-71" },
      { id: "a2", latitude: 39.9, longitude: -83.1, roadStatus: "Closed", direction: "Both", routeName: "SR 315" },
      { id: "a3", latitude: 39.9, longitude: -83.1, roadStatus: "Lane Closed", routeName: "I-70" },
      { id: "a4", latitude: 0, longitude: 0 },
    ] }, "incident", NOW);
    expect(rows.map((r) => [r.id, r.kind])).toEqual([["dot:OH:a1", "crash"], ["dot:OH:a2", "closure"], ["dot:OH:a3", "lane"]]);
  });
});

describe("GET /api/traffic/v1/events.json", () => {
  it("merges the feeds, says which answered, and needs no sign-in", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push(url);
      if (url === IN_EVENTS) return new Response(JSON.stringify(inFeed));
      if (url === KY_WZDX) return new Response("down", { status: 503 });
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const out = await trafficEvents({} as never, globalThis.fetch, NOW);
    expect(out.sources).toEqual(["INDOT"]); expect(out.failed).toEqual(["KYTC"]);
    expect(out.events.length).toBe(7);
    expect(seen.some((u) => u.startsWith(OHGO))).toBe(false);          // no key, no Ohio
    const r = await api(null, "GET", "/api/traffic/v1/events.json");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    const j = (await r.json()) as { events: unknown[]; sources: string[] };
    expect(j.sources).toEqual(["INDOT"]);
  });
  it("sends Ohio's key only to OHGO, when it is set", async () => {
    const seen: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input); seen.push(url);
      return new Response(JSON.stringify(url.startsWith(OHGO) ? { results: [] } : []));
    }) as typeof fetch;
    const out = await trafficEvents({ CTX_KEYS: JSON.stringify({ ohgoApiKey: "k 1" }) } as never, f, NOW);   // the route context's key slot
    expect(out.sources).toEqual(["INDOT", "KYTC", "ODOT"]);
    expect(seen).toContain(`${OHGO}/incidents?api-key=k%201`);
    expect(seen.filter((u) => u.includes("api-key"))).toHaveLength(2);
    expect((await trafficEvents({ CTX_KEYS: "not json" } as never, f, NOW)).sources).toEqual(["INDOT", "KYTC"]);
  });
});
