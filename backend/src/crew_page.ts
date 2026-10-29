// The crew page (docs/design/REVIEW.md roadmap 20, mockup 09-crew-page.html): the crew's face (cover, crest, motto, stripe),
// its next drive, its Vetta Score board this month and its chat. Members only. Plain livery: the owner sets the motto, a
// stock crest and one stripe colour; the cover is a photo (photos.ts). Decals and the higher tiers come later (roadmap 22).
import type { Viewer } from "./auth";
import { Env, HttpError, body } from "./util";
import { cleanText } from "./convoy";
import { isCrewMember } from "./social";
import { eventsList } from "./events";
import { reportedSql } from "./reports_sql";
import { PATTERNS, atLeast, liveryOf, myDecals, type Tier } from "./livery";

/** The stock crests, drawn in web/crew_page.js. */
export const CRESTS = ["apex", "peak", "tulip", "wheel", "wing", "crown"] as const;
export const CHAT_MAX = 500, CHAT_PAGE = 50, CHAT_PER_HOUR = 30, CHAT_KEEP_DAYS = 30;
export const CHAT_SWEEP = `DELETE FROM crew_chat WHERE created_at <= datetime('now', '-${CHAT_KEEP_DAYS} days')`;
const STRIPE_RE = /^#[0-9a-f]{6}$/;
const NOT_BLOCKED = (who: string) =>
  `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = ${who}) OR (b.blocker = ${who} AND b.blocked = ?1))`;

interface CrewRow { id: string; name: string; owner: string; visibility: string; about: string | null; area_name: string | null; motto: string | null;
  crest: string | null; stripe: string | null; cover_photo_id: string | null; crest_photo_id: string | null; members: number;
  stripe2: string | null; stripe3: string | null; pattern: string | null; pinned_route_id: string | null; pinned_name: string | null }
interface BoardRow { handle: string | null; photo_id: string | null; score: number | null; mine: number; car: string | null }

/** GET /api/crews/:id/page */
export async function crewPage(env: Env, v: Viewer, crewId: string) {
  if (!(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const c = await env.DB.prepare(`SELECT c.id, c.name, c.owner, c.visibility, c.about, c.area_name, c.motto, c.crest, c.stripe, c.cover_photo_id, c.crest_photo_id,
      c.stripe2, c.stripe3, c.pattern, c.pinned_route_id, (SELECT r.name FROM shared_routes r WHERE r.id = c.pinned_route_id) AS pinned_name,
      (SELECT COUNT(*) FROM crew_members x WHERE x.crew_id = c.id) AS members FROM crews c WHERE c.id = ?`).bind(crewId).first<CrewRow>();
  if (!c) throw new HttpError(404, "no_crew");
  // The board: every member you can see, with their best Score this month as published to this crew (grant on), else
  // null. A member's car is named only in a private crew, where crew-mates already see shown cars (garage.ts).
  const board = (await env.DB.prepare(
    `SELECT u.handle, u.photo_id, (m.user_id = ?1) AS mine,
            (SELECT MAX(be.driver_score) FROM board_entries be
               WHERE be.user_id = m.user_id AND be.audience_type = 'crew' AND be.audience_id = ?2 AND be.driven_on >= date('now', 'start of month')
                 AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = m.user_id AND g.audience_type = 'crew' AND g.audience_id = ?2 AND g.share_scores = 1)) AS score,
            CASE WHEN ?3 = 'private' THEN (SELECT TRIM(car.make || ' ' || car.model) FROM cars car
               WHERE car.owner = m.user_id AND car.shared = 1 AND (car.owner = ?1 OR NOT ${reportedSql("car", "car.id")}) ORDER BY car.is_primary DESC, car.created_at LIMIT 1) END AS car
       FROM crew_members m JOIN users u ON u.id = m.user_id
      WHERE m.crew_id = ?2 AND (m.user_id = ?1 OR ${NOT_BLOCKED("m.user_id")})
      ORDER BY score IS NULL, score DESC, u.handle LIMIT 100`).bind(v.id, crewId, c.visibility).all<BoardRow>()).results;
  const now = Date.now(), next = (await eventsList(env, v, crewId)).find((e) => Date.parse(e.starts_at) > now - 3600_000) ?? null;
  const livery = await liveryOf(env, crewId), mine = await myDecals(env, v.id, crewId);
  // what's unlocked shows only what the tier allows, so a crew that drops a tier falls back to the Plain look
  const club = atLeast(livery.tier, "club"), works = atLeast(livery.tier, "works");
  // the owner's choice for the pinned route: routes shared with this crew, newest first
  const routes = c.owner === v.id ? (await env.DB.prepare(`SELECT r.id, r.name FROM shared_routes r JOIN shared_route_audience a ON a.route_id = r.id
      WHERE a.audience_type = 'crew' AND a.audience_id = ? ORDER BY r.created_at DESC LIMIT 20`).bind(crewId).all<{ id: string; name: string }>()).results : undefined;
  const grant = await env.DB.prepare("SELECT share_scores FROM grants WHERE user_id = ? AND audience_type = 'crew' AND audience_id = ?").bind(v.id, crewId).first<{ share_scores: number }>();
  return {
    id: c.id, name: c.name, motto: c.motto, about: c.about, visibility: c.visibility, area_name: c.area_name, members: c.members,
    is_owner: c.owner === v.id, crest: c.crest, stripe: c.stripe, cover_photo_id: c.cover_photo_id,
    livery: { ...livery, mine }, stripe2: club ? c.stripe2 : null, stripe3: works ? c.stripe3 : null, pattern: works ? c.pattern : null,
    crest_photo_id: club ? c.crest_photo_id : null, pinned: club && c.pinned_route_id && c.pinned_name ? { id: c.pinned_route_id, name: c.pinned_name } : null, routes, board: board.map((r) => ({ ...r, mine: !!r.mine })), next, sharing_scores: !!grant?.share_scores,
  };
}

/** PUT /api/crews/:id/page (owner): { motto?, crest?, stripe? }; null clears one. */
export async function crewPageUpdate(env: Env, v: Viewer, crewId: string, req: Request): Promise<void> {
  const own = await env.DB.prepare("SELECT 1 FROM crews WHERE id = ? AND owner = ?").bind(crewId, v.id).first();
  if (!own) throw new HttpError(404, "no_crew");
  const b = await body<{ motto?: unknown; crest?: unknown; stripe?: unknown; stripe2?: unknown; stripe3?: unknown; pattern?: unknown; pinned_route_id?: unknown }>(req);
  const sets: string[] = [], args: unknown[] = [];
  let tier: Tier | null = null;
  const need = async (t: Tier) => { tier = tier ?? (await liveryOf(env, crewId)).tier; if (!atLeast(tier, t)) throw new HttpError(403, `needs_${t}`); };
  const colour = (v: unknown, k: string) => { const s = typeof v === "string" ? v.toLowerCase() : v; if (s !== null && (typeof s !== "string" || !STRIPE_RE.test(s))) throw new HttpError(400, `bad_${k}`); return s; };
  // Club: a second stripe colour and a pinned route. Works: a third colour and a pattern. Clearing is always allowed.
  if (b.stripe2 !== undefined) { if (b.stripe2 !== null) await need("club"); sets.push("stripe2 = ?"); args.push(colour(b.stripe2, "stripe2")); }
  if (b.stripe3 !== undefined) { if (b.stripe3 !== null) await need("works"); sets.push("stripe3 = ?"); args.push(colour(b.stripe3, "stripe3")); }
  if (b.pattern !== undefined) {
    if (b.pattern !== null && !PATTERNS.includes(b.pattern as typeof PATTERNS[number])) throw new HttpError(400, "bad_pattern");
    if (b.pattern !== null) await need("works");
    sets.push("pattern = ?"); args.push(b.pattern);
  }
  if (b.pinned_route_id !== undefined) {
    if (b.pinned_route_id !== null) {
      await need("club");
      const ok = typeof b.pinned_route_id === "string" && await env.DB.prepare("SELECT 1 FROM shared_route_audience WHERE route_id = ? AND audience_type = 'crew' AND audience_id = ?")
        .bind(b.pinned_route_id, crewId).first();
      if (!ok) throw new HttpError(400, "bad_route");
    }
    sets.push("pinned_route_id = ?"); args.push(b.pinned_route_id);
  }
  if (b.motto !== undefined) {
    const m = b.motto === null || b.motto === "" ? null : cleanText(b.motto, 80)?.replace(/\s+/g, " ").trim() || null;
    if (b.motto && !m) throw new HttpError(400, "bad_motto");
    sets.push("motto = ?"); args.push(m);
  }
  if (b.crest !== undefined) {
    if (b.crest !== null && !CRESTS.includes(b.crest as typeof CRESTS[number])) throw new HttpError(400, "bad_crest");
    sets.push("crest = ?"); args.push(b.crest);
  }
  if (b.stripe !== undefined) {
    const s = typeof b.stripe === "string" ? b.stripe.toLowerCase() : b.stripe;
    if (s !== null && (typeof s !== "string" || !STRIPE_RE.test(s))) throw new HttpError(400, "bad_stripe");
    sets.push("stripe = ?"); args.push(s);
  }
  if (!sets.length) return;
  await env.DB.prepare(`UPDATE crews SET ${sets.join(", ")} WHERE id = ?`).bind(...args, crewId).run();
}

/** GET /api/crews/:id/chat[?before=<iso>]: up to CHAT_PAGE messages, oldest first; none from blocked people or hidden by reports. */
export async function chatList(env: Env, v: Viewer, crewId: string, url: URL) {
  if (!(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const before = url.searchParams.get("before");
  if (before !== null && !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(before)) throw new HttpError(400, "bad_before");
  const rows = (await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, u.handle, u.photo_id, (c.author = ?1) AS mine
       FROM crew_chat c JOIN users u ON u.id = c.author
      WHERE c.crew_id = ?2 ${before ? "AND c.created_at < ?3" : ""}
        AND (c.author = ?1 OR (${NOT_BLOCKED("c.author")} AND NOT ${reportedSql("chat", "c.id")}))
        AND EXISTS (SELECT 1 FROM crew_members m WHERE m.crew_id = c.crew_id AND m.user_id = c.author)
      ORDER BY c.created_at DESC, c.rowid DESC LIMIT ${CHAT_PAGE}`).bind(...(before ? [v.id, crewId, before] : [v.id, crewId])).all<{ mine: number }>()).results;
  return rows.reverse().map((r) => ({ ...r, mine: !!r.mine }));
}

/** POST /api/crews/:id/chat { body } */
export async function chatPost(env: Env, v: Viewer, crewId: string, req: Request): Promise<{ id: string }> {
  if (!(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const b = await body<{ body?: unknown }>(req);
  const text = cleanText(b.body, CHAT_MAX)?.trim();
  if (!text) throw new HttpError(400, "bad_body");
  const id = crypto.randomUUID();
  // the hourly cap is checked by the insert itself
  const ins = await env.DB.prepare(`INSERT INTO crew_chat (id, crew_id, author, body) SELECT ?1, ?2, ?3, ?4
      WHERE (SELECT COUNT(*) FROM crew_chat WHERE author = ?3 AND created_at > datetime('now', '-1 hour')) < ${CHAT_PER_HOUR}`).bind(id, crewId, v.id, text).run();
  if (!ins.meta.changes) throw new HttpError(429, "slow_down");
  return { id };
}

/** DELETE /api/crews/:id/chat/:msg: its author, or the crew's owner. */
export async function chatDelete(env: Env, v: Viewer, crewId: string, msgId: string): Promise<void> {
  const r = await env.DB.prepare(`DELETE FROM crew_chat WHERE id = ?1 AND crew_id = ?2
      AND (author = ?3 OR EXISTS (SELECT 1 FROM crews c WHERE c.id = ?2 AND c.owner = ?3))`).bind(msgId, crewId, v.id).run();
  if (!r.meta.changes) throw new HttpError(404, "no_message");
}
