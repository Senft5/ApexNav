// Kudos (IDEAS S-07): a tap of thanks on a run you can see in friends' activity (their best on a stage that day, published
// to you). No comments on purpose: nothing to moderate, nothing to harass with. Given and received only between people who
// still see each other's runs; blocks hide everything. Received: GET /api/kudos.
import { Env, HttpError, body, str } from "./util";
import type { Viewer } from "./auth";
import { VISIBLE_FROM_OTHERS } from "./social";

export const KEEP_DAYS = 90, MAX_RECEIVED = 30;

async function target(env: Env, v: Viewer, req: Request) {
  const b = await body<{ handle?: unknown; canon_id?: unknown; driven_on?: unknown }>(req);
  const handle = str(b.handle, "handle", 3, 20).replace(/^@/, "").toLowerCase(), canon = str(b.canon_id, "canon_id", 1, 64);
  if (typeof b.driven_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.driven_on)) throw new HttpError(400, "bad_driven_on");
  const owner = await env.DB.prepare("SELECT id FROM users WHERE handle = ?").bind(handle).first<{ id: string }>();
  // the run must be one the giver can see: published to them, grant on, still friends or crew-mates, no block
  const seen = owner && owner.id !== v.id && await env.DB.prepare(
    `SELECT 1 FROM board_entries be WHERE be.user_id = ?2 AND be.canon_id = ?3 AND be.driven_on = ?4 AND (${VISIBLE_FROM_OTHERS}) LIMIT 1`)
    .bind(v.id, owner.id, canon, b.driven_on).first();
  if (!owner || !seen) throw new HttpError(404, "not_found");
  return { owner: owner.id, canon, day: b.driven_on };
}

export async function kudosGive(env: Env, v: Viewer, req: Request): Promise<void> {
  const t = await target(env, v, req);
  await env.DB.prepare("INSERT OR IGNORE INTO kudos (giver_id, owner_id, canon_id, driven_on) VALUES (?, ?, ?, ?)").bind(v.id, t.owner, t.canon, t.day).run();
}

export async function kudosTake(env: Env, v: Viewer, req: Request): Promise<void> {
  const t = await target(env, v, req);
  await env.DB.prepare("DELETE FROM kudos WHERE giver_id = ? AND owner_id = ? AND canon_id = ? AND driven_on = ?").bind(v.id, t.owner, t.canon, t.day).run();
}

/** Kudos on your runs, newest first: who (handle), which of your stages, which day. Not from anyone you've blocked or who blocked you. */
export async function kudosReceived(env: Env, v: Viewer) {
  return (await env.DB.prepare(
    `SELECT u.handle AS from_handle, MIN(s.name) AS stage, k.canon_id, k.driven_on, k.created_at
       FROM kudos k JOIN users u ON u.id = k.giver_id
       LEFT JOIN segments s ON s.owner = ?1 AND COALESCE(s.origin_id, s.id) = k.canon_id
      WHERE k.owner_id = ?1 AND u.handle IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = k.giver_id) OR (b.blocker = k.giver_id AND b.blocked = ?1))
      GROUP BY k.giver_id, k.canon_id, k.driven_on ORDER BY k.created_at DESC LIMIT ${MAX_RECEIVED}`).bind(v.id).all()).results;
}

/** For activity rows: how many kudos a run has and whether the viewer gave one. */
export async function kudosFor(env: Env, v: Viewer, runs: { owner: string; canon: string; day: string }[]) {
  const out = new Map<string, { n: number; mine: boolean }>();
  for (const r of runs) {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n, MAX(giver_id = ?4) AS mine FROM kudos WHERE owner_id = ?1 AND canon_id = ?2 AND driven_on = ?3")
      .bind(r.owner, r.canon, r.day, v.id).first<{ n: number; mine: number | null }>();
    out.set(`${r.owner}|${r.canon}|${r.day}`, { n: row?.n ?? 0, mine: !!row?.mine });
  }
  return out;
}

export const KUDOS_SWEEP = `DELETE FROM kudos WHERE created_at < datetime('now', '-${KEEP_DAYS} days')`;
