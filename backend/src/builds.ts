// Build threads (docs/design/REVIEW.md 5.3, roadmap 23, mockup 10-build-thread.html): one per car. The owner declares
// stages (the thread's table of contents) and posts numbered steps with text, parts and photos, and optionally the Vetta
// Score of the drive it was tested on. Others reply, or mark a reply as a suggestion, which the owner can answer with
// "Tried it" and a result: next year's reader sees what was suggested and what happened. Following lists new posts.
// A build is seen by whoever can see its car (garage.ts: the owner, and friends and private-crew mates when it's shown).
import type { Viewer } from "./auth";
import { Env, HttpError, body } from "./util";
import { cleanText } from "./convoy";
import { reportedSql } from "./reports_sql";

export const MAX_STAGES = 8, MAX_PARTS = 12, MAX_POSTS = 200, REPLY_MAX = 1000, REPLIES_PER_HOUR = 30;

/** SQL: may viewer ?1 see car `c`? The same circle as peoplesCars. */
export const CAR_SEEN = (c: string) => `(${c}.owner = ?1 OR (${c}.shared = 1 AND NOT ${reportedSql("car", `${c}.id`)}
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = ${c}.owner) OR (b.blocker = ${c}.owner AND b.blocked = ?1))
  AND (EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(${c}.owner, ?1) AND f.user_b = MAX(${c}.owner, ?1))
    OR EXISTS (SELECT 1 FROM crew_members a JOIN crews cr ON cr.id = a.crew_id AND cr.visibility = 'private'
                 JOIN crew_members b ON b.crew_id = a.crew_id WHERE a.user_id = ?1 AND b.user_id = ${c}.owner))))`;
const NOT_BLOCKED = (who: string) => `NOT EXISTS (SELECT 1 FROM blocks bb WHERE (bb.blocker = ?1 AND bb.blocked = ${who}) OR (bb.blocker = ${who} AND bb.blocked = ?1))`;

const text = (v: unknown, k: string, max: number, required = false) => {
  if (v === undefined || v === null || v === "") { if (required) throw new HttpError(400, `bad_${k}`); return null; }
  const t = cleanText(v, max)?.trim();
  if (!t) throw new HttpError(400, `bad_${k}`);
  return t;
};
function stagesOf(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_STAGES) throw new HttpError(400, "bad_stages");
  return v.map((s) => text(s, "stages", 24, true)!);
}
function partsOf(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_PARTS) throw new HttpError(400, "bad_parts");
  return v.map((s) => text(s, "parts", 40, true)!);
}

interface BuildRow { id: string; owner: string; car_id: string; stages: string }
async function seenBuild(env: Env, v: Viewer, id: string): Promise<BuildRow> {
  const b = await env.DB.prepare(`SELECT b.id, b.owner, b.car_id, b.stages FROM builds b JOIN cars c ON c.id = b.car_id WHERE b.id = ?2 AND ${CAR_SEEN("c")}`)
    .bind(v.id, id).first<BuildRow>();
  if (!b) throw new HttpError(404, "no_build");
  return b;
}
async function ownBuild(env: Env, v: Viewer, id: string): Promise<BuildRow> {
  const b = await seenBuild(env, v, id);
  if (b.owner !== v.id) throw new HttpError(404, "no_build");
  return b;
}

/** POST /api/builds { car_id, stages }: a car of yours gets its thread (one per car). */
export async function buildCreate(env: Env, v: Viewer, req: Request): Promise<{ id: string }> {
  const b = await body<{ car_id?: unknown; stages?: unknown }>(req);
  if (typeof b.car_id !== "string") throw new HttpError(400, "bad_car");
  const stages = stagesOf(b.stages ?? []);
  const car = await env.DB.prepare("SELECT 1 FROM cars WHERE id = ? AND owner = ?").bind(b.car_id, v.id).first();
  if (!car) throw new HttpError(404, "no_car");
  const id = crypto.randomUUID();
  const r = await env.DB.prepare("INSERT OR IGNORE INTO builds (id, owner, car_id, stages) VALUES (?, ?, ?, ?)").bind(id, v.id, b.car_id, JSON.stringify(stages)).run();
  if (!r.meta.changes) throw new HttpError(409, "has_build");
  return { id };
}

/** PUT /api/builds/:id { stages }: the owner renames, adds or reorders stages. */
export async function buildUpdate(env: Env, v: Viewer, id: string, req: Request): Promise<void> {
  await ownBuild(env, v, id);
  const stages = stagesOf((await body<{ stages?: unknown }>(req)).stages);
  await env.DB.prepare("UPDATE builds SET stages = ? WHERE id = ?").bind(JSON.stringify(stages), id).run();
}

/** DELETE /api/builds/:id: the owner ends the thread, with its posts, replies and follows. */
export async function buildDelete(env: Env, v: Viewer, id: string): Promise<void> {
  await ownBuild(env, v, id);
  await env.DB.prepare("DELETE FROM builds WHERE id = ?").bind(id).run();
}

/** GET /api/builds/:id: the header, the stages, the posts (newest first) with their replies, and whether you follow. */
export async function buildGet(env: Env, v: Viewer, id: string) {
  const b = await seenBuild(env, v, id);
  const head = await env.DB.prepare(`SELECT c.id AS car_id, c.year, c.make, c.model, c.trim, c.nickname, c.mods, c.cover_photo_id, u.handle, u.photo_id,
      (SELECT COUNT(*) FROM build_follows f WHERE f.build_id = ?2) AS followers,
      EXISTS (SELECT 1 FROM build_follows f WHERE f.build_id = ?2 AND f.user_id = ?1) AS following
      FROM cars c JOIN users u ON u.id = c.owner WHERE c.id = ?3`).bind(v.id, id, b.car_id).first<Record<string, unknown>>();
  const posts = (await env.DB.prepare(`SELECT p.id, p.n, p.stage, p.title, p.body, p.parts, p.score, p.created_at,
      (SELECT json_group_array(ph.id) FROM (SELECT id FROM photos WHERE kind = 'post' AND ref_id = p.id ORDER BY created_at, rowid) ph) AS photos
      FROM build_posts p WHERE p.build_id = ?2 AND (?3 = ?1 OR NOT ${reportedSql("post", "p.id")}) ORDER BY p.n DESC LIMIT ${MAX_POSTS}`)
    .bind(v.id, id, b.owner).all<{ id: string; parts: string; photos: string }>()).results;
  const replies = posts.length ? (await env.DB.prepare(`SELECT r.id, r.post_id, r.body, r.suggestion, r.tried, r.created_at, u.handle, u.photo_id, (r.author = ?1) AS mine
      FROM build_replies r JOIN users u ON u.id = r.author JOIN build_posts p ON p.id = r.post_id
      WHERE p.build_id = ?2 AND (r.author = ?1 OR (${NOT_BLOCKED("r.author")} AND NOT ${reportedSql("reply", "r.id")}))
      ORDER BY r.created_at, r.rowid`).bind(v.id, id).all<{ post_id: string; suggestion: number; mine: number }>()).results : [];
  if (b.owner !== v.id && posts.length) {   // you've seen up to the newest post
    await env.DB.prepare("UPDATE build_follows SET seen_n = ? WHERE build_id = ? AND user_id = ?").bind((posts[0] as unknown as { n: number }).n, id, v.id).run();
  }
  const stages = JSON.parse(b.stages) as string[];
  return {
    id, mine: b.owner === v.id, stages, ...head, following: !!head?.following,
    posts: posts.map((p) => ({ ...p, parts: JSON.parse(p.parts) as string[], photos: (JSON.parse(p.photos || "[]") as (string | null)[]).filter(Boolean),
      replies: replies.filter((r) => r.post_id === p.id).map(({ post_id: _p, ...r }) => ({ ...r, suggestion: !!r.suggestion, mine: !!r.mine })) })),
  };
}

/** GET /api/builds?car=<id> → { id } or null; GET /api/builds?crew=<id> → the builds of that crew's members you can see. */
export async function buildFind(env: Env, v: Viewer, url: URL) {
  const car = url.searchParams.get("car"), crew = url.searchParams.get("crew");
  if (car) {
    return (await env.DB.prepare(`SELECT b.id FROM builds b JOIN cars c ON c.id = b.car_id WHERE b.car_id = ?2 AND ${CAR_SEEN("c")}`).bind(v.id, car).first()) ?? null;
  }
  if (!crew) throw new HttpError(400, "bad_query");
  if (!(await env.DB.prepare("SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?").bind(crew, v.id).first())) throw new HttpError(404, "no_crew");
  return (await env.DB.prepare(`SELECT b.id, u.handle, c.year, c.make, c.model, c.nickname, c.cover_photo_id,
      (SELECT COUNT(*) FROM build_posts p WHERE p.build_id = b.id) AS posts, (SELECT MAX(created_at) FROM build_posts p WHERE p.build_id = b.id) AS last
      FROM builds b JOIN cars c ON c.id = b.car_id JOIN users u ON u.id = b.owner JOIN crew_members m ON m.user_id = b.owner AND m.crew_id = ?2
      WHERE ${CAR_SEEN("c")} ORDER BY last IS NULL, last DESC LIMIT 20`).bind(v.id, crew).all()).results;
}

/** GET /api/builds/following: builds you follow, with how many posts are new since you last looked. */
export async function buildsFollowing(env: Env, v: Viewer) {
  return (await env.DB.prepare(`SELECT b.id, u.handle, c.year, c.make, c.model, c.nickname, c.cover_photo_id,
      (SELECT COALESCE(MAX(n), 0) FROM build_posts p WHERE p.build_id = b.id) - f.seen_n AS new_posts,
      (SELECT MAX(created_at) FROM build_posts p WHERE p.build_id = b.id) AS last
      FROM build_follows f JOIN builds b ON b.id = f.build_id JOIN cars c ON c.id = b.car_id JOIN users u ON u.id = b.owner
      WHERE f.user_id = ?1 AND ${CAR_SEEN("c")} ORDER BY last IS NULL, last DESC LIMIT 50`).bind(v.id).all()).results
    .map((r) => ({ ...r, new_posts: Math.max(0, Number((r as { new_posts: number }).new_posts) || 0) }));
}

/** PUT|DELETE /api/builds/:id/follow */
export async function buildFollow(env: Env, v: Viewer, id: string, on: boolean): Promise<void> {
  const b = await seenBuild(env, v, id);
  if (b.owner === v.id) throw new HttpError(400, "own_build");
  await env.DB.prepare(on
    ? "INSERT OR IGNORE INTO build_follows (build_id, user_id, seen_n) SELECT ?1, ?2, COALESCE((SELECT MAX(n) FROM build_posts WHERE build_id = ?1), 0)"
    : "DELETE FROM build_follows WHERE build_id = ?1 AND user_id = ?2").bind(id, v.id).run();
}

/** POST /api/builds/:id/posts { title, body, stage, parts, score }: the next numbered step. */
export async function postCreate(env: Env, v: Viewer, id: string, req: Request): Promise<{ id: string; n: number }> {
  const bld = await ownBuild(env, v, id);
  const b = await body<{ title?: unknown; body?: unknown; stage?: unknown; parts?: unknown; score?: unknown }>(req);
  const title = text(b.title, "title", 80, true), text2 = text(b.body, "body", 4000), parts = partsOf(b.parts);
  const stages = JSON.parse(bld.stages) as string[];
  const stage = b.stage === undefined || b.stage === null ? null : b.stage;
  if (stage !== null && !(Number.isInteger(stage) && (stage as number) >= 0 && (stage as number) < stages.length)) throw new HttpError(400, "bad_stage");
  const score = b.score === undefined || b.score === null ? null : b.score;
  if (score !== null && !(Number.isInteger(score) && (score as number) >= 0 && (score as number) <= 1000)) throw new HttpError(400, "bad_score");
  const pid = crypto.randomUUID();
  const r = await env.DB.prepare(`INSERT INTO build_posts (id, build_id, n, stage, title, body, parts, score)
      SELECT ?1, ?2, COALESCE(MAX(n), 0) + 1, ?3, ?4, ?5, ?6, ?7 FROM build_posts WHERE build_id = ?2 HAVING COUNT(*) < ${MAX_POSTS}`)
    .bind(pid, id, stage, title, text2, JSON.stringify(parts), score).run();
  if (!r.meta.changes) throw new HttpError(429, "too_many_posts");
  const n = await env.DB.prepare("SELECT n FROM build_posts WHERE id = ?").bind(pid).first<{ n: number }>();
  return { id: pid, n: n!.n };
}

/** DELETE /api/builds/posts/:post: the owner takes a step down (its photos with it). */
export async function postDelete(env: Env, v: Viewer, postId: string): Promise<void> {
  const p = await env.DB.prepare("SELECT p.id FROM build_posts p JOIN builds b ON b.id = p.build_id WHERE p.id = ? AND b.owner = ?").bind(postId, v.id).first();
  if (!p) throw new HttpError(404, "no_post");
  const ids = (await env.DB.prepare("SELECT id FROM photos WHERE kind = 'post' AND ref_id = ?").bind(postId).all<{ id: string }>()).results.map((r) => r.id);
  if (env.PHOTOS) for (const pid of ids) await env.PHOTOS.delete(`p/${pid}`);
  await env.DB.batch([env.DB.prepare("DELETE FROM photos WHERE kind = 'post' AND ref_id = ?").bind(postId), env.DB.prepare("DELETE FROM build_posts WHERE id = ?").bind(postId)]);
}

async function seenPost(env: Env, v: Viewer, postId: string) {
  const p = await env.DB.prepare(`SELECT p.id, b.owner, b.id AS build_id FROM build_posts p JOIN builds b ON b.id = p.build_id JOIN cars c ON c.id = b.car_id
      WHERE p.id = ?2 AND ${CAR_SEEN("c")}`).bind(v.id, postId).first<{ id: string; owner: string; build_id: string }>();
  if (!p) throw new HttpError(404, "no_post");
  return p;
}

/** POST /api/builds/posts/:post/replies { body, suggestion } */
export async function replyCreate(env: Env, v: Viewer, postId: string, req: Request): Promise<{ id: string }> {
  await seenPost(env, v, postId);
  const b = await body<{ body?: unknown; suggestion?: unknown }>(req);
  const t = text(b.body, "body", REPLY_MAX, true);
  if (b.suggestion !== undefined && typeof b.suggestion !== "boolean") throw new HttpError(400, "bad_suggestion");
  const id = crypto.randomUUID();
  const r = await env.DB.prepare(`INSERT INTO build_replies (id, post_id, author, body, suggestion) SELECT ?1, ?2, ?3, ?4, ?5
      WHERE (SELECT COUNT(*) FROM build_replies WHERE author = ?3 AND created_at > datetime('now', '-1 hour')) < ${REPLIES_PER_HOUR}`)
    .bind(id, postId, v.id, t, b.suggestion === true ? 1 : 0).run();
  if (!r.meta.changes) throw new HttpError(429, "slow_down");
  return { id };
}

/** PUT /api/builds/replies/:reply/tried { tried }: the build's owner answers a suggestion ("Tried it: ..."); null clears. */
export async function replyTried(env: Env, v: Viewer, replyId: string, req: Request): Promise<void> {
  const tried = text((await body<{ tried?: unknown }>(req)).tried, "tried", 200);
  const r = await env.DB.prepare(`UPDATE build_replies SET tried = ?1 WHERE id = ?2 AND suggestion = 1
      AND post_id IN (SELECT p.id FROM build_posts p JOIN builds b ON b.id = p.build_id WHERE b.owner = ?3)`).bind(tried, replyId, v.id).run();
  if (!r.meta.changes) throw new HttpError(404, "no_suggestion");
}

/** DELETE /api/builds/replies/:reply: its author, or the build's owner. */
export async function replyDelete(env: Env, v: Viewer, replyId: string): Promise<void> {
  const r = await env.DB.prepare(`DELETE FROM build_replies WHERE id = ?1 AND (author = ?2
      OR post_id IN (SELECT p.id FROM build_posts p JOIN builds b ON b.id = p.build_id WHERE b.owner = ?2))`).bind(replyId, v.id).run();
  if (!r.meta.changes) throw new HttpError(404, "no_reply");
}
