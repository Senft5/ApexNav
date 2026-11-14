// Convoy voice (docs/CONVOY_VOICE.md): an open audio channel for the people in a convoy, carried by Cloudflare Realtime
// (an SFU: each phone sends its microphone once and receives the others). The Worker holds the Realtime app token and
// makes every SFU call; the convoy's Durable Object decides who may (members with the convoy open) and keeps who is on the
// channel in memory. Nothing about the audio is stored or recorded anywhere.
import type { Viewer } from "./auth";
import { convoyRoom, unwrap } from "./convoy_routes";
import { Env, HttpError, body, str } from "./util";

const SFU = "https://rtc.live.cloudflare.com/v1/apps";
export const TRACK = "mic";                 // each member publishes one track, their microphone
const SDP_MAX = 48 * 1024;
const KEY_RE = /^[A-Za-z0-9_-]{4,16}$/;
const MID_RE = /^[A-Za-z0-9_-]{1,8}$/;

type Sdp = { type: "offer" | "answer"; sdp: string };
interface SfuTrack { mid?: string; trackName?: string; sessionId?: string; errorCode?: string }
interface SfuReply { sessionId?: string; sessionDescription?: Sdp; requiresImmediateRenegotiation?: boolean; tracks?: SfuTrack[]; errorCode?: string }

function sdp(v: unknown, type: Sdp["type"]): Sdp {
  const o = v as { type?: unknown; sdp?: unknown } | null;
  if (!o || typeof o !== "object" || o.type !== type) throw new HttpError(400, "bad_sdp");
  return { type, sdp: str(o.sdp, "sdp", 10, SDP_MAX) };
}

/** One call to the SFU's API. Any failure is the SFU's, not the caller's: 502 voice_unavailable. */
async function sfu(env: Env, method: string, path: string, payload?: unknown): Promise<SfuReply> {
  let res: Response;
  try {
    res = await fetch(`${SFU}/${env.REALTIME_APP_ID}/${path}`, {
      method, headers: { authorization: `Bearer ${env.REALTIME_APP_TOKEN}`, "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch { throw new HttpError(502, "voice_unavailable"); }
  const out = (await res.json().catch(() => null)) as SfuReply | null;
  if (!res.ok || !out || out.errorCode) throw new HttpError(502, "voice_unavailable");
  return out;
}

/** On the channel: the phone's offer publishes its microphone; the answer comes back with who else is on to listen to. */
export async function voiceStart(env: Env, v: Viewer, id: string, req: Request) {
  const b = await body<{ sdp?: unknown; mid?: unknown }>(req);
  const offer = sdp(b.sdp, "offer"), mid = str(b.mid, "mid", 1, 8);
  if (!MID_RE.test(mid)) throw new HttpError(400, "bad_mid");
  const room = convoyRoom(env, id);
  unwrap(await room.voiceCheck(v.id));
  const session = await sfu(env, "POST", "sessions/new");
  if (!session.sessionId) throw new HttpError(502, "voice_unavailable");
  const pub = await sfu(env, "POST", `sessions/${session.sessionId}/tracks/new`,
    { sessionDescription: offer, tracks: [{ location: "local", mid, trackName: TRACK }] });
  if (!pub.sessionDescription || pub.tracks?.some((t) => t.errorCode)) throw new HttpError(502, "voice_unavailable");
  const on = unwrap(await room.voiceOn(v.id, session.sessionId));
  return { sdp: pub.sessionDescription, voice: on.voice };
}

/** Listen to these members (those on the channel): the SFU's offer, and which of its media sections is whose. */
export async function voicePull(env: Env, v: Viewer, id: string, req: Request) {
  const b = await body<{ keys?: unknown }>(req);
  if (!Array.isArray(b.keys) || !b.keys.length || b.keys.length > 15 || !b.keys.every((k) => typeof k === "string" && KEY_RE.test(k))) throw new HttpError(400, "bad_keys");
  const look = unwrap(await convoyRoom(env, id).voiceLookup(v.id, b.keys as string[]));
  if (!look.remotes.length) return { sdp: null, tracks: [] };
  const r = await sfu(env, "POST", `sessions/${look.sessionId}/tracks/new`,
    { tracks: look.remotes.map((x) => ({ location: "remote", sessionId: x.sessionId, trackName: TRACK })) });
  const bySession = new Map(look.remotes.map((x) => [x.sessionId, x.key]));
  const tracks = (r.tracks || []).filter((t) => !t.errorCode && t.mid && t.sessionId && bySession.has(t.sessionId))
    .map((t) => ({ key: bySession.get(t.sessionId!)!, mid: t.mid! }));
  return { sdp: r.requiresImmediateRenegotiation ? r.sessionDescription || null : null, tracks };
}

/** The phone's answer to a pull's offer. */
export async function voiceAnswer(env: Env, v: Viewer, id: string, req: Request) {
  const answer = sdp((await body<{ sdp?: unknown }>(req)).sdp, "answer");
  const look = unwrap(await convoyRoom(env, id).voiceLookup(v.id, []));
  await sfu(env, "PUT", `sessions/${look.sessionId}/renegotiate`, { sessionDescription: answer });
  return { ok: true };
}

/** Off the channel (the SFU session is simply dropped: it closes itself once the phone hangs up). */
export async function voiceStop(env: Env, v: Viewer, id: string) {
  return unwrap(await convoyRoom(env, id).voiceOff(v.id));
}
