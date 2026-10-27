import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS, validateContribution } from "../src/contribute";
import { api, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);
const dbRestorers: Array<() => void> = [];
afterEach(() => { while (dbRestorers.length) dbRestorers.pop()!(); });

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const bins = (n = 60, start = 0) => Array.from({ length: n }, (_, j) => ({ i: start + j, cam: 1.5, rough: 0.05, crest: 0.1, k: 0.01 }));
const upload = (over: Record<string, unknown> = {}) => ({ way_id: 123456, dir: 0, driven_on: today(), drive_id: "drive-aaaa-0001", bins: bins(), ...over });

function injectBatchFailure(error: Error, commitThenFail = false): void {
  const db = env.DB;
  let fail = true;
  env.DB = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "batch") return Reflect.get(target, prop, receiver);
      return async (statements: D1PreparedStatement[]) => {
        if (fail) {
          fail = false;
          if (commitThenFail) await target.batch(statements);
          else {
            try { await target.batch([...statements, target.prepare("SELECT * FROM missing_contribution_test_table")]); }
            catch { throw error; }
          }
          throw error;
        }
        return target.batch(statements);
      };
    },
  });
  dbRestorers.push(() => { env.DB = db; });
}

function injectReceiptLookupFailure(failOnRead = 2): () => number {
  const db = env.DB;
  let reads = 0;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
    get(target, key) {
      if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
      if (key === "first") return async () => {
        reads++;
        if (reads === failOnRead) throw new Error("private db diagnostic");
        return target.first();
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  env.DB = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "prepare") return Reflect.get(target, prop, receiver);
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.startsWith("SELECT 1 FROM seen WHERE h = ?")) return statement;
        return wrap(statement);
      };
    },
  });
  dbRestorers.push(() => { env.DB = db; });
  return () => reads;
}

describe("validateContribution (pure rules)", () => {
  it("accepts unknown curvature as null but still rejects an impossible one", () => {
    expect(validateContribution(upload({ bins: bins().map((x) => ({ ...x, k: null })) })).bins.every((x) => x.k === null)).toBe(true);
    expect(() => validateContribution(upload({ bins: bins().map((x) => ({ ...x, k: 0.5 })) }))).toThrow("bad_curvature");
  });

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
    ["missing drive id", { drive_id: undefined }],
    ["drive id with odd characters", { drive_id: "drop table;" }],
    ["a number as a bin", { bins: [...Array(30).fill(1)] }],
  ])("rejects %s", (_name, over) => {
    expect(() => validateContribution(upload(over))).toThrow();
  });

  it("accepts a camber the phone could not measure (null) and bins uploaded out of order", () => {
    const shuffled = bins().reverse().map((b, i) => (i % 7 === 0 ? { ...b, cam: null } : b));
    expect(validateContribution(upload({ bins: shuffled })).bins).toHaveLength(60);
  });
});

const q = async <T>(sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).first<T>())!;
const ledger = async (u: string) => (await q<{ s: number }>("SELECT COALESCE(SUM(octane), 0) AS s FROM points_ledger WHERE user_id = ?", u)).s;
const optIn = async (...us: { id: string }[]) => { for (const u of us) await env.DB.prepare("UPDATE members SET contribute = 1 WHERE user_id = ?").bind(u.id).run(); };
const post = (u: Parameters<typeof api>[0], over: Record<string, unknown> = {}) => api(u, "POST", "/api/contribute", upload(over));

describe("POST /api/contribute (real time)", () => {
  it("is off until the member opts in, and members only", async () => {
    const [m, out] = [await makeUser("alice"), await makeUser("outsider", false)];
    expect((await post(m)).status).toBe(403);
    expect((await post(out)).status).toBe(403);
    await ok(api(m, "PUT", "/api/me/contribute", { on: true }));
    expect((await post(m)).status).toBe(202);
  });

  it("merges immediately and pays immediately, nothing waits", async () => {
    const a = await makeUser("alice"); await optIn(a);
    expect(await (await ok(post(a))).json()).toEqual({ accepted: true, bins: 60 });
    expect((await q<{ n: number }>("SELECT COUNT(*) AS n FROM road_bins")).n).toBe(60);
    expect(await ledger(a.id)).toBeCloseTo(0.3 * 3);                                  // 60 bins x 5 m = 0.3 km, first person on the road = 3x
  });

  it("pays 3x, 2x, then 1x in order of arrival, and a person never holds both slots", async () => {
    const [a, b, c, d] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol"), await makeUser("dave")]; await optIn(a, b, c, d);
    await ok(post(a, { drive_id: "drive-alice-1" })); await ok(post(b, { drive_id: "drive-bob-001" })); await ok(post(c, { drive_id: "drive-carol-01" })); await ok(post(d, { drive_id: "drive-dave-001" }));
    expect([await ledger(a.id), await ledger(b.id), await ledger(c.id), await ledger(d.id)].map((x) => Math.round(x * 100) / 100)).toEqual([0.9, 0.6, 0.3, 0.3]);
    const slots = (await env.DB.prepare("SELECT slot, user_id FROM rank_slots ORDER BY slot").all<{ slot: number; user_id: string | null }>()).results;
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.user_id === null)).toBe(true);                         // who held a slot is not stored in readable form
  });

  it("opposite directions and different roads rank separately", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")]; await optIn(a, b);
    await ok(post(a)); await ok(post(b, { dir: 1, drive_id: "drive-bob-001" })); await ok(post(b, { way_id: 777, drive_id: "drive-bob-001" }));
    expect(Math.round((await ledger(b.id)) * 100) / 100).toBe(1.8);                    // 3x on each of two roads where b was first
  });

  it("a drive streamed as several chunks keeps its multiplier; a later drive on the same road merges data but pays nothing", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")]; await optIn(a, b);
    await ok(post(b, { drive_id: "drive-bob-001", bins: bins(40, 0) }));              // b is first
    await ok(post(a, { drive_id: "drive-alice-1", bins: bins(40, 0) }));              // a is second: 2x
    await ok(post(a, { drive_id: "drive-alice-1", bins: bins(40, 40) }));             // same drive, next chunk: still 2x
    expect(Math.round((await ledger(a.id)) * 100) / 100).toBe(0.4 + 0.4);            // (40 + 40 bins) x 5 m x 2
    await ok(post(a, { drive_id: "drive-alice-2", bins: bins(40, 100) }));            // another day, same road: data yes, points no
    expect(Math.round((await ledger(a.id)) * 100) / 100).toBe(0.8);
    expect((await q<{ n: number }>("SELECT n FROM road_bins WHERE bin_idx = 120")).n).toBe(1);
    expect((await q<{ n: number }>("SELECT n FROM road_bins WHERE bin_idx = 10")).n).toBe(2);   // two people covered bin 10
  });

  it("a retried chunk is acknowledged but merged and paid once", async () => {
    const a = await makeUser("alice"); await optIn(a);
    await ok(post(a)); const again = await (await ok(post(a))).json() as { duplicate?: boolean };
    expect(again.duplicate).toBe(true);
    expect((await q<{ n: number }>("SELECT n FROM road_bins WHERE bin_idx = 3")).n).toBe(1);
    expect(await ledger(a.id)).toBeCloseTo(0.9);
  });

  it("does not acknowledge a rolled back batch; a later retry commits the queued data", async () => {
    const a = await makeUser("alice"); await optIn(a);
    injectBatchFailure(new Error("sensitive database detail"));
    const failed = await post(a);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("sensitive database detail");
    expect((await q<{ n: number }>("SELECT COUNT(*) AS n FROM road_bins")).n).toBe(0);
    expect(await ledger(a.id)).toBe(0);

    const retried = await ok(post(a));
    expect(await retried.json()).toEqual({ accepted: true, bins: 60 });
    expect((await q<{ n: number }>("SELECT n FROM road_bins WHERE bin_idx = 3")).n).toBe(1);
    expect(await ledger(a.id)).toBeCloseTo(0.9);
  });

  it("acknowledges a racing retry only when the receipt exists, without a second merge or payment", async () => {
    const a = await makeUser("alice"); await optIn(a);
    injectBatchFailure(new Error("parallel acknowledgement race"), true);
    const raced = await ok(post(a));
    expect(await raced.json()).toEqual({ accepted: true, bins: 60, duplicate: true });
    expect((await q<{ n: number }>("SELECT n FROM road_bins WHERE bin_idx = 3")).n).toBe(1);
    expect(await ledger(a.id)).toBeCloseTo(0.9);
  });

  it("does not acknowledge when receipt lookup fails after the batch error", async () => {
    const a = await makeUser("alice"); await optIn(a);
    const db = env.DB;
    injectBatchFailure(new Error("batch failure"));
    const receiptReads = injectReceiptLookupFailure();
    const failed = await post(a);
    expect(failed.status).toBe(503);
    expect(receiptReads()).toBe(2);
    expect(await failed.text()).not.toContain("private db diagnostic");
    env.DB = db;
    expect((await q<{ n: number }>("SELECT COUNT(*) AS n FROM road_bins")).n).toBe(0);
  });

  it("returns a sanitized retryable error when the initial receipt lookup fails", async () => {
    const member = await makeUser("alice"); await optIn(member);
    const receiptReads = injectReceiptLookupFailure(1);
    const failed = await post(member);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "contribution_temporarily_unavailable" });
    expect(receiptReads()).toBe(1);
    expect((await q<{ n: number }>("SELECT COUNT(*) AS n FROM road_bins")).n).toBe(0);
  });

  it("merges and rewards concurrent identical requests only once", async () => {
    const member = await makeUser("alice"); await optIn(member);
    const responses = await Promise.all([post(member), post(member)]);
    expect(responses.map(response => response.status)).toEqual([202, 202]);
    const bodies = await Promise.all(responses.map(response => response.json() as Promise<{ duplicate?: boolean }>));
    expect(bodies.filter(body => body.duplicate)).toHaveLength(1);
    expect((await q<{ n: number }>("SELECT n FROM road_bins WHERE bin_idx = 3")).n).toBe(1);
    expect(await ledger(member.id)).toBeCloseTo(0.9);
  });

  it("keeps a correct running mean and variance across contributions", async () => {
    const people = [await makeUser("p1"), await makeUser("p2"), await makeUser("p3")]; await optIn(...people);
    const roughs = [0.10, 0.20, 0.60], cams = [2, 4, null];
    for (let k = 0; k < 3; k++) await ok(post(people[k], { drive_id: `drive-person-${k}`, bins: bins().map((b) => ({ ...b, rough: roughs[k], cam: cams[k], crest: k + 1 })) }));
    const r = await q<{ n: number; rough_mean: number; rough_m2: number; camber_mean: number; camber_n: number; crest_peak: number }>("SELECT n, rough_mean, rough_m2, camber_mean, camber_n, crest_peak FROM road_bins WHERE bin_idx = 7");
    expect(r.n).toBe(3);
    expect(r.rough_mean).toBeCloseTo((0.1 + 0.2 + 0.6) / 3);
    expect(r.rough_m2).toBeCloseTo([0.1, 0.2, 0.6].reduce((s, x) => s + (x - 0.3) ** 2, 0));
    expect(r.camber_n).toBe(2); expect(r.camber_mean).toBeCloseTo(3);                  // the third pass had no camber: unknown stays unknown
    expect(r.crest_peak).toBeCloseTo(2);
  });

  it("a missing crest stays unknown and never erases a measured one", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")]; await optIn(a, b);
    await ok(post(a, { drive_id: "drive-alice-1", bins: bins().map((x) => ({ ...x, crest: null })) }));
    expect((await q<{ crest_peak: number | null }>("SELECT crest_peak FROM road_bins WHERE bin_idx = 5")).crest_peak).toBeNull();
    await ok(post(b, { drive_id: "drive-bob-001", bins: bins().map((x) => ({ ...x, crest: 0.5 })) }));
    expect((await q<{ crest_peak: number }>("SELECT crest_peak FROM road_bins WHERE bin_idx = 5")).crest_peak).toBeCloseTo(0.5);
    const c = await makeUser("carol"); await optIn(c);
    await ok(post(c, { drive_id: "drive-carol-01", bins: bins().map((x) => ({ ...x, crest: null })) }));
    expect((await q<{ crest_peak: number; n: number }>("SELECT crest_peak, n FROM road_bins WHERE bin_idx = 5"))).toMatchObject({ n: 3 });
    expect((await q<{ crest_peak: number }>("SELECT crest_peak FROM road_bins WHERE bin_idx = 5")).crest_peak).toBeCloseTo(0.5);
  });

  it("stores no coordinates, times or user ids with the road numbers", async () => {
    const a = await makeUser("alice"); await optIn(a); await ok(post(a));
    const rows = JSON.stringify((await env.DB.prepare("SELECT * FROM road_bins").all()).results);
    expect(rows).not.toMatch(/alice|lat|lon|user/);
    const seen = (await env.DB.prepare("SELECT h FROM seen").all<{ h: ArrayBuffer }>()).results;
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Uint8Array(seen[0].h)).toHaveLength(32);
  });

  it("enforces the daily kilometre cap and the hourly upload cap", async () => {
    const a = await makeUser("alice"); await optIn(a);
    const hour = new Date().toISOString().slice(0, 13);
    await env.DB.prepare("INSERT INTO upload_counts (user_id, bucket, uploads, km) VALUES (?, ?, 1, 599.9)").bind(a.id, hour).run();
    expect((await post(a)).status).toBe(429);
    await env.DB.prepare("UPDATE upload_counts SET km = 1, uploads = ?").bind(LIMITS.uploadsPerHour).run();
    expect((await post(a, { way_id: 7 })).status).toBe(429);
  });

  it("opting out is honoured immediately", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "PUT", "/api/me/contribute", { on: true })); await ok(api(a, "PUT", "/api/me/contribute", { on: false }));
    expect((await post(a)).status).toBe(403);
  });
});
