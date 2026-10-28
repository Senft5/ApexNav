// Share your ETA (IDEAS S-19): a member makes a link while driving a planned route; whoever has it sees the handle, the
// minutes left and the arrival time, refreshed by the phone about once a minute. Never a position, route or destination.
// The link is a random token (only its hash is kept); it ends when the driver arrives or stops it, or after LIFE_H.
import type { Viewer } from "./auth";
import { Env, HttpError, body, num, randomToken, sha256hex } from "./util";

export const LIFE_H = 4, MAX_LEFT_S = 12 * 3600, MAX_LIVE = 3;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const at = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000).toISOString().slice(0, 19).replace("T", " ");

export async function etaStart(env: Env, v: Viewer, req: Request) {
  const { left_s } = await body<{ left_s?: unknown }>(req);
  const left = Math.round(num(left_s, "left_s", 0, MAX_LEFT_S));
  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM eta_shares WHERE owner = ? AND ended IS NULL AND expires_at > datetime('now')")
    .bind(v.id).first<{ n: number }>();
  if ((live?.n ?? 0) >= MAX_LIVE) throw new HttpError(429, "too_many_shares");
  const token = randomToken(24);
  await env.DB.prepare("INSERT INTO eta_shares (token_hash, owner, arrive_at, expires_at) VALUES (?, ?, ?, datetime('now', ?))")
    .bind(await sha256hex(token), v.id, at(left), `+${LIFE_H} hours`).run();
  return { token };
}

async function owned(env: Env, v: Viewer, token: string) {
  if (!TOKEN_RE.test(token)) throw new HttpError(404, "no_share");
  const hash = await sha256hex(token);
  const row = await env.DB.prepare("SELECT token_hash FROM eta_shares WHERE token_hash = ? AND owner = ? AND ended IS NULL AND expires_at > datetime('now')")
    .bind(hash, v.id).first<{ token_hash: string }>();
  if (!row) throw new HttpError(404, "no_share");
  return hash;
}

/** PUT {left_s} refreshes the arrival time; {ended: 'arrived' | 'stopped'} ends it. */
export async function etaUpdate(env: Env, v: Viewer, token: string, req: Request) {
  const hash = await owned(env, v, token);
  const b = await body<{ left_s?: unknown; ended?: unknown }>(req);
  if (b.ended !== undefined) {
    if (b.ended !== "arrived" && b.ended !== "stopped") throw new HttpError(400, "bad_ended");
    await env.DB.prepare("UPDATE eta_shares SET ended = ?, updated_at = datetime('now') WHERE token_hash = ?").bind(b.ended, hash).run();
    return;
  }
  const left = Math.round(num(b.left_s, "left_s", 0, MAX_LEFT_S));
  await env.DB.prepare("UPDATE eta_shares SET arrive_at = ?, updated_at = datetime('now') WHERE token_hash = ?").bind(at(left), hash).run();
}

/** Anyone with the link: who, when they arrive, how fresh that is, and whether it ended. Nothing else exists to give. */
export async function etaView(env: Env, token: string) {
  if (!TOKEN_RE.test(token)) throw new HttpError(404, "no_share");
  const r = await env.DB.prepare(`SELECT u.handle, s.arrive_at, s.updated_at, s.ended, (s.expires_at <= datetime('now')) AS expired
      FROM eta_shares s JOIN users u ON u.id = s.owner WHERE s.token_hash = ?`).bind(await sha256hex(token))
    .first<{ handle: string | null; arrive_at: string; updated_at: string; ended: string | null; expired: number }>();
  if (!r) throw new HttpError(404, "no_share");
  const iso = (s: string) => s.replace(" ", "T") + "Z";
  return { handle: r.handle, arrive_at: iso(r.arrive_at), updated_at: iso(r.updated_at), ended: r.ended ?? (r.expired ? "expired" : null) };
}

export const ETA_SWEEP = "DELETE FROM eta_shares WHERE expires_at <= datetime('now', '-1 day')";
