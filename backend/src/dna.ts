// Your driving DNA beside a friend's (migration 0064, web/dna_card.js): the phone sends Your driving's six skill levels, its
// style words and the kind of corner it is cleanest in; an accepted friend you share scores with sees them on your profile,
// beside their own. Never pace, a speed or a time: the body is checked to hold nothing else.
import type { Viewer } from "./auth";
import { Env, HttpError } from "./util";

export const DNA_SKILLS = ["squeeze", "brake", "arc", "entry", "line", "exit"] as const;
const STYLE_WORDS = new Set(["Trail-braker", "Brakes before turning", "Some trail-braking", "Slowest at the apex", "Late apex", "Early apex",
  "Gentle off the brakes", "Sharp off the brakes", "Even on the brakes"]);
const SIZES = new Set(["tight", "medium", "fast"]);
export interface Dna { skills: Record<string, number>; style: string[]; size: string | null; corners: number | null; drives: number | null }
const count = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 1_000_000 ? x : null);

/** A DNA as the phone sent it, kept to what the card shows, or null when it isn't one (all six levels, 0 to 100). */
export function dnaOf(x: unknown): Dna | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>, sk = o.skills as Record<string, unknown> | undefined;
  if (!sk || typeof sk !== "object") return null;
  const skills: Record<string, number> = {};
  for (const k of DNA_SKILLS) {
    const v = sk[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return null;
    skills[k] = Math.round(v);
  }
  const style = Array.isArray(o.style) ? o.style.filter((w): w is string => typeof w === "string" && STYLE_WORDS.has(w)).slice(0, 3) : [];
  const size = typeof o.size === "string" && SIZES.has(o.size) ? o.size : null;
  return { skills, style, size, corners: count(o.corners), drives: count(o.drives) };
}

/** PUT /api/me/dna: yours, replacing the last. */
export async function dnaPut(env: Env, v: Viewer, req: Request) {
  const raw = await req.text();
  if (raw.length > 4000) throw new HttpError(413, "too_large");
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { throw new HttpError(400, "bad_json"); }
  const d = dnaOf(parsed);
  if (!d) throw new HttpError(400, "bad_dna");
  await env.DB.prepare(`INSERT INTO driver_dna (user_id, body, at) VALUES (?1, ?2, ?3)
     ON CONFLICT (user_id) DO UPDATE SET body = ?2, at = ?3`).bind(v.id, JSON.stringify(d), Date.now()).run();
}

/** Yours and, when they share scores with you, your friend's (the caller has checked the friendship and blocks). */
export async function dnaPair(env: Env, viewerId: string, friendId: string): Promise<{ mine: Dna | null; theirs: Dna | null }> {
  const rows = (await env.DB.prepare(
    `SELECT d.user_id, d.body FROM driver_dna d
      WHERE d.user_id = ?1
         OR (d.user_id = ?2 AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = ?2 AND g.audience_type = 'friend' AND g.audience_id = ?1 AND g.share_scores = 1))`)
    .bind(viewerId, friendId).all<{ user_id: string; body: string }>()).results;
  const of = (id: string) => { const r = rows.find((x) => x.user_id === id); return r ? dnaOf(JSON.parse(r.body)) : null; };
  return { mine: of(viewerId), theirs: of(friendId) };
}
