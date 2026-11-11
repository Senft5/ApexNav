// Roadbooks (docs/SOCIAL.md 2.6, migration 0046): a member's collection of great roads. Private by default, shown to
// friends, or public: found near you, followed, opened by its link with no account. A road is a planned shape with a name
// and a note, never a recorded drive (no time, date or speed is ever stored). A stamp is the phone's word that the member's
// own Log covers the road; the table keeps it under a keyed hash, so the database alone cannot say who drove what.
import type { Viewer } from "./auth";
import { Env, HttpError, body, nearCell, randomToken } from "./util";
import { cleanText } from "./convoy";
import { reportedSql, removedSql } from "./reports_sql";

export const MAX_BOOKS = 30, MAX_ROADS = 40, MAX_POINTS = 600, MAX_FOLLOWS = 100, ROADS_PER_DAY = 60, NEAR_KM = 160, NEAR_SHOWN = 20;
export const MIN_ROAD_M = 300, MAX_ROAD_M = 600_000;
const ID_RE = /^[A-Za-z0-9_-]{16}$/;
export const BIND_CHUNK = 90;
const VIS = ["private", "friends", "public"] as const;
type Vis = typeof VIS[number];

const first = <T>(env: Env, sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).first<T>();
const all = async <T>(env: Env, sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).all<T>()).results;
const who = (v: Viewer | null) => v?.id ?? "";

/** Who may open book `b`, for viewer ?1 ('' when signed out): its owner; anyone for a public one that reports haven't taken
 *  down; an accepted friend for a friends one. Never across a block. */
const CAN_SEE = `(b.owner = ?1 OR ((
     (b.visibility = 'public' AND NOT ${reportedSql("roadbook", "b.id")})
     OR (b.visibility = 'friends' AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(b.owner, ?1) AND f.user_b = MAX(b.owner, ?1))))
   AND NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.blocker = ?1 AND k.blocked = b.owner) OR (k.blocker = b.owner AND k.blocked = ?1))))`;

const metres = (aLat: number, aLon: number, bLat: number, bLon: number) =>
  Math.hypot((bLat - aLat) * 110_540, (bLon - aLon) * 111_320 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180));

/** [[lon, lat], …]: 2..MAX_POINTS finite points on Earth, to 5 decimals; with its length and its box. */
function cleanRoad(g: unknown) {
  if (!Array.isArray(g) || g.length < 2 || g.length > MAX_POINTS) throw new HttpError(400, "bad_geom");
  let len = 0, s = 90, n = -90, w = 180, e = -180;
  const geom = g.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) throw new HttpError(400, "bad_geom");
    const [lon, lat] = p as unknown[];
    if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new HttpError(400, "bad_geom");
    const q = [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
    if (i) { const prev = g[i - 1] as number[]; len += metres(prev[1], prev[0], lat, lon); }
    s = Math.min(s, q[1]); n = Math.max(n, q[1]); w = Math.min(w, q[0]); e = Math.max(e, q[0]);
    return q;
  });
  if (!(len >= MIN_ROAD_M) || len > MAX_ROAD_M) throw new HttpError(400, "bad_length");
  return { geom, length_m: Math.round(len), box: [s, n, w, e] as const };
}

function text(v: unknown, field: string, max: number, required = true): string | null {
  if (v == null || v === "") { if (required) throw new HttpError(400, `bad_${field}`); return null; }
  const t = cleanText(v, max);
  if (!t || !t.trim()) throw new HttpError(400, `bad_${field}`);
  return t.trim();
}

/** A member's own pseudonym for stamps: one keyed hash of who they are (the same for all their stamps, so export and
 *  delete can find them), never their id. Without the server's key it can't be turned back into anyone. */
async function holderOf(env: Env, userId: string): Promise<ArrayBuffer> {
  if (!env.PEPPER) throw new HttpError(503, "stamps_not_configured");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`roadbook|${userId}`));
}
const holderOrNull = async (env: Env, v: Viewer | null) => (v && env.PEPPER ? holderOf(env, v.id) : null);

async function ownBook(env: Env, v: Viewer, id: string) {
  const b = ID_RE.test(id) ? await first<{ id: string; visibility: Vis; roads_n: number }>(env, "SELECT id, visibility, roads_n FROM roadbooks WHERE id = ? AND owner = ?", id, v.id) : null;
  if (!b) throw new HttpError(404, "no_roadbook");
  return b;
}

/** Counts, total length and the middle of the book, from its roads as they now are. */
const RECOUNT = `UPDATE roadbooks SET updated_at = datetime('now'),
    roads_n = (SELECT COUNT(*) FROM roadbook_roads r WHERE r.book_id = ?1),
    length_m = COALESCE((SELECT SUM(r.length_m) FROM roadbook_roads r WHERE r.book_id = ?1), 0),
    area_lat = (SELECT AVG((r.south + r.north) / 2) FROM roadbook_roads r WHERE r.book_id = ?1),
    area_lon = (SELECT AVG((r.west + r.east) / 2) FROM roadbook_roads r WHERE r.book_id = ?1)
  WHERE id = ?1`;

function wantVis(v: unknown): Vis {
  const vis = VIS.find((x) => x === v);
  if (!vis) throw new HttpError(400, "bad_visibility");
  return vis;
}
/** Showing a book to anyone needs a handle (it is signed with it); a book the owner took down stays down. */
async function mayShow(env: Env, v: Viewer, vis: Vis, id: string | null) {
  if (vis === "private") return;
  if (!v.handle) throw new HttpError(409, "handle_required");
  if (vis === "public" && id && (await first(env, `SELECT 1 WHERE ${removedSql("roadbook", "?1")}`, id))) throw new HttpError(403, "removed");
}

export async function bookCreate(env: Env, v: Viewer, req: Request) {
  const b = await body<{ name?: unknown; about?: unknown; visibility?: unknown }>(req);
  const name = text(b.name, "name", 60)!, about = text(b.about, "about", 280, false);
  const vis = b.visibility === undefined ? "private" : wantVis(b.visibility);
  await mayShow(env, v, vis, null);
  const n = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM roadbooks WHERE owner = ?", v.id);
  if ((n?.n ?? 0) >= MAX_BOOKS) throw new HttpError(429, "too_many_roadbooks");
  const id = randomToken(12);
  await env.DB.prepare("INSERT INTO roadbooks (id, owner, name, about, visibility) VALUES (?, ?, ?, ?, ?)").bind(id, v.id, name, about, vis).run();
  return { id };
}

export async function bookUpdate(env: Env, v: Viewer, id: string, req: Request) {
  const book = await ownBook(env, v, id);
  const b = await body<{ name?: unknown; about?: unknown; visibility?: unknown; order?: unknown }>(req);
  const stmts: D1PreparedStatement[] = [];
  if (b.name !== undefined) stmts.push(env.DB.prepare("UPDATE roadbooks SET name = ? WHERE id = ?").bind(text(b.name, "name", 60), id));
  if (b.about !== undefined) stmts.push(env.DB.prepare("UPDATE roadbooks SET about = ? WHERE id = ?").bind(text(b.about, "about", 280, false), id));
  if (b.visibility !== undefined) {
    const vis = wantVis(b.visibility);
    await mayShow(env, v, vis, id);
    stmts.push(env.DB.prepare("UPDATE roadbooks SET visibility = ? WHERE id = ?").bind(vis, id));
    // narrowing it lets go of the followers who can no longer open it (private: all of them; friends: checked when read)
    if (vis === "private") stmts.push(env.DB.prepare("DELETE FROM roadbook_follows WHERE book_id = ?").bind(id));
  }
  if (b.order !== undefined) {   // the roads' ids in the order wanted: exactly the book's own
    const have = (await all<{ id: string }>(env, "SELECT id FROM roadbook_roads WHERE book_id = ?", id)).map((r) => r.id);
    const order = Array.isArray(b.order) ? (b.order as unknown[]) : [];
    if (order.length !== have.length || new Set(order).size !== have.length || !order.every((x) => typeof x === "string" && have.includes(x))) throw new HttpError(400, "bad_order");
    order.forEach((rid, i) => stmts.push(env.DB.prepare("UPDATE roadbook_roads SET pos = ? WHERE id = ? AND book_id = ?").bind(i, rid, id)));
  }
  if (!stmts.length) throw new HttpError(400, "nothing_to_change");
  stmts.push(env.DB.prepare("UPDATE roadbooks SET updated_at = datetime('now') WHERE id = ?").bind(book.id));
  await env.DB.batch(stmts);
}

export async function bookDelete(env: Env, v: Viewer, id: string) {
  await ownBook(env, v, id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reports WHERE kind = 'roadbook' AND target_id = ? AND status = 'open'").bind(id),
    env.DB.prepare("DELETE FROM roadbooks WHERE id = ?").bind(id),   // roads, follows and stamps go with it
  ]);
}

export async function roadAdd(env: Env, v: Viewer, id: string, req: Request) {
  const book = await ownBook(env, v, id);
  if (book.roads_n >= MAX_ROADS) throw new HttpError(429, "roadbook_full");
  const b = await body<{ name?: unknown; note?: unknown; geom?: unknown }>(req);
  const name = text(b.name, "name", 60)!, note = text(b.note, "note", 280, false), road = cleanRoad(b.geom);
  const today = await first<{ n: number }>(env,
    "SELECT COUNT(*) AS n FROM roadbook_roads r JOIN roadbooks b ON b.id = r.book_id WHERE b.owner = ? AND r.created_at > datetime('now', '-1 day')", v.id);
  if ((today?.n ?? 0) >= ROADS_PER_DAY) throw new HttpError(429, "daily_limit");
  const rid = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO roadbook_roads (id, book_id, pos, name, note, geom, length_m, south, north, west, east)
       VALUES (?1, ?2, COALESCE((SELECT MAX(pos) + 1 FROM roadbook_roads WHERE book_id = ?2), 0), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
      .bind(rid, id, name, note, JSON.stringify(road.geom), road.length_m, ...road.box),
    env.DB.prepare(RECOUNT).bind(id),
  ]);
  return { id: rid, length_m: road.length_m };
}

export async function roadUpdate(env: Env, v: Viewer, id: string, rid: string, req: Request) {
  await ownBook(env, v, id);
  const b = await body<{ name?: unknown; note?: unknown }>(req);
  if (b.name === undefined && b.note === undefined) throw new HttpError(400, "nothing_to_change");
  const r = await env.DB.prepare("UPDATE roadbook_roads SET name = COALESCE(?1, name), note = CASE WHEN ?2 THEN ?3 ELSE note END WHERE id = ?4 AND book_id = ?5")
    .bind(b.name === undefined ? null : text(b.name, "name", 60), b.note === undefined ? 0 : 1, b.note === undefined ? null : text(b.note, "note", 280, false), rid, id).run();
  if (!r.meta.changes) throw new HttpError(404, "no_road");
}

export async function roadRemove(env: Env, v: Viewer, id: string, rid: string) {
  await ownBook(env, v, id);
  await env.DB.batch([env.DB.prepare("DELETE FROM roadbook_roads WHERE id = ? AND book_id = ?").bind(rid, id), env.DB.prepare(RECOUNT).bind(id)]);
}

interface BookRow { id: string; name: string; about: string | null; visibility: Vis; owner: string; by: string | null; roads_n: number; length_m: number;
  area_lat: number | null; area_lon: number | null; followers: number; following: number; updated_at: string }
const BOOK_COLS = `b.id, b.name, b.about, b.visibility, b.owner, u.handle AS by, b.roads_n, b.length_m, b.area_lat, b.area_lon, b.updated_at,
  (SELECT COUNT(*) FROM roadbook_follows f WHERE f.book_id = b.id) AS followers,
  EXISTS (SELECT 1 FROM roadbook_follows f WHERE f.book_id = b.id AND f.user_id = ?1) AS following`;
const card = (r: BookRow, me: string) => ({ id: r.id, name: r.name, about: r.about, visibility: r.visibility, by: r.by, mine: r.owner === me, roads: r.roads_n, length_m: r.length_m,
  lat: r.area_lat, lon: r.area_lon, followers: r.followers, following: !!r.following, updated_at: r.updated_at });

/** One book with its roads and their shapes. Signed out works for a public one (its link). */
export async function bookGet(env: Env, v: Viewer | null, id: string) {
  const me = who(v);
  const b = ID_RE.test(id) ? await first<BookRow>(env, `SELECT ${BOOK_COLS} FROM roadbooks b JOIN users u ON u.id = b.owner WHERE b.id = ?2 AND ${CAN_SEE}`, me, id) : null;
  if (!b) throw new HttpError(404, "no_roadbook");
  const holder = await holderOrNull(env, v);
  const roads = await all<{ id: string; name: string; note: string | null; geom: string; length_m: number; stamps: number; stamped: number }>(env,
    `SELECT r.id, r.name, r.note, r.geom, r.length_m, r.stamps, EXISTS (SELECT 1 FROM roadbook_stamps s WHERE s.road_id = r.id AND s.holder = ?2) AS stamped
       FROM roadbook_roads r WHERE r.book_id = ?1 ORDER BY r.pos, r.created_at`, id, holder);
  return { ...card(b, me), road_list: roads.map((r) => ({ ...r, geom: JSON.parse(r.geom) as number[][], stamped: !!r.stamped })) };
}

/** Yours and the ones you follow, each with its roads' names and boxes (no shapes): what the phone needs to know which of
 *  them a drive it just recorded could have covered, without telling the server where the drive was. */
export async function booksMine(env: Env, v: Viewer) {
  const rows = await all<BookRow>(env,
    `SELECT ${BOOK_COLS} FROM roadbooks b JOIN users u ON u.id = b.owner
      WHERE (b.owner = ?1 OR EXISTS (SELECT 1 FROM roadbook_follows f WHERE f.book_id = b.id AND f.user_id = ?1)) AND ${CAN_SEE}
      ORDER BY b.updated_at DESC LIMIT ${MAX_BOOKS + MAX_FOLLOWS}`, v.id);
  if (!rows.length) return { mine: [], following: [] };
  const holder = await holderOrNull(env, v);
  // D1 binds at most 100 values a query and a member can hold MAX_BOOKS + MAX_FOLLOWS books, so the roads come in chunks
  type RoadRow = { id: string; book_id: string; name: string; length_m: number; south: number; north: number; west: number; east: number; stamped: number };
  const roads: RoadRow[] = [];
  for (let k = 0; k < rows.length; k += BIND_CHUNK) {
    const ids = rows.slice(k, k + BIND_CHUNK).map((r) => r.id);
    roads.push(...await all<RoadRow>(env,
      `SELECT r.id, r.book_id, r.name, r.length_m, r.south, r.north, r.west, r.east,
              EXISTS (SELECT 1 FROM roadbook_stamps s WHERE s.road_id = r.id AND s.holder = ?1) AS stamped
         FROM roadbook_roads r WHERE r.book_id IN (${ids.map((_, i) => `?${i + 2}`).join(",")}) ORDER BY r.pos, r.created_at`, holder, ...ids));
  }
  const out = rows.map((r) => ({ ...card(r, v.id),
    road_list: roads.filter((x) => x.book_id === r.id).map((x) => ({ id: x.id, name: x.name, length_m: x.length_m, box: [x.south, x.north, x.west, x.east], stamped: !!x.stamped })) }));
  return { mine: out.filter((b) => b.mine), following: out.filter((b) => !b.mine) };
}

/** Public books near a coarse cell (VI-1, util.ts nearCell): most followed first, then nearest. Signed out works. */
export async function booksNear(env: Env, v: Viewer | null, url: URL) {
  const { lat, lon } = nearCell(url), me = who(v);
  const dLat = NEAR_KM / 111, dLon = dLat / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const rows = await all<BookRow>(env,
    `SELECT ${BOOK_COLS} FROM roadbooks b JOIN users u ON u.id = b.owner
      WHERE b.visibility = 'public' AND b.roads_n > 0 AND b.owner != ?1 AND b.area_lat BETWEEN ?2 AND ?3 AND b.area_lon BETWEEN ?4 AND ?5 AND ${CAN_SEE}
      LIMIT 200`, me, lat - dLat, lat + dLat, lon - dLon, lon + dLon);
  const km = (r: BookRow) => Math.round(metres(lat, lon, r.area_lat!, r.area_lon!) / 1000);
  return rows.map((r) => ({ ...card(r, me), km: km(r) })).filter((r) => r.km <= NEAR_KM)
    .sort((a, b) => b.followers - a.followers || a.km - b.km).slice(0, NEAR_SHOWN);
}

export async function bookFollow(env: Env, v: Viewer, id: string, on: boolean) {
  if (!on) { await env.DB.prepare("DELETE FROM roadbook_follows WHERE book_id = ? AND user_id = ?").bind(id, v.id).run(); return; }
  const b = ID_RE.test(id) ? await first<{ owner: string }>(env, `SELECT b.owner FROM roadbooks b WHERE b.id = ?2 AND ${CAN_SEE}`, v.id, id) : null;
  if (!b) throw new HttpError(404, "no_roadbook");
  if (b.owner === v.id) throw new HttpError(400, "own_roadbook");
  const n = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM roadbook_follows WHERE user_id = ?", v.id);
  if ((n?.n ?? 0) >= MAX_FOLLOWS) throw new HttpError(429, "too_many_follows");
  await env.DB.prepare("INSERT OR IGNORE INTO roadbook_follows (book_id, user_id) VALUES (?, ?)").bind(id, v.id).run();
}

/** The phone found the road in the member's own Log (web/roadbooks.js coverage), or takes that back. Counted once each. */
export async function roadStamp(env: Env, v: Viewer, rid: string, on: boolean) {
  const road = await first<{ id: string }>(env, `SELECT r.id FROM roadbook_roads r JOIN roadbooks b ON b.id = r.book_id WHERE r.id = ?2 AND ${CAN_SEE}`, v.id, rid);
  if (!road) throw new HttpError(404, "no_road");
  const holder = await holderOf(env, v.id);
  const r = await env.DB.prepare(on ? "INSERT OR IGNORE INTO roadbook_stamps (road_id, holder) VALUES (?, ?)" : "DELETE FROM roadbook_stamps WHERE road_id = ? AND holder = ?").bind(rid, holder).run();
  if (r.meta.changes) await env.DB.prepare("UPDATE roadbook_roads SET stamps = (SELECT COUNT(*) FROM roadbook_stamps WHERE road_id = ?1) WHERE id = ?1").bind(rid).run();
  const now = await first<{ stamps: number }>(env, "SELECT stamps FROM roadbook_roads WHERE id = ?", rid);
  return { stamped: on, stamps: now?.stamps ?? 0 };
}

/** For the member's data export: the roads they hold a stamp on, by name. */
export async function stampsOf(env: Env, userId: string) {
  if (!env.PEPPER) return [];
  return all<{ roadbook: string; road: string }>(env,
    "SELECT b.name AS roadbook, r.name AS road FROM roadbook_stamps s JOIN roadbook_roads r ON r.id = s.road_id JOIN roadbooks b ON b.id = r.book_id WHERE s.holder = ?", await holderOf(env, userId));
}

/** Leaving: the member's stamps go too (their books, roads and follows cascade from users). */
export async function stampsErase(env: Env, userId: string): Promise<D1PreparedStatement[]> {
  if (!env.PEPPER) return [];
  const holder = await holderOf(env, userId);
  return [
    env.DB.prepare("UPDATE roadbook_roads SET stamps = MAX(0, stamps - 1) WHERE id IN (SELECT road_id FROM roadbook_stamps WHERE holder = ?)").bind(holder),
    env.DB.prepare("DELETE FROM roadbook_stamps WHERE holder = ?").bind(holder),
  ];
}
