// Service check (src/service_check.ts, web/service_check.js): only the owner sends or reads one; each result is counted
// per day in error_counts (kind 'service') with the latest detail; the Worker's own side names config, never a value.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { api, freshDb, makeUser } from "./helpers";
import { dailyServerCheck, parseReport, serverSide } from "../src/service_check";

beforeEach(freshDb);

const run = (state: string, detail = "") => ({ app: "ios", version: "1.0", build: "384", online: true,
  results: [{ id: "api", state: "up", http: 200, ms: 120, detail: "" }, { id: "overpass_de", state, http: state === "down" ? 504 : 200, ms: 9000, detail }] });

describe("service check", () => {
  it("keeps the owner's results per service and state, the latest detail on top", async () => {
    const owner = await makeUser("owner");
    expect((await api(owner, "POST", "/api/ops/service-check", run("down", "HTTP 504"))).status).toBe(200);
    expect((await api(owner, "POST", "/api/ops/service-check", run("down", "timed out"))).status).toBe(200);
    expect((await api(owner, "POST", "/api/ops/service-check", run("up"))).status).toBe(200);
    const rows = (await env.DB.prepare("SELECT source, message, n, stack FROM error_counts WHERE kind = 'service' ORDER BY message").all<{ source: string; message: string; n: number; stack: string }>()).results;
    expect(rows.map((r) => [r.source, r.message, r.n])).toEqual([["ios", "api: up", 3], ["ios", "overpass_de: down", 2], ["ios", "overpass_de: up", 1]]);
    expect(JSON.parse(rows[1].stack)).toMatchObject({ http: 504, ms: 9000, detail: "timed out", version: "1.0", build: "384", online: true });
    const h = (await (await api(owner, "GET", "/api/ops/service-check?days=2")).json()) as { rows: { id: string; state: string; n: number; last: { detail: string } }[] };
    expect(h.rows.find((r) => r.id === "overpass_de" && r.state === "down")).toMatchObject({ n: 2, last: { detail: "timed out" } });
  });

  it("is the owner's only: anyone else, or signed out, gets nothing and keeps nothing", async () => {
    const someone = await makeUser("someone");
    expect((await api(someone, "POST", "/api/ops/service-check", run("down"))).status).toBe(404);
    expect((await api(someone, "GET", "/api/ops/service-check")).status).toBe(404);
    expect((await api(someone, "GET", "/api/ops/service-check/server")).status).toBe(404);
    expect((await api(null, "POST", "/api/ops/service-check", run("down"))).status).toBe(401);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM error_counts WHERE kind = 'service'").first<{ n: number }>())!.n).toBe(0);
  });

  it("refuses a malformed report and scrubs the detail", () => {
    for (const b of [{ app: "android", results: [{ id: "api", state: "up" }] }, { app: "ios", results: [] }, { app: "ios", results: [{ id: "API!", state: "up" }] },
                     { app: "ios", results: [{ id: "api", state: "fine" }] }, { app: "ios", results: Array(61).fill({ id: "api", state: "up" }) }])
      expect(() => parseReport(b)).toThrow();
    const r = parseReport({ app: "web", results: [{ id: "valhalla", state: "down", http: 502.5, ms: -4, detail: "at https://x.test/a?lat=39.103 me@x.com" }] });
    expect(r.results[0]).toEqual({ id: "valhalla", state: "down", http: null, ms: 0, detail: "at https://x.test/a [email]" });
  });

  it("the Worker's own side says what is set, never a value, and asks its upstreams", async () => {
    const seen: string[] = [];
    const fake = (async (u: string | URL | Request) => {
      const url = String(u instanceof Request ? u.url : u); seen.push(new URL(url).host);
      if (url.includes("githubusercontent")) return new Response(JSON.stringify({ tiles: { a: 1, b: 2 } }));
      if (url.includes("kumi")) return new Response("busy", { status: 429 });
      return new Response(JSON.stringify({ elements: [{}, {}, {}] }));
    }) as typeof fetch;
    const s = await serverSide(env as never, fake);
    expect(s.db).toBe(true);
    expect(Object.values(s.config).every((v) => typeof v === "boolean")).toBe(true);
    expect(s.graph_data).toMatchObject({ http: 200, tiles: 2 });
    expect(s.overpass.find((o) => o.host === "overpass.kumi.systems")).toMatchObject({ http: 429, elements: null });
    expect(s.overpass.find((o) => o.host === "overpass-api.de")).toMatchObject({ http: 200, elements: 3 });
    expect(seen).toContain("raw.githubusercontent.com");
  });

  it("the daily cron keeps the Worker's own side as source 'server', with the phone's ids for the same servers", async () => {
    const fake = (async (u: string | URL | Request) => {
      const url = String(u instanceof Request ? u.url : u);
      if (url.includes("githubusercontent")) return new Response(JSON.stringify({ tiles: { a: 1 } }));
      if (url.includes("kumi")) return new Response("busy", { status: 504 });
      return new Response(JSON.stringify({ elements: [{}] }));
    }) as typeof fetch;
    const r = await dailyServerCheck(env as never, fake);
    expect(r!.find((x) => x.id === "srv_overpass_kumi")).toMatchObject({ state: "down", http: 504, detail: "HTTP 504" });
    expect(r!.find((x) => x.id === "srv_overpass_de")).toMatchObject({ state: "up", detail: "1 features" });
    expect(r!.find((x) => x.id === "srv_graph_data")).toMatchObject({ state: "up", detail: "1 tiles" });
    const rows = (await env.DB.prepare("SELECT source, message FROM error_counts WHERE kind = 'service' ORDER BY message").all<{ source: string; message: string }>()).results;
    expect(rows.every((x) => x.source === "server")).toBe(true);
    expect(rows.map((x) => x.message)).toContain("srv_db: up");
    expect(await dailyServerCheck({ ...env, DB: undefined } as never, fake)).toBeNull();   // never throws
  });
});
