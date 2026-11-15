// Direct messages (2026-11-14, migration 0065): one friend to another, as in any social app. A conversation is the pair's
// messages, newest last. Written only between friends who haven't blocked each other; once unfriended the history stays
// readable to both, and nothing new can be sent. Blocks hide the whole conversation both ways. A message can be reported
// (kind "dm", safety.ts): the reporter no longer sees it, and the owner's queue gets it. Its sender can unsend it.
// Pushes carry who wrote, never the words (push.ts PUSH.message).
import type { Viewer } from "./auth";
import { Env, HttpError, body, pair } from "./util";
import { cleanText } from "./convoy";

export const DM_MAX = 1000, DM_PAGE = 50, DM_PER_HOUR = 60, DM_KEEP_DAYS = 365, DM_LIST = 50;
export const DM_SWEEP = `DELETE FROM direct_messages WHERE created_at <= datetime('now', '-${DM_KEEP_DAYS} days')`;
const NO_BLOCK = (who: string) =>
  `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = ${who}) OR (b.blocker = ${who} AND b.blocked = ?1))`;
/** Not reported by you: a message you reported leaves your side of the conversation. */
const NOT_REPORTED = (m: string) => `NOT EXISTS (SELECT 1 FROM reports r WHERE r.kind = 'dm' AND r.target_id = ${m}.id AND r.reporter = ?1)`;
const pairKey = (a: string, b: string) => pair(a, b).join(":");

interface Other { id: string; handle: string; photo_id: string | null; friend: number }
async function otherOf(env: Env, v: Viewer, handleRaw: string): Promise<Other> {
  const handle = handleRaw.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,20}$/.test(handle)) throw new HttpError(400, "bad_handle");
  const o = await env.DB.prepare(`SELECT u.id, u.handle, u.photo_id,
      EXISTS (SELECT 1 FROM friendships f WHERE f.user_a = MIN(u.id, ?1) AND f.user_b = MAX(u.id, ?1) AND f.status = 'accepted') AS friend
      FROM users u WHERE u.handle = ?2 AND u.id != ?1 AND ${NO_BLOCK("u.id")}`).bind(v.id, handle).first<Other>();
  if (!o) throw new HttpError(404, "no_member");
  return o;
}

/** GET /api/messages: your conversations, the newest first: who, their last message, and how many from them you haven't read. */
export async function dmList(env: Env, v: Viewer) {
  const rows = (await env.DB.prepare(`SELECT u.handle, u.photo_id, t.at, t.unread,
      (SELECT x.body FROM direct_messages x WHERE x.pair = t.pair AND (x.sender = ?1 OR ${NOT_REPORTED("x")}) ORDER BY x.created_at DESC, x.rowid DESC LIMIT 1) AS last,
      (SELECT x.sender = ?1 FROM direct_messages x WHERE x.pair = t.pair AND (x.sender = ?1 OR ${NOT_REPORTED("x")}) ORDER BY x.created_at DESC, x.rowid DESC LIMIT 1) AS mine,
      EXISTS (SELECT 1 FROM friendships f WHERE f.user_a = MIN(u.id, ?1) AND f.user_b = MAX(u.id, ?1) AND f.status = 'accepted') AS friend
    FROM (SELECT m.pair, CASE WHEN m.sender = ?1 THEN m.recipient ELSE m.sender END AS other, MAX(m.created_at) AS at,
            SUM(m.recipient = ?1 AND m.read_at IS NULL AND ${NOT_REPORTED("m")}) AS unread
          FROM direct_messages m WHERE m.sender = ?1 OR m.recipient = ?1 GROUP BY m.pair) t
    JOIN users u ON u.id = t.other
    WHERE ${NO_BLOCK("u.id")}
    ORDER BY t.at DESC LIMIT ${DM_LIST}`).bind(v.id).all<{ handle: string; photo_id: string | null; at: string; unread: number; last: string | null; mine: number | null; friend: number }>()).results;
  return rows.filter((r) => r.last !== null).map((r) => ({ handle: r.handle, photo_id: r.photo_id, at: r.at, unread: r.unread || 0, last: r.last, mine: !!r.mine, friend: !!r.friend }));
}

/** GET /api/me/messages/unread → { unread }: messages to you not yet read, for the People badge. */
export async function dmUnread(env: Env, v: Viewer): Promise<{ unread: number }> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM direct_messages m WHERE m.recipient = ?1 AND m.read_at IS NULL
      AND ${NO_BLOCK("m.sender")} AND ${NOT_REPORTED("m")}`).bind(v.id).first<{ n: number }>();
  return { unread: r ? r.n : 0 };
}

/** GET /api/messages/:handle?before=: the conversation with one member, a page of it, oldest first; reading it marks theirs read. */
export async function dmThread(env: Env, v: Viewer, handle: string, url: URL) {
  const o = await otherOf(env, v, handle);
  const before = url.searchParams.get("before");
  if (before !== null && !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(before)) throw new HttpError(400, "bad_before");
  const key = pairKey(v.id, o.id);
  const [list] = await env.DB.batch([
    env.DB.prepare(`SELECT m.id, m.body, m.created_at AS at, (m.sender = ?1) AS mine, m.read_at FROM direct_messages m
        WHERE m.pair = ?2 ${before ? "AND m.created_at < ?3" : ""} AND (m.sender = ?1 OR ${NOT_REPORTED("m")})
        ORDER BY m.created_at DESC, m.rowid DESC LIMIT ${DM_PAGE}`).bind(...(before ? [v.id, key, before] : [v.id, key])),
    env.DB.prepare("UPDATE direct_messages SET read_at = datetime('now') WHERE pair = ?1 AND recipient = ?2 AND read_at IS NULL").bind(key, v.id),
  ]);
  const rows = (list.results as { id: string; body: string; at: string; mine: number; read_at: string | null }[]).reverse();
  return { with: { handle: o.handle, photo_id: o.photo_id, friend: !!o.friend },
    messages: rows.map((r) => ({ id: r.id, body: r.body, at: r.at, mine: !!r.mine, ...(r.mine ? { seen: !!r.read_at } : {}) })) };
}

/** POST /api/messages/:handle {body}: to a friend; sixty an hour at most. */
export async function dmSend(env: Env, v: Viewer, handle: string, req: Request): Promise<{ id: string; to: string }> {
  const o = await otherOf(env, v, handle);
  if (!o.friend) throw new HttpError(403, "friends_only");
  const b = await body<{ body?: unknown }>(req);
  const text = cleanText(b.body, DM_MAX)?.trim();
  if (!text) throw new HttpError(400, "bad_body");
  const id = crypto.randomUUID();
  const ins = await env.DB.prepare(`INSERT INTO direct_messages (id, pair, sender, recipient, body) SELECT ?1, ?2, ?3, ?4, ?5
      WHERE (SELECT COUNT(*) FROM direct_messages WHERE sender = ?3 AND created_at > datetime('now', '-1 hour')) < ${DM_PER_HOUR}`)
    .bind(id, pairKey(v.id, o.id), v.id, o.id, text).run();
  if (!ins.meta.changes) throw new HttpError(429, "slow_down");
  return { id, to: o.id };
}

/** DELETE /api/messages/m/:id: unsend one of yours. */
export async function dmDelete(env: Env, v: Viewer, id: string): Promise<void> {
  const r = await env.DB.prepare("DELETE FROM direct_messages WHERE id = ?1 AND sender = ?2").bind(id, v.id).run();
  if (!r.meta.changes) throw new HttpError(404, "no_message");
}
