import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS, validateContribution } from "../src/contribute";
import { api, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const bins = (n = 60, start = 0) => Array.from({ length: n }, (_, j) => ({ i: start + j, cam: 1.5, rough: 0.05, crest: 0.1, k: 0.01 }));
const upload = (over: Record<string, unknown> = {}) => ({ way_id: 123456, dir: 0, driven_on: today(), bins: bins(), ...over });

describe("validateContribution (pure rules)", () => {
  it("accepts a good run and computes its length", () => {
    const c = validateContribution(upload());
    expect(c.km).toBeCloseTo(0.3);
    expect(c.bins).toHaveLength(60);
  });

  it.each([
    ["driven in the future", { driven_on: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10) }],
    ["older than the 14 day window", { driven_on: daysAgo(20) }],
    ["too few bins", { bins: bins(5) }],
    ["too many bins", { bins: bins(LIMITS.maxBins + 1) }],
    ["camber out of range", { bins: bins().map((b, i) => (i === 3 ? { ...b, cam: 40 } : b)) }],
    ["roughness out of range", { bins: bins().map((b, i) => (i === 3 ? { ...b, rough: 9 } : b)) }],
    ["radius under 5 m", { bins: bins().map((b, i) => (i === 3 ? { ...b, k: 0.5 } : b)) }],
    ["duplicate bin index", { bins: [...bins(), { i: 3, cam: 0, rough: 0, crest: 0, k: 0 }] }],
    ["scattered bins, not a run", { bins: bins(30).map((b, i) => ({ ...b, i: i * 10 })) }],
    ["bad way id", { way_id: -4 }],
    ["bad direction", { dir: 2 }],
    ["a number as a bin", { bins: [...Array(30).fill(1)] }],
  ])("rejects %s", (_name, over) => {
    expect(() => validateContribution(upload(over))).toThrow();
  });

  it("accepts a camber the phone could not measure (null) and bins uploaded out of order", () => {
    const shuffled = bins().reverse().map((b, i) => (i % 7 === 0 ? { ...b, cam: null } : b));
    expect(validateContribution(upload({ bins: shuffled })).bins).toHaveLength(60);
  });
});

describe("POST /api/contribute", () => {
  it("is off until the member opts in, and members only", async () => {
    const [m, out] = [await makeUser("alice"), await makeUser("outsider", false)];
    expect((await api(m, "POST", "/api/contribute", upload())).status).toBe(403);
    expect((await api(out, "POST", "/api/contribute", upload())).status).toBe(403);
    await ok(api(m, "PUT", "/api/me/contribute", { on: true }));
    expect((await api(m, "POST", "/api/contribute", upload())).status).toBe(202);
  });

  it("stages the upload without revealing anything about other contributors, and stores a hash, not who drove", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    for (const u of [a, b]) await ok(api(u, "PUT", "/api/me/contribute", { on: true }));
    const ra = await (await ok(api(a, "POST", "/api/contribute", upload()))).json();
    const rb = await (await ok(api(b, "POST", "/api/contribute", upload()))).json();
    expect(ra).toEqual({ accepted: true, bins: 60 });
    expect(rb).toEqual({ accepted: true, bins: 60 });              // second contributor learns nothing about the first
    const seen = (await env.DB.prepare("SELECT h FROM seen").all<{ h: ArrayBuffer }>()).results;
    expect(seen).toHaveLength(2);
    expect(new Uint8Array(seen[0].h)).toHaveLength(32);
    const pending = await env.DB.prepare("SELECT bins FROM ingest_pending").all<{ bins: string }>();
    expect(JSON.stringify(pending.results)).not.toContain("alice");
  });

  it("allows one contribution per person per road and direction, but another direction or road is fine", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "PUT", "/api/me/contribute", { on: true }));
    await ok(api(a, "POST", "/api/contribute", upload()));
    expect((await api(a, "POST", "/api/contribute", upload())).status).toBe(409);
    expect((await api(a, "POST", "/api/contribute", upload({ dir: 1 }))).status).toBe(202);
    expect((await api(a, "POST", "/api/contribute", upload({ way_id: 999 }))).status).toBe(202);
  });

  it("enforces the daily kilometre cap and the hourly upload cap", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "PUT", "/api/me/contribute", { on: true }));
    await env.DB.prepare("INSERT INTO ingest_pending (user_id, way_id, dir, driven_on, km, bins) VALUES (?, 1, 0, ?, 599.9, '{}')").bind(a.id, today()).run();
    expect((await api(a, "POST", "/api/contribute", upload())).status).toBe(429);
    await env.DB.prepare("DELETE FROM ingest_pending").run();
    for (let i = 0; i < LIMITS.uploadsPerHour; i++) {
      await env.DB.prepare("INSERT INTO ingest_pending (user_id, way_id, dir, driven_on, km, bins) VALUES (?, ?, 0, ?, 0.3, '{}')").bind(a.id, 1000 + i, daysAgo(3)).run();
    }
    expect((await api(a, "POST", "/api/contribute", upload({ way_id: 7 }))).status).toBe(429);
  });

  it("opting out is honoured immediately", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "PUT", "/api/me/contribute", { on: true }));
    await ok(api(a, "PUT", "/api/me/contribute", { on: false }));
    expect((await api(a, "POST", "/api/contribute", upload())).status).toBe(403);
  });
});
