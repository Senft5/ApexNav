// Push notifications (APNs): what For you says (src/inbox.ts), told to your phone the moment it happens, so a friend
// request, a kudos or a duel reaches you without opening the app (docs/SOCIAL.md 2.12).
// The phone sends its APNs device token (POST /api/push/token) once the driver allows notifications; it is kept under
// `push/<user id>` in the PHOTOS KV namespace (not D1, so it never rides in a backup; at most three phones each), and
// dropped at sign-out, on Delete account, and when Apple says the token is gone.
// Sending is src/apns.ts (the provider token, one alert to one device, which answers drop a token). Without the owner's
// key (docs/OWNER_TODO.md) nothing is sent and every endpoint answers as usual: the feature waits, nothing breaks.
// Every push goes through the same rules as the screens it points at: nothing to or from someone blocked, words
// are the server's own (a handle, a stage or crew name, a title), never a message body, a place or a time on the road.
import { Env, HttpError } from "./util";
import { serverError } from "./errors";
import { Viewer } from "./auth";
import { POST_SEEN } from "./drive_posts";
import { apnsConfigured, sendAlert, TOKEN, type ApnsEnv } from "./apns";

const MAX_TOKENS = 3;
const kvKey = (userId: string) => `push/${userId}`;
const LINK = "apexnav://open";

export const pushConfigured = (env: Env): boolean => apnsConfigured(env) && !!env.PHOTOS;

/** A phone's token; `e` is "sandbox" for a build run from Xcode (TestFlight and the App Store are production). */
type Kept = { t: string; at: number; e?: "sandbox" };
const readTokens = async (env: Env, userId: string): Promise<Kept[]> => {
  if (!env.PHOTOS) return [];
  try { const v = JSON.parse((await env.PHOTOS.get(kvKey(userId))) || "[]"); return Array.isArray(v) ? v.filter((x) => x && typeof x.t === "string") : []; } catch (_) { return []; }
};
const writeTokens = async (env: Env, userId: string, list: Kept[]) => {
  if (!env.PHOTOS) return;
  if (list.length) await env.PHOTOS.put(kvKey(userId), JSON.stringify(list.slice(-MAX_TOKENS)));
  else await env.PHOTOS.delete(kvKey(userId));
};

const tokenOf = (x: unknown): string => {
  const t = typeof x === "string" ? x.trim().toLowerCase() : "";
  if (!TOKEN.test(t)) throw new HttpError(400, "bad_token");
  return t;
};

/** POST /api/push/token {token}: this phone wants pushes. Written only when it is new (KV writes are few on Workers Free). */
export async function pushRegister(env: Env, v: Viewer, req: Request): Promise<{ ok: true; sending: boolean }> {
  const b = (await req.json().catch(() => ({}))) as { token?: unknown; sandbox?: unknown };
  const t = tokenOf(b.token), e = b.sandbox === true ? "sandbox" as const : undefined;
  const list = await readTokens(env, v.id);
  if (!list.some((x) => x.t === t && x.e === e)) await writeTokens(env, v.id, [...list.filter((x) => x.t !== t), { t, at: Date.now(), ...(e ? { e } : {}) }]);
  return { ok: true, sending: pushConfigured(env) };
}

/** DELETE /api/push/token {token}: this phone signs out or turns pushes off. No token: every phone of this person. */
export async function pushForget(env: Env, userId: string, token?: unknown): Promise<void> {
  if (token === undefined || token === null || token === "") { await writeTokens(env, userId, []); return; }
  const t = tokenOf(token);
  const list = await readTokens(env, userId);
  if (list.some((x) => x.t === t)) await writeTokens(env, userId, list.filter((x) => x.t !== t));
}

/** PUT /api/push/quiet {on}: a drive started (on) or ended. While on, and for three hours at most, nothing is pushed to this
 *  person: the road comes first, and For you still holds all of it afterwards. */
export async function pushQuiet(env: Env, v: Viewer, req: Request): Promise<void> {
  const b = (await req.json().catch(() => ({}))) as { on?: unknown };
  if (!env.PHOTOS) return;
  if (b.on === true) await env.PHOTOS.put(`pushquiet/${v.id}`, "1", { expirationTtl: 3 * 3600 });
  else await env.PHOTOS.delete(`pushquiet/${v.id}`);
}

/** What a push says and where its tap goes: `link` is an app link the shell opens as any other (apexnav://open?view=friends). */
export interface Push { kind: string; title: string; body: string; link: string }

/** Send one push to each phone of each person. Never throws: a push is a courtesy, never the reason a request fails. */
export async function notify(env: Env, userIds: string[], p: Push): Promise<number> {
  if (!pushConfigured(env) || !userIds.length) return 0;
  let sent = 0;
  try {
    const alert = { title: p.title.slice(0, 80), body: p.body.slice(0, 180), thread: p.kind, url: p.link };
    for (const id of [...new Set(userIds)].slice(0, 60)) {
      const list = await readTokens(env, id);
      if (!list.length || (await env.PHOTOS!.get(`pushquiet/${id}`))) continue;   // no phone, or driving now
      const gone: string[] = [];
      for (const k of list) {
        const r = await sendAlert(env, k.t, alert, (k.e ?? "production") as ApnsEnv);
        if (r.ok) sent++;
        else if (r.drop) gone.push(k.t);
        else if (r.status === 403 && r.reason !== "ExpiredProviderToken") throw new Error(`apns 403 ${r.reason}`);   // the key is wrong
      }
      if (gone.length) await writeTokens(env, id, list.filter((k) => !gone.includes(k.t)));
    }
  } catch (e) { await serverError(env, "push", e); }
  return sent;
}

const at = (h: string | null) => (h ? `@${h}` : "Someone");

/** The words of each push, in one place (the same sentences as For you, web/inbox.js line()). */
export const PUSH = {
  request: (from: string | null): Push => ({ kind: "request", title: "Friend request", body: `${at(from)} wants to be your friend.`, link: `${LINK}?view=friends` }),
  accepted: (from: string | null): Push => ({ kind: "friend", title: "New friend", body: `You and ${at(from)} are friends now.`, link: `${LINK}?view=friends${from ? `&friend=${encodeURIComponent(from)}` : ""}` }),
  kudos: (from: string | null, stage: string | null): Push => ({ kind: "kudos", title: "Kudos", body: `${at(from)} gave you kudos for ${stage || "a run"}.`, link: `${LINK}?view=friends` }),
  duelAsk: (from: string | null, stage: string): Push => ({ kind: "duel", title: "Duel", body: `${at(from)} challenged you on ${stage}.`, link: `${LINK}?view=friends` }),
  duelOn: (from: string | null, stage: string): Push => ({ kind: "duel", title: "Duel on", body: `${at(from)} took your duel on ${stage}.`, link: `${LINK}?view=friends` }),
  postKudos: (from: string | null, title: string, post: string): Push => ({ kind: "post_kudos", title: "Kudos", body: `${at(from)} gave kudos to ${title}.`, link: `${LINK}?view=friends&post=${post}` }),
  postComment: (from: string | null, title: string, post: string): Push => ({ kind: "post_comment", title, body: `${at(from)} commented on your drive.`, link: `${LINK}?view=friends&post=${post}` }),
  postAlso: (from: string | null, owner: string | null, title: string, post: string): Push => ({ kind: "post_comment", title, body: `${at(from)} also commented on ${owner ? `@${owner}'s` : "a"} drive.`, link: `${LINK}?view=friends&post=${post}` }),
  crewDrive: (crew: string, title: string, by: string | null): Push => ({ kind: "crew_drive", title: crew, body: `${at(by)} planned ${title}. Are you going?`, link: `${LINK}?view=crews` }),
};

// ---- what sends them: each called after the write it tells of (index.ts, in waitUntil) --------------------------------

/** A friend request (to them), or a request that made you friends (to the one who asked first). */
export async function afterFriend(env: Env, v: Viewer, to: string, mutual: boolean): Promise<void> {
  await notify(env, [to], mutual ? PUSH.accepted(v.handle) : PUSH.request(v.handle));
}

/** Kudos, the first time this giver gives it for this run (a take and give again tells no one twice). */
export async function afterKudos(env: Env, v: Viewer, owner: string, canon: string): Promise<void> {
  if (!pushConfigured(env)) return;
  const s = await env.DB.prepare("SELECT MIN(name) AS name FROM segments WHERE owner = ? AND COALESCE(origin_id, id) = ?").bind(owner, canon).first<{ name: string | null }>();
  await notify(env, [owner], PUSH.kudos(v.handle, s ? s.name : null));
}

/** A duel asked of a friend (to them), or taken (to the one who asked). */
export async function afterDuel(env: Env, v: Viewer, duelId: string, taken: boolean): Promise<void> {
  if (!pushConfigured(env)) return;
  const d = await env.DB.prepare("SELECT challenger, opponent, stage FROM duels WHERE id = ?").bind(duelId).first<{ challenger: string; opponent: string; stage: string }>();
  if (!d) return;
  await notify(env, [taken ? d.challenger : d.opponent], taken ? PUSH.duelOn(v.handle, d.stage) : PUSH.duelAsk(v.handle, d.stage));
}

/** A crew drive planned: every other member, but no one who blocked the planner or whom the planner blocked. */
export async function afterCrewDrive(env: Env, v: Viewer, crewId: string, eventId: string): Promise<void> {
  if (!pushConfigured(env)) return;
  const [crew, ev, mem] = await env.DB.batch([
    env.DB.prepare("SELECT name FROM crews WHERE id = ?").bind(crewId),
    env.DB.prepare("SELECT title FROM crew_events WHERE id = ?").bind(eventId),
    env.DB.prepare(`SELECT m.user_id AS id FROM crew_members m WHERE m.crew_id = ?1 AND m.user_id != ?2
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = m.user_id AND b.blocked = ?2) OR (b.blocker = ?2 AND b.blocked = m.user_id))`).bind(crewId, v.id),
  ]);
  const name = (crew.results[0] as { name?: string } | undefined)?.name, title = (ev.results[0] as { title?: string } | undefined)?.title;
  if (!name || !title) return;
  await notify(env, (mem.results as { id: string }[]).map((r) => r.id), PUSH.crewDrive(name, title, v.handle));
}

/** Kudos on a drive post, the first time this person gives it (src/drive_posts.ts postKudos says when). */
export async function afterPostKudos(env: Env, v: Viewer, post: string, author: string, title: string): Promise<void> {
  await notify(env, [author], PUSH.postKudos(v.handle, title, post));
}

/** A comment on your drive post, from someone else; and to the others who commented on it before (who can still see it,
 *  and neither blocked nor blocked by this commenter), as any social app does. Never the comment's words: a push is seen
 *  on a lock screen. */
export async function afterPostComment(env: Env, v: Viewer, post: string, author: string, title: string): Promise<void> {
  if (author !== v.id) await notify(env, [author], PUSH.postComment(v.handle, title, post));
  if (!pushConfigured(env)) return;
  const seen = POST_SEEN("p").replaceAll("?1", "c.author");   // the post as each earlier commenter sees it
  const r = await env.DB.prepare(`SELECT DISTINCT c.author AS id, ou.handle AS owner FROM drive_comments c JOIN drive_posts p ON p.id = c.post_id JOIN users ou ON ou.id = p.author
     WHERE c.post_id = ?2 AND c.author != ?3 AND c.author != p.author
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = c.author AND b.blocked = ?3) OR (b.blocker = ?3 AND b.blocked = c.author)) AND ${seen}
     LIMIT 20`).bind(null, post, v.id).all<{ id: string; owner: string | null }>();
  const rows = r.results;
  if (rows.length) await notify(env, rows.map((x) => x.id), PUSH.postAlso(v.handle, rows[0].owner, title, post));
}
