// The crew page (docs/design/REVIEW.md roadmap 20, mockup 09-crew-page.html): the crew's face (cover, crest, motto, stripe),
// its next drive, its Vetta Score board this month and its chat. Members only. Plain livery: the owner sets the motto, a
// stock crest and one stripe colour; the cover is a photo (photos.ts). Decals and the higher tiers come later (roadmap 22).
import type { Viewer } from "./auth";
import { Env, HttpError, body, num } from "./util";
import { cleanText } from "./convoy";
import { isCrewMember } from "./social";
import { RECORD_AFTER_H, eventsList, lastEvent } from "./events";
import { reportedSql } from "./reports_sql";
import { PATTERNS, atLeast, liveryOf, myDecals, templateCap, type Tier } from "./livery";

/** The stock crests, drawn in web/crew_page.js. */
export const CRESTS = ["apex", "peak", "tulip", "wheel", "wing", "crown"] as const;
export const CHAT_MAX = 500, CHAT_PAGE = 50, CHAT_PER_HOUR = 30, CHAT_KEEP_DAYS = 30;
export const CHAT_SWEEP = `DELETE FROM crew_chat WHERE created_at <= datetime('now', '-${CHAT_KEEP_DAYS} days')`;
const STRIPE_RE = /^#[0-9a-f]{6}$/;
const NOT_BLOCKED = (who: string) =>
  `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = ${who}) OR (b.blocker = ${who} AND b.blocked = ?1))`;

interface CrewRow { id: string; name: string; owner: string; visibility: string; about: string | null; area_name: string | null; motto: string | null;
  crest: string | null; stripe: string | null; cover_photo_id: string | null; crest_photo_id: string | null; members: number;
  stripe2: string | null; stripe3: string | null; pattern: string | null; pinned_route_id: string | null; pinned_name: string | null;
  pinned_chat_id: string | null; house_canon_id: string | null; call_sign: string | null; hazard_kinds: string; regroup_line: string | null; invites: string }
interface BoardRow { handle: string | null; photo_id: string | null; score: number | null; mine: number; car: string | null; badge: string | null }

/** GET /api/crews/:id/page */
export async function crewPage(env: Env, v: Viewer, crewId: string) {
  if (!(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const c = await env.DB.prepare(`SELECT c.id, c.name, c.owner, c.visibility, c.about, c.area_name, c.motto, c.crest, c.stripe, c.cover_photo_id, c.crest_photo_id,
      c.stripe2, c.stripe3, c.pattern, c.pinned_route_id, (SELECT r.name FROM shared_routes r WHERE r.id = c.pinned_route_id) AS pinned_name,
      c.pinned_chat_id, c.house_canon_id, c.call_sign, c.hazard_kinds, c.regroup_line, c.invites,
      (SELECT COUNT(*) FROM crew_members x WHERE x.crew_id = c.id) AS members FROM crews c WHERE c.id = ?`).bind(crewId).first<CrewRow>();
  if (!c) throw new HttpError(404, "no_crew");
  // The board: every member you can see, with their best Score this month as published to this crew (grant on), else
  // null. A member's car is named only in a private crew, where crew-mates already see shown cars (garage.ts).
  const board = (await env.DB.prepare(
    `SELECT u.handle, u.photo_id, (m.user_id = ?1) AS mine, m.badge,
            (SELECT MAX(be.driver_score) FROM board_entries be
               WHERE be.user_id = m.user_id AND be.audience_type = 'crew' AND be.audience_id = ?2 AND be.driven_on >= date('now', 'start of month')
                 AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = m.user_id AND g.audience_type = 'crew' AND g.audience_id = ?2 AND g.share_scores = 1)) AS score,
            CASE WHEN ?3 = 'private' THEN (SELECT TRIM(car.make || ' ' || car.model) FROM cars car
               WHERE car.owner = m.user_id AND car.shared = 1 AND (car.owner = ?1 OR NOT ${reportedSql("car", "car.id")}) ORDER BY car.is_primary DESC, car.created_at LIMIT 1) END AS car
       FROM crew_members m JOIN users u ON u.id = m.user_id
      WHERE m.crew_id = ?2 AND (m.user_id = ?1 OR ${NOT_BLOCKED("m.user_id")})
      ORDER BY score IS NULL, score DESC, u.handle LIMIT 100`).bind(v.id, crewId, c.visibility).all<BoardRow>()).results;
  // the next drive holds the page through the drive itself (its morning and its convoy, P-03); after that it is the last one
  const now = Date.now(), next = (await eventsList(env, v, crewId)).find((e) => Date.parse(e.starts_at) > now - RECORD_AFTER_H * 3600_000) ?? null;
  const last = await lastEvent(env, crewId);
  const livery = await liveryOf(env, crewId), mine = await myDecals(env, v.id, crewId);
  // what's unlocked shows only what the tier allows, so a crew that drops a tier falls back to the Plain look
  const club = atLeast(livery.tier, "club"), works = atLeast(livery.tier, "works");
  // the owner's choice for the pinned route: routes shared with this crew, newest first
  const routes = c.owner === v.id ? (await env.DB.prepare(`SELECT r.id, r.name FROM shared_routes r JOIN shared_route_audience a ON a.route_id = r.id
      WHERE a.audience_type = 'crew' AND a.audience_id = ? ORDER BY r.created_at DESC LIMIT 20`).bind(crewId).all<{ id: string; name: string }>()).results : undefined;
  // Club: a pinned chat message. Works: badges on the board, the house stage's board, the convoy call sign.
  const pinnedChat = club && c.pinned_chat_id ? await env.DB.prepare(`SELECT m.id, m.body, m.created_at, u.handle FROM crew_chat m JOIN users u ON u.id = m.author
      WHERE m.id = ? AND m.crew_id = ? AND NOT ${reportedSql("chat", "m.id")}`).bind(c.pinned_chat_id, crewId).first() : null;
  const house = works && c.house_canon_id ? await houseStage(env, v, crewId, c.house_canon_id) : null;
  const stages = c.owner === v.id ? (await env.DB.prepare(`SELECT DISTINCT COALESCE(s.origin_id, s.id) AS id, s.name FROM segment_shares sh JOIN segments s ON s.id = sh.segment_id
      WHERE sh.audience_type = 'crew' AND sh.audience_id = ? LIMIT 30`).bind(crewId).all<{ id: string; name: string }>()).results : undefined;
  const grant = await env.DB.prepare("SELECT share_scores FROM grants WHERE user_id = ? AND audience_type = 'crew' AND audience_id = ?").bind(v.id, crewId).first<{ share_scores: number }>();
  return {
    id: c.id, name: c.name, motto: c.motto, about: c.about, visibility: c.visibility, area_name: c.area_name, members: c.members,
    is_owner: c.owner === v.id, crest: c.crest, stripe: c.stripe, cover_photo_id: c.cover_photo_id,
    invites: c.invites, can_invite: c.owner === v.id || c.invites === "anyone",          // P-07: who can invite, and whether you can
    livery: { ...livery, mine }, stripe2: club ? c.stripe2 : null, stripe3: works ? c.stripe3 : null, pattern: works ? c.pattern : null,
    crest_photo_id: club ? c.crest_photo_id : null, pinned: club && c.pinned_route_id && c.pinned_name ? { id: c.pinned_route_id, name: c.pinned_name } : null, routes,
    pinned_chat: pinnedChat, house, stages, call_sign: works ? c.call_sign : null,
    hazard_kinds: atLeast(livery.tier, "factory") ? (JSON.parse(c.hazard_kinds) as string[]) : [],
    regroup_line: atLeast(livery.tier, "factory") ? c.regroup_line : null,
    voice_packs: atLeast(livery.tier, "factory") ? (await env.DB.prepare("SELECT pack FROM crew_voice WHERE crew_id = ?").bind(crewId).all<{ pack: string }>()).results.map((r) => r.pack) : [], templates_cap: templateCap(livery.tier), board: board.map((r) => ({ ...r, mine: !!r.mine, badge: works ? r.badge : null })), next, last, sharing_scores: !!grant?.share_scores,
  };
}

/** PUT /api/crews/:id/page (owner): { motto?, crest?, stripe? }; null clears one. */
export async function crewPageUpdate(env: Env, v: Viewer, crewId: string, req: Request): Promise<void> {
  const own = await env.DB.prepare("SELECT 1 FROM crews WHERE id = ? AND owner = ?").bind(crewId, v.id).first();
  if (!own) throw new HttpError(404, "no_crew");
  const b = await body<{ motto?: unknown; crest?: unknown; stripe?: unknown; stripe2?: unknown; stripe3?: unknown; pattern?: unknown; pinned_route_id?: unknown;
    pinned_chat_id?: unknown; house_canon_id?: unknown; call_sign?: unknown; hazard_kinds?: unknown; regroup_line?: unknown }>(req);
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
  if (b.pinned_chat_id !== undefined) {
    if (b.pinned_chat_id !== null) {
      await need("club");
      const ok = typeof b.pinned_chat_id === "string" && await env.DB.prepare("SELECT 1 FROM crew_chat WHERE id = ? AND crew_id = ?").bind(b.pinned_chat_id, crewId).first();
      if (!ok) throw new HttpError(400, "bad_chat");
    }
    sets.push("pinned_chat_id = ?"); args.push(b.pinned_chat_id);
  }
  if (b.house_canon_id !== undefined) {
    if (b.house_canon_id !== null) {
      await need("works");
      const ok = typeof b.house_canon_id === "string" && await env.DB.prepare(`SELECT 1 FROM segment_shares sh JOIN segments s ON s.id = sh.segment_id
          WHERE sh.audience_type = 'crew' AND sh.audience_id = ? AND COALESCE(s.origin_id, s.id) = ?`).bind(crewId, b.house_canon_id).first();
      if (!ok) throw new HttpError(400, "bad_stage");
    }
    sets.push("house_canon_id = ?"); args.push(b.house_canon_id);
  }
  if (b.call_sign !== undefined) {
    const cs = b.call_sign === null || b.call_sign === "" ? null : cleanText(b.call_sign, 12)?.trim().toUpperCase() || null;
    if (b.call_sign && !cs) throw new HttpError(400, "bad_call_sign");
    if (cs) await need("works");
    sets.push("call_sign = ?"); args.push(cs);
  }
  if (b.hazard_kinds !== undefined) {   // Factory: up to four of the crew's own hazard categories ("Cattle grid")
    if (!Array.isArray(b.hazard_kinds) || b.hazard_kinds.length > 4) throw new HttpError(400, "bad_hazard_kinds");
    const kinds = [...new Set(b.hazard_kinds.map((k) => cleanText(k, 20)?.replace(/\s+/g, " ").trim()))];
    if (kinds.some((k) => !k)) throw new HttpError(400, "bad_hazard_kinds");
    if (kinds.length) await need("factory");
    sets.push("hazard_kinds = ?"); args.push(JSON.stringify(kinds));
  }
  let lineChanged = false;
  if (b.regroup_line !== undefined) {   // Factory: the crew's regroup line; a new line drops the clips of the old one
    const l = b.regroup_line === null || b.regroup_line === "" ? null : cleanText(b.regroup_line, 60)?.replace(/\s+/g, " ").trim() || null;
    if (b.regroup_line && !l) throw new HttpError(400, "bad_regroup_line");
    if (l) await need("factory");
    const now = await env.DB.prepare("SELECT regroup_line FROM crews WHERE id = ?").bind(crewId).first<{ regroup_line: string | null }>();
    lineChanged = (now?.regroup_line ?? null) !== l;
    sets.push("regroup_line = ?"); args.push(l);
  }
  if (lineChanged) await crewVoiceClear(env, crewId);
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

/** The house stage (Works): its name and each member's best Score on it as published to this crew (grant on). */
async function houseStage(env: Env, v: Viewer, crewId: string, canon: string) {
  const name = await env.DB.prepare("SELECT name FROM segments WHERE COALESCE(origin_id, id) = ? ORDER BY created_at LIMIT 1").bind(canon).first<{ name: string }>();
  if (!name) return null;
  const rows = (await env.DB.prepare(`SELECT u.handle, MAX(be.driver_score) AS score FROM board_entries be JOIN users u ON u.id = be.user_id
      JOIN crew_members m ON m.crew_id = ?2 AND m.user_id = be.user_id
      WHERE be.canon_id = ?3 AND be.audience_type = 'crew' AND be.audience_id = ?2
        AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = be.user_id AND g.audience_type = 'crew' AND g.audience_id = ?2 AND g.share_scores = 1)
        AND (be.user_id = ?1 OR ${NOT_BLOCKED("be.user_id")})
      GROUP BY be.user_id ORDER BY score DESC LIMIT 10`).bind(v.id, crewId, canon).all<{ handle: string; score: number }>()).results;
  return { id: canon, name: name.name, board: rows };
}

/** PUT /api/crews/:id/badges { handle, badge }: the owner gives a member a short badge (Works); null takes it off. */
export async function crewBadge(env: Env, v: Viewer, crewId: string, req: Request): Promise<void> {
  if (!(await env.DB.prepare("SELECT 1 FROM crews WHERE id = ? AND owner = ?").bind(crewId, v.id).first())) throw new HttpError(404, "no_crew");
  const b = await body<{ handle?: unknown; badge?: unknown }>(req);
  const badge = b.badge === null || b.badge === "" ? null : cleanText(b.badge, 16)?.trim() || null;
  if (b.badge && !badge) throw new HttpError(400, "bad_badge");
  if (badge && !atLeast((await liveryOf(env, crewId)).tier, "works")) throw new HttpError(403, "needs_works");
  if (typeof b.handle !== "string") throw new HttpError(400, "bad_handle");
  const r = await env.DB.prepare(`UPDATE crew_members SET badge = ?1 WHERE crew_id = ?2 AND user_id = (SELECT id FROM users WHERE handle = ?3)`)
    .bind(badge, crewId, b.handle.toLowerCase()).run();
  if (!r.meta.changes) throw new HttpError(404, "no_member");
}

/** GET /api/crews/:id/templates: the crew's event templates (members; only as many as the tier keeps). */
export async function templatesList(env: Env, v: Viewer, crewId: string) {
  if (!(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const cap = templateCap((await liveryOf(env, crewId)).tier);
  if (!cap) return [];
  return (await env.DB.prepare(`SELECT id, name, title, meet_name, meet_lat, meet_lon, notes FROM crew_event_templates WHERE crew_id = ?
      ORDER BY created_at, rowid LIMIT ${cap}`).bind(crewId).all()).results;
}

/** POST /api/crews/:id/templates { name, title, meet: { name, lat, lon }, notes }: the owner saves one, up to the tier's cap. */
export async function templateCreate(env: Env, v: Viewer, crewId: string, req: Request): Promise<{ id: string }> {
  if (!(await env.DB.prepare("SELECT 1 FROM crews WHERE id = ? AND owner = ?").bind(crewId, v.id).first())) throw new HttpError(404, "no_crew");
  const cap = templateCap((await liveryOf(env, crewId)).tier);
  if (!cap) throw new HttpError(403, "needs_club");
  const b = await body<{ name?: unknown; title?: unknown; meet?: { name?: unknown; lat?: unknown; lon?: unknown }; notes?: unknown }>(req);
  const name = cleanText(b.name, 24)?.trim(), title = cleanText(b.title, 60)?.trim();
  if (!name || !title) throw new HttpError(400, "bad_template");
  const meet = b.meet && typeof b.meet === "object" ? b.meet : {};
  const lat = num(meet.lat, "meet", -85, 85), lon = num(meet.lon, "meet", -180, 180);
  const meetName = meet.name ? cleanText(meet.name, 60)?.trim() || null : null, notes = b.notes ? cleanText(b.notes, 280)?.trim() || null : null;
  const id = crypto.randomUUID();
  const r = await env.DB.prepare(`INSERT INTO crew_event_templates (id, crew_id, name, title, meet_name, meet_lat, meet_lon, notes)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE (SELECT COUNT(*) FROM crew_event_templates WHERE crew_id = ?2) < ${cap}`)
    .bind(id, crewId, name, title, meetName, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, notes).run();
  if (!r.meta.changes) throw new HttpError(429, "too_many_templates");
  return { id };
}

/** DELETE /api/crews/:id/templates/:tid: the owner. */
export async function templateDelete(env: Env, v: Viewer, crewId: string, tid: string): Promise<void> {
  const r = await env.DB.prepare(`DELETE FROM crew_event_templates WHERE id = ? AND crew_id = ? AND EXISTS (SELECT 1 FROM crews WHERE id = ? AND owner = ?)`)
    .bind(tid, crewId, crewId, v.id).run();
  if (!r.meta.changes) throw new HttpError(404, "no_template");
}

// ---- the crew's regroup line in each pack's voice (Factory) --------------------------------------------------------
export const VOICE_PACKS = ["marguerite", "kit", "hale"] as const;
export const VOICE_MAX_BYTES = 400_000;
async function crewVoiceClear(env: Env, crewId: string) {
  if (env.PHOTOS) for (const p of VOICE_PACKS) await env.PHOTOS.delete(`cv/${crewId}/${p}`);
  await env.DB.prepare("DELETE FROM crew_voice WHERE crew_id = ?").bind(crewId).run();
}

/** PUT /api/crews/:id/voice/:pack (owner, Factory, a line set): the line rendered in that pack's voice, as WAV. */
export async function crewVoicePut(env: Env, v: Viewer, crewId: string, pack: string, req: Request): Promise<void> {
  if (!env.PHOTOS) throw new HttpError(503, "voice_off");
  if (!VOICE_PACKS.includes(pack as typeof VOICE_PACKS[number])) throw new HttpError(400, "bad_pack");
  const c = await env.DB.prepare("SELECT regroup_line FROM crews WHERE id = ? AND owner = ?").bind(crewId, v.id).first<{ regroup_line: string | null }>();
  if (!c) throw new HttpError(404, "no_crew");
  if (!c.regroup_line) throw new HttpError(400, "no_line");
  if (!atLeast((await liveryOf(env, crewId)).tier, "factory")) throw new HttpError(403, "needs_factory");
  if (!(req.headers.get("content-type") || "").startsWith("audio/wav")) throw new HttpError(415, "wav_only");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length || bytes.length > VOICE_MAX_BYTES) throw new HttpError(413, "too_big");
  const tag = String.fromCharCode(...bytes.subarray(0, 4)) + String.fromCharCode(...bytes.subarray(8, 12));
  if (tag !== "RIFFWAVE") throw new HttpError(400, "not_wav");
  await env.PHOTOS.put(`cv/${crewId}/${pack}`, bytes);
  await env.DB.prepare(`INSERT INTO crew_voice (crew_id, pack, bytes) VALUES (?, ?, ?) ON CONFLICT (crew_id, pack) DO UPDATE SET bytes = excluded.bytes, created_at = datetime('now')`)
    .bind(crewId, pack, bytes.length).run();
}

/** GET /api/crews/:id/voice/:pack: the clip, to the crew's members, while the crew is Factory. */
export async function crewVoiceGet(env: Env, v: Viewer, crewId: string, pack: string): Promise<Response> {
  if (!env.PHOTOS || !(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_voice");
  if (!atLeast((await liveryOf(env, crewId)).tier, "factory")) throw new HttpError(404, "no_voice");
  const bytes = await env.PHOTOS.get(`cv/${crewId}/${pack}`, "arrayBuffer");
  if (!bytes) throw new HttpError(404, "no_voice");
  return new Response(bytes, { headers: { "content-type": "audio/wav", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
}

/** GET /api/crews/voices: your Factory crews with a regroup line, the packs it's rendered in, and how a convoy names them. */
export async function crewVoices(env: Env, v: Viewer) {
  const rows = (await env.DB.prepare(`SELECT c.id, c.name, c.call_sign, c.regroup_line, (SELECT json_group_array(pack) FROM crew_voice cv WHERE cv.crew_id = c.id) AS packs
      FROM crews c JOIN crew_members m ON m.crew_id = c.id AND m.user_id = ? WHERE c.regroup_line IS NOT NULL`).bind(v.id).all<{ id: string; name: string; call_sign: string | null; regroup_line: string; packs: string }>()).results;
  const out = [];
  for (const r of rows) if (atLeast((await liveryOf(env, r.id)).tier, "factory")) out.push({ ...r, packs: JSON.parse(r.packs) as string[] });
  return out;
}
