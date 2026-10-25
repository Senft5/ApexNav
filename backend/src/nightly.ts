// Nightly job: ranks contributions, merges them into per-bin road data, and awards points (docs/BACKEND.md section 4).
//
// Why a group waits: the first two contributors to a road+direction get 3x and 2x, ordered by the DAY THEY DROVE, so a phone that
// was offline must still be able to take its place. A (way, direction) group is therefore held in ingest_pending until 14 days
// after the earliest drive in it; then it is ranked, merged, scored and deleted in one atomic batch. rank_slots rows record that
// a group is frozen (with the user cleared: we do not keep who held which slot). Contributions arriving to a frozen group
// are worth 1x and merge on the next run.
import { Env } from "./util";

const FREEZE_DAYS = 14, REPLAY_CORRELATION = 0.98, MIN_OVERLAP = 20;
export const MULTIPLIER = [3, 2] as const;     // then 1

interface Pending { id: number; user_id: string; way_id: number; dir: number; driven_on: string; km: number; bins: string; received_at: string }
interface Packed { i: number[]; cam: (number | null)[]; rough: number[]; crest: number[]; k: number[] }

/** ISO week label like 2026-W43 for a timestamp (UTC). */
export function isoWeek(ms: number): string {
  const d = new Date(ms); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function correlation(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da === 0 || db === 0 ? (da === db && a.every((x, i) => x === b[i]) ? 1 : 0) : num / Math.sqrt(da * db);
}

/** Two accounts uploading near-identical curvature on the same road are one drive replayed; real drives are never identical. */
export function isReplay(a: Packed, b: Packed): boolean {
  const idx = new Map(a.i.map((v, j) => [v, j]));
  const xs: number[] = [], ys: number[] = [];
  b.i.forEach((v, j) => { const ja = idx.get(v); if (ja !== undefined) { xs.push(a.k[ja]); ys.push(b.k[j]); } });
  return xs.length >= MIN_OVERLAP && correlation(xs, ys) > REPLAY_CORRELATION;
}

/** Welford running mean / sum of squared deviations. */
export function mergeStat(n: number, mean: number | null, m2: number | null, x: number): { n: number; mean: number; m2: number } {
  const m = mean ?? 0, s = m2 ?? 0, n2 = n + 1, d = x - m, mean2 = m + d / n2;
  return { n: n2, mean: mean === null ? x : mean2, m2: s + d * (x - mean2) };
}

const parseDay = (d: string) => Date.parse(d + "T00:00:00Z");

export async function nightlyMerge(env: Env, nowMs = Date.now()): Promise<{ groups: number; frozen: number; late: number; quarantined: number }> {
  const rows = (await env.DB.prepare("SELECT id, user_id, way_id, dir, driven_on, km, bins, received_at FROM ingest_pending ORDER BY way_id, dir, driven_on, received_at, id").all<Pending>()).results;
  const groups = new Map<string, Pending[]>();
  for (const r of rows) { const k = `${r.way_id}|${r.dir}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  const week = isoWeek(nowMs);
  const out = { groups: groups.size, frozen: 0, late: 0, quarantined: 0 };

  for (const [key, list] of groups) {
    const [wayId, dir] = key.split("|").map(Number);
    const slotRows = (await env.DB.prepare("SELECT slot FROM rank_slots WHERE way_id = ? AND dir = ?").bind(wayId, dir).all()).results;
    const alreadyFrozen = slotRows.length > 0;
    const earliest = parseDay(list[0].driven_on);
    if (!alreadyFrozen && nowMs < earliest + FREEZE_DAYS * 86400_000) continue;       // still inside the window: leave pending

    // drop replays: keep the earlier contribution, discard the later copy
    const kept: { row: Pending; packed: Packed }[] = [];
    for (const row of list) {
      const packed = JSON.parse(row.bins) as Packed;
      if (kept.some((o) => o.row.user_id !== row.user_id && isReplay(o.packed, packed))) { out.quarantined++; continue; }
      kept.push({ row, packed });
    }

    const stmts: D1PreparedStatement[] = [];
    const points = new Map<string, number>();
    kept.forEach(({ row }, rank) => {
      const mult = alreadyFrozen ? 1 : (MULTIPLIER[rank] ?? 1);
      points.set(row.user_id, (points.get(row.user_id) ?? 0) + row.km * mult);
    });
    if (!alreadyFrozen) {
      kept.slice(0, 2).forEach(({ row }, rank) => stmts.push(
        env.DB.prepare("INSERT INTO rank_slots (way_id, dir, slot, user_id, driven_on) VALUES (?, ?, ?, NULL, ?)").bind(wayId, dir, rank + 1, row.driven_on)));
      out.frozen++;
    } else out.late += kept.length;

    // merge bins: one contribution adds one observation to each bin it covers
    const touched = new Map<number, { n: number; cam: number | null; camM2: number | null; camN: number; rough: number | null; roughM2: number | null; crest: number | null }>();
    const existing = (await env.DB.prepare("SELECT bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak FROM road_bins WHERE way_id = ? AND dir = ?")
      .bind(wayId, dir).all<{ bin_idx: number; n: number; camber_mean: number | null; camber_m2: number | null; camber_n: number; rough_mean: number | null; rough_m2: number | null; crest_peak: number | null }>()).results;
    for (const e of existing) touched.set(e.bin_idx, { n: e.n, cam: e.camber_mean, camM2: e.camber_m2, camN: e.camber_n, rough: e.rough_mean, roughM2: e.rough_m2, crest: e.crest_peak });
    const dirty = new Set<number>();
    for (const { packed } of kept) {
      packed.i.forEach((bin, j) => {
        const b = touched.get(bin) ?? { n: 0, cam: null, camM2: null, camN: 0, rough: null, roughM2: null, crest: null };
        const r = mergeStat(b.n, b.rough, b.roughM2, packed.rough[j]);
        if (packed.cam[j] !== null) { const c = mergeStat(b.camN, b.cam, b.camM2, packed.cam[j] as number); b.cam = c.mean; b.camM2 = c.m2; b.camN = c.n; }
        b.crest = b.crest === null ? packed.crest[j] : b.crest + (packed.crest[j] - b.crest) / (b.n + 1);   // running mean of each pass's crest peak
        b.rough = r.mean; b.roughM2 = r.m2; b.n = r.n;
        touched.set(bin, b); dirty.add(bin);
      });
    }
    for (const bin of dirty) {
      const b = touched.get(bin)!;
      stmts.push(env.DB.prepare(
        `INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT (way_id, dir, bin_idx) DO UPDATE SET n = ?4, camber_mean = ?5, camber_m2 = ?6, camber_n = ?7, rough_mean = ?8, rough_m2 = ?9, crest_peak = ?10`,
      ).bind(wayId, dir, bin, b.n, b.cam, b.camM2, b.camN, b.rough, b.roughM2, b.crest));
    }
    for (const [user, pts] of points) {
      stmts.push(env.DB.prepare(
        "INSERT INTO points_ledger (user_id, iso_week, octane) VALUES (?1, ?2, ?3) ON CONFLICT (user_id, iso_week) DO UPDATE SET octane = octane + ?3",
      ).bind(user, week, pts));
    }
    stmts.push(env.DB.prepare("DELETE FROM ingest_pending WHERE way_id = ? AND dir = ? AND id <= ?").bind(wayId, dir, list[list.length - 1].id));
    await env.DB.batch(stmts);
  }
  return out;
}

/** Totals only: mine, and a board of handle + total. Who was first is never exposed. */
export async function pointsFor(env: Env, userId: string) {
  const mine = await env.DB.prepare("SELECT iso_week AS week, ROUND(octane, 2) AS octane FROM points_ledger WHERE user_id = ? ORDER BY iso_week DESC LIMIT 26").bind(userId).all<{ week: string; octane: number }>();
  const board = await env.DB.prepare(
    `SELECT u.handle, ROUND(SUM(p.octane), 2) AS total FROM points_ledger p JOIN users u ON u.id = p.user_id JOIN members m ON m.user_id = u.id
      WHERE u.handle IS NOT NULL GROUP BY p.user_id ORDER BY total DESC LIMIT 50`).all<{ handle: string; total: number }>();
  const total = mine.results.reduce((s, r) => s + r.octane, 0);
  return { total: Math.round(total * 100) / 100, weeks: mine.results, board: board.results };
}
