import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { mergeBin, type Bin } from "../src/contribute";
import { BIN_COLUMNS, mergeBinRow, type BinRow } from "../src/road_pack";
import { freshDb } from "./helpers";

beforeEach(freshDb);

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
        const sql = (await env.DB.prepare(`SELECT ${BIN_COLUMNS.join(", ")} FROM road_bins WHERE way_id = ? AND dir = 0 AND bin_idx = 7`).bind(way).first<BinRow>())!;
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
