// Drive posts and the friends feed (docs/SOCIAL.md 2.13): after a drive, the driver posts its card to their friends or to
// one of their crews: the drive's name, the day, its length, its Vetta Score, the roads, up to three stages with their
// Scores, a line of the drive's shape with both ends cut, and a caption. Friends (or that crew's members) see it in their
// feed and give kudos and comments, as on any social app.
// Never shown to or from someone blocked; a post or comment three established members report is hidden (reports_sql.ts),
// and the owner's queue can remove it. The author deletes their post; a comment's author or the post's author deletes it.
// Nothing is kept about a drive but what the card shows: no times along the line, no speeds.
import type { Viewer } from "./auth";
import { DATE_RE, Env, HttpError, body, randomToken } from "./util";
import { cleanText } from "./convoy";
import { isCrewMember } from "./social";
import { reportedSql } from "./reports_sql";
import { mediaErase, mediaOf } from "./post_media";

export const MAX_POINTS = 600, CUT_M = 500, FEED_N = 30, MAX_POSTS_DAY = 10, MAX_COMMENTS_HOUR = 30, MAX_COMMENTS = 200;
const ID_RE = /^[A-Za-z0-9_-]{16}$/;

// ---- the line: encoded polyline (precision 1e5), cut and thinned here whatever the phone sent ----------------------------
export function decodeLine(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let r = 0, sh = 0, b: number;
    do { if (i >= s.length) throw new HttpError(400, "bad_line"); b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < s.length) { lat += next(); lon += next(); out.push([lat / 1e5, lon / 1e5]); }
  return out;
}
export function encodeLine(pts: [number, number][]): string {
  let s = "", pLat = 0, pLon = 0;
  const put = (v: number) => { let x = v < 0 ? ~(v << 1) : v << 1; while (x >= 32) { s += String.fromCharCode((32 | (x & 31)) + 63); x >>= 5; } s += String.fromCharCode(x + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); put(a - pLat); put(b - pLon); pLat = a; pLon = b; }
  return s;
}
const metres = (a: [number, number], b: [number, number]) => {
  const R = 6371000, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
/** Both ends cut by CUT_M (where a drive starts and ends is where someone lives or works), thinned to MAX_POINTS. Null when
 *  nothing is left: a drive too short to show without its ends shows no line. */
export function cutLine(pts: [number, number][]): [number, number][] | null {
  if (pts.length < 2 || pts.some(([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 85 || Math.abs(b) > 180)) return null;
  const along = [0];
  for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + metres(pts[k - 1], pts[k]));
  const total = along[along.length - 1];
  const kept = pts.filter((_, k) => along[k] >= CUT_M && along[k] <= total - CUT_M);
  if (kept.length < 2) return null;
  const step = Math.ceil(kept.length / MAX_POINTS);
  const thin = kept.filter((_, k) => k % step === 0);
  if (thin[thin.length - 1] !== kept[kept.length - 1]) thin.push(kept[kept.length - 1]);
  return thin.slice(0, MAX_POINTS);
}

const NOT_BLOCKED = (who: string) => `NOT EXISTS (SELECT 1 FROM blocks bk WHERE (bk.blocker = ?1 AND bk.blocked = ${who}) OR (bk.blocker = ${who} AND bk.blocked = ?1))`;
/** Who sees a post p (the viewer is ?1): its author; else, not across a block and not hidden by reports, the author's friends
 *  they share with (a post to friends: the per-friend Share switch, grants.share_scores, which a post's Score falls under)
 *  or the crew's members while the author is one too (a post to a crew; leaving a crew takes your posts out of it). */
export const POST_SEEN = (p: string) => `(${p}.author = ?1 OR (${NOT_BLOCKED(`${p}.author`)} AND NOT ${reportedSql("drive", `${p}.id`)} AND CASE WHEN ${p}.crew_id IS NULL
    THEN EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(${p}.author, ?1) AND f.user_b = MAX(${p}.author, ?1))
     AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = ${p}.author AND g.audience_type = 'friend' AND g.audience_id = ?1 AND g.share_scores = 1)
    ELSE EXISTS (SELECT 1 FROM crew_members cm WHERE cm.crew_id = ${p}.crew_id AND cm.user_id = ?1)
     AND EXISTS (SELECT 1 FROM crew_members ca WHERE ca.crew_id = ${p}.crew_id AND ca.user_id = ${p}.author) END))`;

const optText = (v: unknown, max: number, field: string) => {
  if (v === undefined || v === null || v === "") return null;
  const t = cleanText(v, max)?.trim();
  if (t === undefined || t === null) throw new HttpError(400, `bad_${field}`);
  return t || null;
};
const names = (v: unknown, max: number, field: string) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) throw new HttpError(400, `bad_${field}`);
  return v.map((x) => { const t = cleanText(x, 60)?.trim(); if (!t) throw new HttpError(400, `bad_${field}`); return t; });
};

/** POST /api/posts: the drive's card, to friends (no crew_id) or to a crew you're in. → { id } */
export async function postCreate(env: Env, v: Viewer, req: Request): Promise<{ id: string }> {
  const b = await body<Record<string, unknown>>(req);
  const title = optText(b.title, 60, "title");
  if (!title) throw new HttpError(400, "bad_title");
  const caption = optText(b.caption, 280, "caption");
  const day = typeof b.driven_on === "string" && DATE_RE.test(b.driven_on) ? b.driven_on : null;
  const now = Date.now();
  if (!day || Date.parse(day) > now + 86400_000 || Date.parse(day) < now - 30 * 86400_000) throw new HttpError(400, "bad_driven_on");
  const length = b.length_m === undefined || b.length_m === null ? null : Number(b.length_m);
  if (length !== null && !(Number.isFinite(length) && length >= 0 && length <= 2_000_000)) throw new HttpError(400, "bad_length");
  const score = b.score === undefined || b.score === null ? null : Number(b.score);
  if (score !== null && !(Number.isInteger(score) && score >= 0 && score <= 1000)) throw new HttpError(400, "bad_score");
  const roads = names(b.roads, 8, "roads");
  if (b.stages !== undefined && b.stages !== null && (!Array.isArray(b.stages) || b.stages.length > 3)) throw new HttpError(400, "bad_stages");
  const stages = ((b.stages as unknown[]) || []).map((s) => {
    const o = (s && typeof s === "object" ? s : {}) as { name?: unknown; score?: unknown };
    const n = cleanText(o.name, 60)?.trim(), sc = o.score === null || o.score === undefined ? null : Number(o.score);
    if (!n || (sc !== null && !(Number.isInteger(sc) && sc >= 0 && sc <= 1000))) throw new HttpError(400, "bad_stages");
    return { name: n, score: sc };
  });
  let line: string | null = null;
  if (b.line !== undefined && b.line !== null && b.line !== "") {
    if (typeof b.line !== "string" || b.line.length > 40_000 || !/^[\x3f-\x7e]+$/.test(b.line)) throw new HttpError(400, "bad_line");
    const cut = cutLine(decodeLine(b.line));
    line = cut ? encodeLine(cut) : null;
  }
  const crew = b.crew_id === undefined || b.crew_id === null || b.crew_id === "" ? null : String(b.crew_id);
  if (crew && !(await isCrewMember(env, crew, v.id))) throw new HttpError(404, "no_crew");
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM drive_posts WHERE author = ? AND created_at > datetime('now', '-1 day')").bind(v.id).first<{ n: number }>();
  if (n && n.n >= MAX_POSTS_DAY) throw new HttpError(429, "too_many_posts");
  const id = randomToken(12);
  await env.DB.prepare(`INSERT INTO drive_posts (id, author, crew_id, title, caption, driven_on, length_m, score, roads, stages, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, v.id, crew, title, caption, day, length === null ? null : Math.round(length), score, roads.length ? JSON.stringify(roads) : null,
      stages.length ? JSON.stringify(stages) : null, line).run();
  return { id };
}

type Row = { id: string; author: string; handle: string | null; photo_id: string | null; crew_id: string | null; crew_name: string | null; title: string; caption: string | null;
  driven_on: string; length_m: number | null; score: number | null; roads: string | null; stages: string | null; line: string | null; media: string | null; created_at: string;
  kudos: number; my_kudos: number; comments: number };
const SELECT = `SELECT p.id, p.author, u.handle, u.photo_id, p.crew_id, c.name AS crew_name, p.title, p.caption, p.driven_on, p.length_m, p.score, p.roads,
    p.stages, p.line, p.media, p.created_at,
    (SELECT COUNT(*) FROM drive_post_kudos k WHERE k.post_id = p.id) AS kudos,
    EXISTS (SELECT 1 FROM drive_post_kudos k WHERE k.post_id = p.id AND k.user_id = ?1) AS my_kudos,
    (SELECT COUNT(*) FROM drive_comments dc WHERE dc.post_id = p.id AND (dc.author = ?1 OR (${NOT_BLOCKED("dc.author")} AND NOT ${reportedSql("comment", "dc.id")}))) AS comments
  FROM drive_posts p JOIN users u ON u.id = p.author LEFT JOIN crews c ON c.id = p.crew_id`;
const shape = (r: Row, me: string) => ({
  id: r.id, handle: r.handle, photo_id: r.photo_id, mine: r.author === me, crew: r.crew_id ? { id: r.crew_id, name: r.crew_name } : null,
  title: r.title, caption: r.caption, driven_on: r.driven_on, length_m: r.length_m, score: r.score,
  roads: r.roads ? (JSON.parse(r.roads) as string[]) : [], stages: r.stages ? (JSON.parse(r.stages) as { name: string; score: number | null }[]) : [],
  line: r.line, media: (() => { const m = mediaOf(r.media); return m ? { kind: m.kind, label: m.label } : null; })(), created_at: r.created_at, kudos: r.kudos, my_kudos: !!r.my_kudos, comments: r.comments,
});

/** GET /api/feed?before=: the newest posts you can see (yours too), FEED_N at a time, older than `before` (a created_at). */
export async function feed(env: Env, v: Viewer, url: URL) {
  const before = url.searchParams.get("before");
  const cut = before && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(before) ? before : "9999-12-31 23:59:59";
  const rows = (await env.DB.prepare(`${SELECT} WHERE p.created_at < ?2 AND ${POST_SEEN("p")} ORDER BY p.created_at DESC, p.rowid DESC LIMIT ${FEED_N}`)
    .bind(v.id, cut).all<Row>()).results;
  return rows.map((r) => shape(r, v.id));
}

async function seenPost(env: Env, v: Viewer, id: string): Promise<Row> {
  if (!ID_RE.test(id)) throw new HttpError(404, "no_post");
  const r = await env.DB.prepare(`${SELECT} WHERE p.id = ?2 AND ${POST_SEEN("p")}`).bind(v.id, id).first<Row>();
  if (!r) throw new HttpError(404, "no_post");                       // a post you can't see answers as one that doesn't exist
  return r;
}

/** GET /api/posts/:id: the post and its comments, oldest first. */
export async function postGet(env: Env, v: Viewer, id: string) {
  const p = await seenPost(env, v, id);
  const comments = (await env.DB.prepare(`SELECT dc.id, dc.body, dc.created_at, u.handle, u.photo_id, dc.author = ?1 AS mine
      FROM drive_comments dc JOIN users u ON u.id = dc.author
     WHERE dc.post_id = ?2 AND (dc.author = ?1 OR (${NOT_BLOCKED("dc.author")} AND NOT ${reportedSql("comment", "dc.id")}))
     ORDER BY dc.created_at, dc.rowid LIMIT ${MAX_COMMENTS}`).bind(v.id, id).all<{ id: string; body: string; created_at: string; handle: string | null; photo_id: string | null; mine: number }>()).results;
  return { ...shape(p, v.id), comment_list: comments.map((c) => ({ ...c, mine: !!c.mine, can_delete: !!c.mine || p.author === v.id })) };
}

/** DELETE /api/posts/:id: yours only; its kudos and comments go with it. */
export async function postDelete(env: Env, v: Viewer, id: string): Promise<void> {
  const r = await env.DB.prepare("DELETE FROM drive_posts WHERE id = ? AND author = ?").bind(id, v.id).run();
  if (!r.meta.changes) throw new HttpError(404, "no_post");
  await mediaErase(env, [id]);
}

/** POST/DELETE /api/posts/:id/kudos: one per person per post; not on your own. → the post's author when the kudos is new. */
export async function postKudos(env: Env, v: Viewer, id: string, give: boolean): Promise<{ author: string; title: string } | null> {
  const p = await seenPost(env, v, id);
  if (p.author === v.id) throw new HttpError(400, "own_post");
  if (!give) { await env.DB.prepare("DELETE FROM drive_post_kudos WHERE post_id = ? AND user_id = ?").bind(id, v.id).run(); return null; }
  const r = await env.DB.prepare("INSERT OR IGNORE INTO drive_post_kudos (post_id, user_id) VALUES (?, ?)").bind(id, v.id).run();
  return r.meta.changes ? { author: p.author, title: p.title } : null;
}

/** POST /api/posts/:id/comments {body}: plain text, 280 characters at most, MAX_COMMENTS_HOUR an hour. → { id } and who to tell. */
export async function commentCreate(env: Env, v: Viewer, id: string, req: Request): Promise<{ id: string; author: string; title: string }> {
  const p = await seenPost(env, v, id);
  const { body: text } = await body<{ body?: unknown }>(req);
  const t = cleanText(text, 280)?.trim();
  if (!t) throw new HttpError(400, "bad_body");
  const [n, total] = await env.DB.batch<{ n: number }>([
    env.DB.prepare("SELECT COUNT(*) AS n FROM drive_comments WHERE author = ? AND created_at > datetime('now', '-1 hour')").bind(v.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM drive_comments WHERE post_id = ?").bind(id),
  ]);
  if (n.results[0].n >= MAX_COMMENTS_HOUR) throw new HttpError(429, "too_many_comments");
  if (total.results[0].n >= MAX_COMMENTS) throw new HttpError(409, "post_full");
  const cid = randomToken(12);
  await env.DB.prepare("INSERT INTO drive_comments (id, post_id, author, body) VALUES (?, ?, ?, ?)").bind(cid, id, v.id, t).run();
  return { id: cid, author: p.author, title: p.title };
}

/** DELETE /api/comments/:id: the comment's author, or the post's author. */
export async function commentDelete(env: Env, v: Viewer, id: string): Promise<void> {
  const r = await env.DB.prepare(`DELETE FROM drive_comments WHERE id = ?1 AND (author = ?2 OR post_id IN (SELECT id FROM drive_posts WHERE author = ?2))`).bind(id, v.id).run();
  if (!r.meta.changes) throw new HttpError(404, "no_comment");
}
