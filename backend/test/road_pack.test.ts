import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAM_V, mergeBin, type Bin } from "../src/contribute";
import { BIN_COLUMNS, mergeBinRow, type BinRow } from "../src/road_pack";
import m68 from "../migrations/0068_road_chunks.sql?raw";
import { api, freshDb, makeUser, ok, splitSql } from "./helpers";

beforeEach(freshDb);
const restore: Array<() => void> = [];
afterEach(() => { while (restore.length) restore.pop()!(); });

// the old per-bin table, as it was before 0068 (0070 dropped it): the SQL merge's reference table and the backfill's source
const LEGACY = `CREATE TABLE IF NOT EXISTS road_bins_legacy (way_id INTEGER NOT NULL, dir INTEGER NOT NULL, bin_idx INTEGER NOT NULL, n INTEGER NOT NULL,
  camber_mean REAL, camber_m2 REAL, rough_mean REAL, rough_m2 REAL, crest_peak REAL, camber_n INTEGER NOT NULL DEFAULT 0, crest_n INTEGER NOT NULL DEFAULT 0,
  last_on TEXT, changed_on TEXT, smooth_run INTEGER NOT NULL DEFAULT 0, k_mean REAL, k_n INTEGER NOT NULL DEFAULT 0, flow_mean REAL, brake_mean REAL,
  flow_n INTEGER NOT NULL DEFAULT 0, bump_hit REAL NOT NULL DEFAULT 0, bump_pass REAL NOT NULL DEFAULT 0, bump_drivers INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (way_id, dir, bin_idx)) WITHOUT ROWID`;
beforeEach(async () => { await env.DB.prepare(LEGACY).run(); });
afterEach(async () => { await env.DB.prepare("DROP TABLE IF EXISTS road_bins_legacy").run(); });

// a small seeded generator, so a failure names the case it came from
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

describe("road bin merge in the Worker (step 1 of packing road data)", () => {
  it("gives exactly what the SQL merge gives, pass after pass, nulls, repaving and 20+ passes included", async () => {
    let checked = 0, repaved = 0, past = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const r = rng(seed), way = 900000 + seed, steady = seed % 3 === 0, passes = steady ? 30 : 6 + Math.floor(r() * 24);   // steady: never repaved, past the memory cap
      let ts: BinRow | null = null;
      for (let p = 0; p < passes; p++) {
        const pick = <T,>(x: T, chance = 0.25): T | null => (r() < chance ? null : x);
        // rough mostly steady, sometimes a much smoother pass (repaving needs two in a row)
        const rough = !steady && r() < 0.15 ? 0.02 + r() * 0.02 : 0.15 + r() * 0.2;
        const fl = pick(Math.round(r() * 1000) / 1000, 0.4);
        const b: Bin = { i: 7, cam: pick((r() - 0.5) * 12), rough, crest: pick(r() * 0.4), k: pick((r() - 0.5) * 0.04),
          fl, hb: fl === null ? null : (r() < 0.2 ? 1 : 0), bp: r() < 0.3 ? null : (r() < 0.3 ? 1 : 0) };
        const day = `2026-${String(1 + Math.floor(p / 4) % 12).padStart(2, "0")}-${String(1 + (p * 3) % 27).padStart(2, "0")}`;
        await env.DB.batch([mergeBin(env, way, 0, b, day)]);
        ts = mergeBinRow(ts, b, day);
        const sql = (await env.DB.prepare(`SELECT ${BIN_COLUMNS.join(", ")} FROM road_bins_legacy WHERE way_id = ? AND dir = 0 AND bin_idx = 7`).bind(way).first<BinRow>())!;
        for (const c of BIN_COLUMNS) {
          const a = sql[c], t = ts[c];
          if (typeof a === "number" && typeof t === "number") expect(t, `seed ${seed} pass ${p} ${c}`).toBeCloseTo(a, 12);
          else expect(t, `seed ${seed} pass ${p} ${c}`).toBe(a);
        }
        checked++; if (ts.changed_on === day) repaved++; if (ts.n > 20) past++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(repaved, "a repaving reset came up").toBeGreaterThan(0);
    expect(past, "bins past FRESH.memory passes came up").toBeGreaterThan(0);
  });
});

describe("packed road data (migration 0068)", () => {
  it("moves the old per-bin rows into chunks without changing a single value", async () => {
    // the migration's own backfill, run on varied rows: nulls, bins over several chunks, both directions, far-apart indexes
    const r = rng(68), st: D1PreparedStatement[] = [];
    const v = (x: number, chance = 0.2) => (r() < chance ? null : x);
    for (const [way, dir, idx] of [[5, 0, [0, 1, 2, 127, 128, 129, 300, 1999]], [5, 1, [3, 4]], [8, 0, [255, 256, 1024]]] as const) {
      for (const i of idx) {
        st.push(env.DB.prepare(`INSERT INTO road_bins_legacy (way_id, dir, bin_idx, ${BIN_COLUMNS.join(", ")}) VALUES (?, ?, ?, ${BIN_COLUMNS.map(() => "?").join(", ")})`)
          .bind(way, dir, i, 1 + Math.floor(r() * 40), v((r() - 0.5) * 9.123456789012345), v(r() * 3.3e-3), Math.floor(r() * 9), r() * 0.987654321098765, v(r() * 1.234e-4),
            v(r() * 0.4), Math.floor(r() * 9), "2026-11-0" + (1 + Math.floor(r() * 9)), r() < 0.5 ? "2026-10-12" : null, Math.floor(r() * 2), v(r() * 0.0123456789),
            Math.floor(r() * 9), v(r()), v(r() * 0.3), Math.floor(r() * 9), r() * 7.77, r() * 9.99, Math.floor(r() * 5)));
      }
    }
    await env.DB.batch([env.DB.prepare("DELETE FROM road_chunks"), ...st]);
    const backfill = splitSql(m68).find((x) => x.startsWith("INSERT INTO road_chunks"))!;
    await env.DB.prepare(backfill).run();
    const cols = ["way_id", "dir", "bin_idx", ...BIN_COLUMNS].join(", "), order = " ORDER BY way_id, dir, bin_idx";
    const before = (await env.DB.prepare(`SELECT ${cols} FROM road_bins_legacy${order}`).all()).results;
    const after = (await env.DB.prepare(`SELECT ${cols} FROM road_bins${order}`).all()).results;
    expect(after.length).toBe(13);
    expect(after).toEqual(before);                                                              // every value, exactly
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM road_chunks").first<{ n: number }>())!.n).toBe(8);                 // 0-127, 128-255, 256-383, 1920-2047 | 0-127 | 128-255, 256-383, 1024-1151
  });

  it("writes a few rows a km instead of one a bin", async () => {
    const u = await makeUser("alice");
    await env.DB.prepare("UPDATE members SET contribute = 1 WHERE user_id = ?").bind(u.id).run();
    const bins = Array.from({ length: 400 }, (_, j) => ({ i: j, cam: 1.5, rough: 0.05, crest: 0.1, k: 0.01 }));
    let written = 0;
    const db = env.DB;
    env.DB = new Proxy(db, { get(t, p) {
      if (p === "batch") return async (s: D1PreparedStatement[]) => { const res = await t.batch(s); for (const x of res) written += x.meta.rows_written; return res; };
      const f = Reflect.get(t, p); return typeof f === "function" ? f.bind(t) : f;
    } });
    restore.push(() => { env.DB = db; });
    await ok(api(u, "POST", "/api/contribute", { way_id: 4321, dir: 0, driven_on: new Date().toISOString().slice(0, 10), drive_id: "drive-pack-0001", bins, cam_v: CAM_V }));
    // 2 km: 4 chunks, plus the receipt, slots, floor, counts and points; a row per bin was over 400
    expect(written).toBeLessThan(30);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM road_bins WHERE way_id = 4321").first<{ n: number }>())!.n).toBe(400);
  });

  it("two uploads on the same stretch at once: the one that read an older chunk merges again, nothing is lost", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    for (const u of [a, b]) await env.DB.prepare("UPDATE members SET contribute = 1 WHERE user_id = ?").bind(u.id).run();
    const day = new Date().toISOString().slice(0, 10), bins = Array.from({ length: 60 }, (_, j) => ({ i: j, cam: 1, rough: 0.1, crest: 0.1, k: 0.01 }));
    const post = (u: typeof a, id: string) => api(u, "POST", "/api/contribute", { way_id: 77, dir: 0, driven_on: day, drive_id: id, bins, cam_v: CAM_V });
    await ok(post(a, "drive-race-0001"));
    // bob's batch: just before it runs, alice's next drive writes the same chunk (its ver moves on)
    const db = env.DB;
    let raced = false, tries = 0;
    env.DB = new Proxy(db, { get(t, p) {
      if (p === "batch") return async (s: D1PreparedStatement[]) => {
        if (s.length > 3) tries++;
        if (!raced && s.length > 3) { raced = true; await t.prepare("UPDATE road_chunks SET ver = ver + 1 WHERE way_id = 77").run(); }
        return t.batch(s);
      };
      const f = Reflect.get(t, p); return typeof f === "function" ? f.bind(t) : f;
    } });
    restore.push(() => { env.DB = db; });
    await ok(post(b, "drive-race-0002"));
    expect(tries).toBe(2);                                                                      // refused once, merged again
    expect((await env.DB.prepare("SELECT n FROM road_bins WHERE way_id = 77 AND bin_idx = 10").first<{ n: number }>())!.n).toBe(2);
  });
});
