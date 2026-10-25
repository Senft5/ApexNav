// Highlights: scenic points added by members and rated 1-5. Never shows who added one. See docs/BACKEND.md section 9.
import { Env, HttpError, body, int, num, str } from "./util";
import type { Viewer } from "./auth";

const CATEGORIES = new Set(["overlook", "bridge", "cafe", "trailhead", "landmark", "water", "photo", "other"]);
const PER_DAY = 10, PER_USER = 200, HIDE_AFTER_REPORTS = 3, DUPLICATE_M = 40;
const first = <T>(env: Env, sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).first<T>();
const all = async <T>(env: Env, sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).all<T>()).results;

const metres = (aLat: number, aLon: number, bLat: number, bLon: number) =>
  Math.hypot((aLat - bLat) * 111_320, (aLon - bLon) * 111_320 * Math.cos((aLat * Math.PI) / 180));

export async function highlightCreate(env: Env, v: Viewer, req: Request): Promise<{ id: string }> {
  const b = await body<Record<string, unknown>>(req);
  const name = str(b.name, "name", 2, 60);
  const category = typeof b.category === "string" && CATEGORIES.has(b.category) ? b.category : (() => { throw new HttpError(400, "bad_category"); })();
  const note = b.note == null ? null : str(b.note, "note", 1, 280);
  const lat = num(b.lat, "lat", 15, 72), lon = num(b.lon, "lon", -180, -60);          // United States only for now
  const today = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM highlights WHERE author_id = ? AND created_at > datetime('now', '-1 day')", v.id);
  if ((today?.n ?? 0) >= PER_DAY) throw new HttpError(429, "daily_limit");
  const total = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM highlights WHERE author_id = ?", v.id);
  if ((total?.n ?? 0) >= PER_USER) throw new HttpError(429, "too_many_highlights");
  const near = await all<{ id: string; lat: number; lon: number }>(env,
    "SELECT id, lat, lon FROM highlights WHERE status = 'active' AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?", lat - 0.001, lat + 0.001, lon - 0.0015, lon + 0.0015);
  const dup = near.find((h) => metres(lat, lon, h.lat, h.lon) <= DUPLICATE_M);
  if (dup) throw new HttpError(409, "already_exists");           // rate that one instead
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO highlights (id, author_id, name, category, note, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, v.id, name, category, note, lat, lon).run();
  return { id };
}

/** Bounding-box lookup: the phone sends the box around its route and filters by distance itself. */
export async function highlightList(env: Env, v: Viewer, url: URL) {
  const raw = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (raw.length !== 4 || raw.some((x) => !Number.isFinite(x))) throw new HttpError(400, "bad_bbox");
  const [minLat, minLon, maxLat, maxLon] = raw;
  if (minLat >= maxLat || minLon >= maxLon || maxLat - minLat > 3 || maxLon - minLon > 3) throw new HttpError(400, "bad_bbox");
  // rating shrinks toward 3 stars (prior weight 2) so one enthusiastic account cannot pin a spot at 5.0
  return all(env,
    `SELECT h.id, h.name, h.category, h.note, h.lat, h.lon,
            COUNT(r.user_id) AS ratings, ROUND((COALESCE(SUM(r.stars), 0) + 6.0) / (COUNT(r.user_id) + 2), 2) AS score,
            SUM(CASE WHEN r.visited = 1 THEN 1 ELSE 0 END) AS visits,
            (SELECT stars FROM highlight_ratings m WHERE m.highlight_id = h.id AND m.user_id = ?1) AS my_stars,
            (h.author_id = ?1) AS mine
       FROM highlights h LEFT JOIN highlight_ratings r ON r.highlight_id = h.id
      WHERE h.status = 'active' AND h.lat BETWEEN ?2 AND ?4 AND h.lon BETWEEN ?3 AND ?5
      GROUP BY h.id ORDER BY score DESC LIMIT 500`, v.id, minLat, minLon, maxLat, maxLon);
}

export async function highlightRate(env: Env, v: Viewer, id: string, req: Request): Promise<void> {
  const b = await body<{ stars?: number; visited?: boolean }>(req);
  const stars = int(b.stars, "stars", 1, 5);
  const h = await first<{ author_id: string | null }>(env, "SELECT author_id FROM highlights WHERE id = ? AND status = 'active'", id);
  if (!h) throw new HttpError(404, "no_highlight");
  if (h.author_id === v.id) throw new HttpError(403, "cannot_rate_own");
  await env.DB.prepare(
    `INSERT INTO highlight_ratings (highlight_id, user_id, stars, visited) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (highlight_id, user_id) DO UPDATE SET stars = ?3, visited = ?4`,
  ).bind(id, v.id, stars, b.visited === true ? 1 : 0).run();
}

export async function highlightReport(env: Env, v: Viewer, id: string, req: Request): Promise<void> {
  const b = await body<{ note?: string }>(req);
  if (!(await first(env, "SELECT 1 FROM highlights WHERE id = ?", id))) throw new HttpError(404, "no_highlight");
  const done = await first(env, "SELECT 1 FROM reports WHERE reporter = ? AND kind = 'highlight' AND target_id = ?", v.id, id);
  if (!done) {
    await env.DB.prepare("INSERT INTO reports (id, reporter, kind, target_id, note) VALUES (?, ?, 'highlight', ?, ?)")
      .bind(crypto.randomUUID(), v.id, id, b.note ? String(b.note).slice(0, 280) : null).run();
  }
  await env.DB.prepare(
    `UPDATE highlights SET status = 'hidden' WHERE id = ?1
        AND (SELECT COUNT(DISTINCT reporter) FROM reports WHERE kind = 'highlight' AND target_id = ?1) >= ?2`,
  ).bind(id, HIDE_AFTER_REPORTS).run();
}

export async function highlightDelete(env: Env, v: Viewer, id: string): Promise<void> {
  const r = await env.DB.prepare("DELETE FROM highlights WHERE id = ? AND author_id = ?").bind(id, v.id).run();
  if (!r.meta.changes) throw new HttpError(404, "no_highlight");
}
