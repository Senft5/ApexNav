// The Worker side of convoys: checks the account and the request, then hands over to the convoy's Durable Object.
import { APP_ORIGIN, type Viewer } from "./auth";
import { type Result, LIMITS, cleanText, roomStub, userIndex } from "./convoy";
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

const who = (v: Viewer) => ({ id: v.id, handle: v.handle, name: v.displayName });

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
