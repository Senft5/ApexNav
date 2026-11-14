// For you (docs/SOCIAL.md 2.10): one list of what happened to you socially, newest first, made only from what each part
// already shows you elsewhere (no new table, nothing new shared). A friend topping your best Score on one of your stages,
// someone passing your time in this week's time attack, kudos on your runs, a duel decided or accepted, new followers
// of your roadbooks, new roads in roadbooks you follow, a crew drive you haven't answered, kudos and comments on your drive posts (and new comments on a post
// you commented on); and what waits on you (friend requests, duels asked of you).
// What has been seen is kept on the phone (web/inbox.js), so this needs no write and no migration.
import type { Viewer } from "./auth";
import type { Env } from "./util";
import { VISIBLE_FROM_OTHERS } from "./social";
import { kudosReceived } from "./kudos";
import { duelList } from "./duels";
import { POST_SEEN, mentionsOf } from "./drive_posts";
import { reportedSql } from "./reports_sql";
import { CAN_SEE as BOOK_SEEN } from "./roadbooks";

export const DAYS = 14, TOPPED_DAYS = 7, MAX_ITEMS = 40;
const all = async <T>(env: Env, sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).all<T>()).results;
const NO_BLOCK = (a: string, b: string) => `NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.blocker = ${a} AND k.blocked = ${b}) OR (k.blocker = ${b} AND k.blocked = ${a}))`;
const WEEK = "date('now', '-6 days', 'weekday 1')";

export type Item = { kind: string; at: string; [k: string]: unknown };

type PostRow = { post_id: string; title: string; handle: string; at: string; yours: number; owner: string | null };
/** One row per post, newest first (the rows come newest first): who did it last, how many others, whose post it is. */
export function perPost(rows: PostRow[], max = 10) {
  const by = new Map<string, { post_id: string; title: string; handle: string; at: string; yours: boolean; owner: string | null; people: Set<string> }>();
  for (const r of rows) {
    const g = by.get(r.post_id);
    if (g) g.people.add(r.handle);
    else if (by.size < max) by.set(r.post_id, { post_id: r.post_id, title: r.title, handle: r.handle, at: r.at, yours: !!r.yours, owner: r.yours ? null : r.owner, people: new Set([r.handle]) });
  }
  return [...by.values()].map(({ people, ...g }) => ({ ...g, others: people.size - 1 }));
}

/** A finished duel, from the viewer's side: won, lost, draw, or none (nobody's run reached the other). */
export function duelOutcome(d: { kind: string; you: { score: number; time_s: number | null } | null; them: { score: number; time_s: number | null } | null }) {
  const timed = d.kind === "time";
  const val = (x: typeof d.you) => (!x ? null : timed ? x.time_s : x.score);
  const a = val(d.you), b = val(d.them);
  if (a == null && b == null) return "none";
  if (b == null) return "won";
  if (a == null) return "lost";
  if (a === b) return "draw";
  return (timed ? a < b : a > b) ? "won" : "lost";
}

export async function inbox(env: Env, v: Viewer) {
  const me = v.id;
  const [requests, topped, passed, passedFixed, kudos, duels, follows, drives, postKudos, postComments, mentioned, bookRoads] = await Promise.all([
    // a friend request waiting on you (the list shows it as a card; here it counts as waiting)
    all<{ handle: string; at: string }>(env,
      `SELECT u.handle, f.created_at AS at FROM friendships f JOIN users u ON u.id = f.requested_by
        WHERE f.status = 'pending' AND f.requested_by != ?1 AND (f.user_a = ?1 OR f.user_b = ?1) AND u.handle IS NOT NULL AND ${NO_BLOCK("u.id", "?1")}
        ORDER BY f.created_at DESC LIMIT 20`, me),
    // a friend's or crew-mate's run this week that tops your best Score on one of your stages (as published to you)
    all<{ handle: string; canon_id: string; stage: string; score: number; yours: number; at: string }>(env,
      `SELECT u.handle, be.canon_id, MIN(s.name) AS stage, MAX(be.driver_score) AS score, mine.best AS yours, MAX(be.created_at) AS at
         FROM board_entries be JOIN users u ON u.id = be.user_id
         JOIN (SELECT canon_id, MAX(driver_score) AS best FROM board_entries WHERE user_id = ?1 AND canon_id IS NOT NULL GROUP BY canon_id) mine ON mine.canon_id = be.canon_id
         JOIN segments s ON s.owner = ?1 AND COALESCE(s.origin_id, s.id) = be.canon_id
        WHERE be.user_id != ?1 AND u.handle IS NOT NULL AND be.created_at > datetime('now', '-${TOPPED_DAYS} days') AND be.driver_score > mine.best
          AND (${VISIBLE_FROM_OTHERS})
        GROUP BY be.user_id, be.canon_id ORDER BY at DESC LIMIT 10`, me),
    // someone went quicker than you on this week's time attack, after your time went up (entrants' board, by handle)
    all<{ handle: string; time_s: number; mine: number; at: string; stage: string | null; place: number }>(env,
      `SELECT u.handle, o.time_s, e.time_s AS mine, o.updated_at AS at, COALESCE(w.name, (SELECT name FROM segments WHERE id = w.segment_id)) AS stage,
              (SELECT COUNT(*) + 1 FROM ta_entries x WHERE x.week = e.week AND x.cell = e.cell AND x.time_s < e.time_s AND ${NO_BLOCK("x.user_id", "?1")}) AS place
         FROM ta_entries e JOIN ta_entries o ON o.week = e.week AND o.cell = e.cell AND o.user_id != e.user_id
         JOIN users u ON u.id = o.user_id JOIN ta_weeks w ON w.week = e.week AND w.cell = e.cell AND w.removed = 0
        WHERE e.user_id = ?1 AND e.week = ${WEEK} AND o.time_s < e.time_s AND o.updated_at > e.updated_at AND u.handle IS NOT NULL
          AND ${NO_BLOCK("o.user_id", "?1")}
        ORDER BY o.updated_at DESC LIMIT 3`, me),
    // the same on a fixed time attack (ta_fixed.ts): someone's best this week under yours, set after yours
    all<{ handle: string; time_s: number; mine: number; at: string; stage: string | null; place: number }>(env,
      `SELECT u.handle, o.t AS time_s, e.t AS mine, o.at, c.name AS stage,
              (SELECT COUNT(DISTINCT x.user_id) + 1 FROM ta_times x WHERE x.circuit_id = e.cid AND x.driven_on >= ${WEEK} AND x.time_s < e.t AND ${NO_BLOCK("x.user_id", "?1")}) AS place
         FROM (SELECT circuit_id AS cid, MIN(time_s) AS t, MAX(updated_at) AS at FROM ta_times WHERE user_id = ?1 AND driven_on >= ${WEEK} GROUP BY circuit_id) e
         JOIN (SELECT circuit_id AS cid, user_id, MIN(time_s) AS t, MAX(updated_at) AS at FROM ta_times WHERE user_id != ?1 AND driven_on >= ${WEEK} GROUP BY circuit_id, user_id) o ON o.cid = e.cid
         JOIN users u ON u.id = o.user_id JOIN ta_circuits c ON c.id = e.cid AND c.removed = 0
        WHERE o.t < e.t AND o.at > e.at AND u.handle IS NOT NULL AND ${NO_BLOCK("o.user_id", "?1")}
        ORDER BY o.at DESC LIMIT 3`, me),
    kudosReceived(env, v),
    duelList(env, v),
    // new followers of your roadbooks (counted, never named: a public book's followers may be strangers)
    all<{ book_id: string; book: string; n: number; at: string }>(env,
      `SELECT b.id AS book_id, b.name AS book, COUNT(*) AS n, MAX(f.created_at) AS at FROM roadbook_follows f JOIN roadbooks b ON b.id = f.book_id
        WHERE b.owner = ?1 AND f.user_id != ?1 AND f.created_at > datetime('now', '-${DAYS} days') AND ${NO_BLOCK("f.user_id", "?1")}
        GROUP BY b.id ORDER BY at DESC LIMIT 10`, me),
    // a crew drive coming up in one of your crews that you haven't answered
    all<{ event_id: string; title: string; starts_at: string; crew: string; crew_id: string; at: string }>(env,
      `SELECT e.id AS event_id, e.title, e.starts_at, c.name AS crew, c.id AS crew_id, e.created_at AS at
         FROM crew_events e JOIN crews c ON c.id = e.crew_id JOIN crew_members m ON m.crew_id = e.crew_id AND m.user_id = ?1
        WHERE e.cancelled = 0 AND e.created_by != ?1 AND e.starts_at > datetime('now')
          AND NOT EXISTS (SELECT 1 FROM crew_event_rsvps r WHERE r.event_id = e.id AND r.user_id = ?1) AND ${NO_BLOCK("e.created_by", "?1")}
        ORDER BY e.starts_at LIMIT 10`, me),
    // kudos on your drive posts (grouped per post below: the newest giver, and how many)
    all<PostRow>(env,
      `SELECT p.id AS post_id, p.title, u.handle, k.created_at AS at, 1 AS yours, NULL AS owner
         FROM drive_post_kudos k JOIN drive_posts p ON p.id = k.post_id JOIN users u ON u.id = k.user_id
        WHERE p.author = ?1 AND k.user_id != ?1 AND u.handle IS NOT NULL AND k.created_at > datetime('now', '-${DAYS} days') AND ${NO_BLOCK("k.user_id", "?1")}
        ORDER BY k.created_at DESC LIMIT 200`, me),
    // comments on your drive posts, and comments after yours on a post you commented on that you can still see
    all<PostRow>(env,
      `SELECT p.id AS post_id, p.title, u.handle, c.created_at AS at, p.author = ?1 AS yours, ou.handle AS owner
         FROM drive_comments c JOIN drive_posts p ON p.id = c.post_id JOIN users u ON u.id = c.author JOIN users ou ON ou.id = p.author
        WHERE c.author != ?1 AND u.handle IS NOT NULL AND c.created_at > datetime('now', '-${DAYS} days')
          AND ${NO_BLOCK("c.author", "?1")} AND NOT ${reportedSql("comment", "c.id")}
          AND (p.author = ?1 OR (c.created_at > (SELECT MAX(m.created_at) FROM drive_comments m WHERE m.post_id = p.id AND m.author = ?1) AND ${POST_SEEN("p")}))
        ORDER BY c.created_at DESC LIMIT 200`, me),
    // a comment that @mentions you on someone else's post you can see (your own posts' comments are the rows above)
    v.handle ? all<PostRow & { body: string }>(env,
      `SELECT p.id AS post_id, p.title, u.handle, c.created_at AS at, 0 AS yours, ou.handle AS owner, c.body
         FROM drive_comments c JOIN drive_posts p ON p.id = c.post_id JOIN users u ON u.id = c.author JOIN users ou ON ou.id = p.author
        WHERE c.author != ?1 AND p.author != ?1 AND u.handle IS NOT NULL AND c.created_at > datetime('now', '-${DAYS} days') AND c.body LIKE ?2
          AND ${NO_BLOCK("c.author", "?1")} AND NOT ${reportedSql("comment", "c.id")} AND ${POST_SEEN("p")}
        ORDER BY c.created_at DESC LIMIT 50`, me, `%@${v.handle}%`) : Promise.resolve([]),
    // new roads in a roadbook you follow, added after you followed it, while you may still open it (one row a book)
    all<{ book_id: string; book: string; by: string | null; n: number; road: string; at: string }>(env,
      `SELECT b.id AS book_id, b.name AS book, u.handle AS by, COUNT(*) AS n, MAX(r.name) AS road, MAX(r.created_at) AS at
         FROM roadbook_follows f JOIN roadbooks b ON b.id = f.book_id JOIN roadbook_roads r ON r.book_id = b.id JOIN users u ON u.id = b.owner
        WHERE f.user_id = ?1 AND b.owner != ?1 AND r.created_at > f.created_at AND r.created_at > datetime('now', '-${DAYS} days') AND ${BOOK_SEEN}
        GROUP BY b.id ORDER BY at DESC LIMIT 10`, me),
  ]);
  const items: Item[] = [];
  for (const r of requests) items.push({ kind: "request", at: r.at, handle: r.handle, waiting: true });
  for (const t of topped) items.push({ kind: "topped", at: t.at, handle: t.handle, canon_id: t.canon_id, stage: t.stage, score: t.score, yours: t.yours });
  for (const p of [...passed, ...passedFixed]) items.push({ kind: "passed", at: p.at, handle: p.handle, stage: p.stage, gap_s: p.mine - p.time_s, place: p.place });
  const since = Date.now() - DAYS * 86400000;
  for (const k of kudos as { from_handle: string; stage: string | null; canon_id: string; driven_on: string; created_at: string }[]) {
    if (Date.parse(k.created_at.replace(" ", "T") + "Z") < since) continue;
    items.push({ kind: "kudos", at: k.created_at, handle: k.from_handle, stage: k.stage, canon_id: k.canon_id, driven_on: k.driven_on });
  }
  const sinceDay = new Date(since).toISOString().slice(0, 10);
  for (const d of duels) {
    if (d.status === "pending" && !d.challenger) items.push({ kind: "duel_ask", at: d.created_at, handle: d.with, stage: d.stage, duel_kind: d.kind, waiting: true });
    else if (d.status === "on" && d.challenger && d.starts_on && d.starts_on >= sinceDay)
      items.push({ kind: "duel_on", at: `${d.starts_on} 00:00:00`, handle: d.with, stage: d.stage, ends_on: d.ends_on, canon_id: d.canon_id, have_stage: d.have_stage });
    else if (d.status === "over" && d.ends_on && d.ends_on >= sinceDay)
      items.push({ kind: "duel_over", at: `${d.ends_on} 23:59:59`, handle: d.with, stage: d.stage, duel_kind: d.kind, result: duelOutcome(d) });
  }
  for (const f of follows) items.push({ kind: "follows", at: f.at, book_id: f.book_id, book: f.book, n: f.n });
  for (const r of bookRoads) items.push({ kind: "book_roads", at: r.at, book_id: r.book_id, book: r.book, handle: r.by, n: r.n, road: r.n === 1 ? r.road : null });
  for (const e of drives) items.push({ kind: "crew_drive", at: e.at, event_id: e.event_id, title: e.title, starts_at: e.starts_at, crew: e.crew, crew_id: e.crew_id });
  // a mention says more than "also commented": one row per post, the mention's
  const mentions = perPost(mentioned.filter((r) => mentionsOf(r.body, null).includes(v.handle!)).map(({ body: _b, ...r }) => r)), mPosts = new Set(mentions.map((g) => g.post_id));
  for (const g of mentions) items.push({ kind: "post_mention", ...g });
  for (const g of perPost(postKudos)) items.push({ kind: "post_kudos", ...g });
  for (const g of perPost(postComments)) if (g.yours || !mPosts.has(g.post_id)) items.push({ kind: "post_comment", ...g });
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const list = items.slice(0, MAX_ITEMS);
  return { items: list, waiting: list.filter((i) => i.waiting).length, now: new Date().toISOString().replace("T", " ").slice(0, 19) };
}
