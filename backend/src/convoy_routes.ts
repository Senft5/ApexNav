// The Worker side of convoys: checks the account and the request, then hands over to the convoy's Durable Object.
import { APP_ORIGIN, type Viewer } from "./auth";
import { type Result, CODE_ALPHABET, LIMITS, cleanText, codeHolder, roomStub, userIndex } from "./convoy";
import { Env, HttpError, body, randomToken, str } from "./util";

const ROOM_RE = /^[A-Za-z0-9_-]{22}$/;

export function convoyRoom(env: Env, id: string) {
  if (!ROOM_RE.test(id)) throw new HttpError(404, "no_convoy");
  return roomStub(env, id);
}

export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new HttpError(r.status, r.error);
  return r.data;
}

const who = (v: Viewer) => ({ id: v.id, handle: v.handle });   // never the Google name (IDEAS Z-13)

/** Joining shares your live position with everyone in the convoy, so both creating and joining ask for it explicitly. */
function consent(b: { consent?: unknown }) {
  if (b.consent !== true) throw new HttpError(400, "consent_required");
}

export async function convoyCreate(env: Env, v: Viewer, req: Request) {
  const b = await body<{ consent?: unknown; name?: unknown }>(req);
  consent(b);
  const name = b.name === undefined || b.name === null || b.name === "" ? "Convoy" : cleanText(b.name, 40);
  if (name === null) throw new HttpError(400, "bad_name");
  const id = randomToken(16);
  // at most two convoys led at once and ten started an hour, per person
  if (!(await userIndex(env, v.id).claim(id, Date.now() + LIMITS.roomMs))) throw new HttpError(429, "too_many_convoys");
  try {
    return unwrap(await convoyRoom(env, id).create(id, who(v), name));
  } catch (e) {
    await userIndex(env, v.id).remove(id).catch(() => {});
    throw e;
  }
}

/** The invite is `<convoy id>.<secret>`, as the leader's link carries it. */
function parseInvite(invite: unknown): [string, string] {
  const [id, secret, extra] = str(invite, "invite", 30, 100).split(".");
  if (!id || !secret || extra !== undefined || !ROOM_RE.test(id)) throw new HttpError(400, "invalid_invite");
  return [id, secret];
}

export async function convoyJoin(env: Env, v: Viewer, req: Request) {
  const b = await body<{ consent?: unknown; invite?: unknown }>(req);
  consent(b);
  const [id, secret] = parseInvite(b.invite);
  return unwrap(await convoyRoom(env, id).join(who(v), secret));
}

/** What a convoy link is for before you say yes: its name, leader and size. Same checks as a join, changes nothing. */
export async function convoyPreview(env: Env, v: Viewer, req: Request) {
  const [id, secret] = parseInvite((await body<{ invite?: unknown }>(req)).invite);
  return unwrap(await convoyRoom(env, id).preview(v.id, secret));
}

/** Only our own pages (the site or the iOS shell) may open a convoy socket; the ticket in the first frame does the rest. */
export function convoyConnect(req: Request, env: Env, id: string): Promise<Response> | Response {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "websocket_required");
  const o = req.headers.get("origin");
  if (o !== APP_ORIGIN && o !== (env.PUBLIC_ORIGIN ?? new URL(req.url).origin)) throw new HttpError(403, "bad_origin");
  return convoyRoom(env, id).fetch(req);
}

// ---- In-app invites (IDEAS S-22): no link to copy, no website ---------------------------------------------------------
const MAX_INVITE = 15;

/** The leader invites friends and private crew-mates by handle. Anyone else (strangers, public-crew acquaintances, either
 *  side of a block) is skipped without saying why. Returns how many were invited. */
export async function convoyInvitePeople(env: Env, v: Viewer, id: string, req: Request) {
  const { handles } = await body<{ handles?: unknown }>(req);
  if (!Array.isArray(handles) || !handles.length || handles.length > MAX_INVITE || !handles.every((h) => typeof h === "string" && h.length <= 30)) {
    throw new HttpError(400, "bad_handles");
  }
  const list = [...new Set((handles as string[]).map((h) => h.replace(/^@/, "").toLowerCase()))];
  const ok = (await env.DB.prepare(
    `SELECT u.id FROM users u
      WHERE u.handle IN (${list.map((_, i) => `?${i + 2}`).join(",")}) AND u.id != ?1
        AND (EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(u.id, ?1) AND f.user_b = MAX(u.id, ?1))
          OR EXISTS (SELECT 1 FROM crew_members a JOIN crew_members b ON b.crew_id = a.crew_id JOIN crews c ON c.id = a.crew_id
                      WHERE a.user_id = ?1 AND b.user_id = u.id AND c.visibility = 'private'))
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = u.id) OR (b.blocker = u.id AND b.blocked = ?1))`)
    .bind(v.id, ...list).all<{ id: string }>()).results.map((r) => r.id);
  if (!ok.length) return { invited: 0 };
  const r = unwrap(await convoyRoom(env, id).inviteUsers(v.id, ok));
  await Promise.all(r.invited.map((uid) => userIndex(env, uid).addInvite(id, { name: r.name, from: r.leader, expiresAtMs: r.expiresAtMs }).catch(() => {})));
  return { invited: r.invited.length };
}

export async function convoyInvites(env: Env, v: Viewer) {
  return userIndex(env, v.id).invites();
}

/** Join from an in-app invite: the same consent and checks as a link. */
export async function convoyAccept(env: Env, v: Viewer, id: string, req: Request) {
  consent(await body<{ consent?: unknown }>(req));
  const ctx = unwrap(await convoyRoom(env, id).join(who(v), null));
  await userIndex(env, v.id).dropInvite(id).catch(() => {});
  return ctx;
}

export async function convoyDismiss(env: Env, v: Viewer, id: string) {
  if (!ROOM_RE.test(id)) throw new HttpError(404, "no_convoy");
  await userIndex(env, v.id).dropInvite(id);
  return { ok: true };
}

// ---- Join codes (IDEAS S-22): six characters to read out in the car park, no link -----------------------------------
/** "k7p 4qx", "K7P-4QX" -> "K7P4QX"; null when it can't be a code. */
export function normCode(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 20) return null;
  const c = v.toUpperCase().replace(/[\s-]/g, "");
  return c.length === 6 && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null;
}
function newCode(): string {
  const r = new Uint8Array(6);
  crypto.getRandomValues(r);
  return [...r].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Leader only: a fresh code for their convoy (the old one stops working). */
export async function convoyCode(env: Env, v: Viewer, id: string) {
  const room = convoyRoom(env, id);
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    // the room first: it checks the leader and sets the expiry the holder keeps
    const r = unwrap(await room.newCode(v.id, code));
    if (await codeHolder(env, code).holdCode(id, r.expiresAtMs)) return { code, expiresAtMs: r.expiresAtMs };
  }
  throw new HttpError(503, "no_code");
}

/** Which convoy a code opens, after the person's try is counted; every miss looks the same (invalid_invite). */
async function codeTarget(env: Env, v: Viewer, raw: unknown): Promise<[string, string]> {
  if (!(await userIndex(env, v.id).codeTry())) throw new HttpError(429, "too_many_tries");
  const code = normCode(raw);
  const id = code ? await codeHolder(env, code).codeRoom() : null;
  if (!code || !id) throw new HttpError(400, "invalid_invite");
  return [id, code];
}

export async function convoyCodeJoin(env: Env, v: Viewer, req: Request) {
  const b = await body<{ consent?: unknown; code?: unknown }>(req);
  consent(b);
  const [id, code] = await codeTarget(env, v, b.code);
  return unwrap(await convoyRoom(env, id).join(who(v), code, true));
}

export async function convoyCodePreview(env: Env, v: Viewer, req: Request) {
  const [id, code] = await codeTarget(env, v, (await body<{ code?: unknown }>(req)).code);
  return unwrap(await convoyRoom(env, id).preview(v.id, code, true));
}
