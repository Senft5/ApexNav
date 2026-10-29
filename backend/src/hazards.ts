// Hazards reported by hand (IDEAS Q-15) and "still there?" votes (Q-16). Waze-style, without the identity: members see a
// report's kind, place, heading and how many people confirmed it, never who reported it. A report of the same kind within
// SAME_M of a live one confirms that one instead of adding another. Each kind lives for its own time from the last
// confirmation; enough "gone" votes end it early. The daily sweep (sweep.ts) deletes reports a day after they expire.
import type { Viewer } from "./auth";
import { Env, HttpError, body, num, randomToken } from "./util";
import { atLeast, tierOf } from "./livery";

export const KINDS = ["pothole", "gravel", "debris", "animal", "police", "closure"] as const;
type Kind = (typeof KINDS)[number];
/** How long a report lives after it was made or last confirmed, in minutes. */
export const LIFE_MIN: Record<Kind, number> = { pothole: 7 * 1440, gravel: 1440, debris: 180, animal: 30, police: 60, closure: 720 };
export const SAME_M = 50, MAX_PER_DAY = 30, NEAR_MAX_KM = 50, MAX_LISTED = 200;

const M_LAT = 110540;
const cosLat = (lat: number) => Math.cos(lat * Math.PI / 180);
const until = (kind: Kind, ageS = 0) => `datetime('now', '+${LIFE_MIN[kind] * 60 - ageS} seconds')`;

export async function reportHazard(env: Env, v: Viewer, req: Request) {
  const b = await body<{ kind?: unknown; lat?: unknown; lon?: unknown; heading?: unknown; age_s?: unknown; label?: unknown }>(req);
  if (typeof b.kind !== "string" || !(KINDS as readonly string[]).includes(b.kind)) throw new HttpError(400, "bad_kind");
  // a Factory crew's own category: a labelled debris report, only for a member of a crew that has it
  let label: string | null = null;
  if (b.label !== undefined && b.label !== null) {
    if (typeof b.label !== "string" || !(await crewHazardKinds(env, v)).includes(b.label)) throw new HttpError(400, "bad_label");
    label = b.label;
  }
  const kind = (label ? "debris" : b.kind) as Kind;
  const lat = num(b.lat, "lat", -85, 85), lon = num(b.lon, "lon", -180, 180);
  const heading = b.heading === undefined || b.heading === null ? null : Math.round(num(b.heading, "heading", 0, 360)) % 360;
  // Made with no signal and sent later (IDEAS F-05): it lives from when it was seen, and one already past its life is refused.
  const ageS = b.age_s === undefined || b.age_s === null ? 0 : Math.round(num(b.age_s, "age_s", 0, 86400));
  if (ageS >= LIFE_MIN[kind] * 60) throw new HttpError(410, "stale_report");
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM hazard_reports WHERE reported_by = ? AND created_at > datetime('now', '-1 day')")
    .bind(v.id).first<{ n: number }>();
  if ((today?.n ?? 0) >= MAX_PER_DAY) throw new HttpError(429, "too_many_reports");
  // The same thing seen again nearby: a confirmation, and one person's own repeat counts once.
  const dLat = SAME_M / M_LAT, dLon = SAME_M / (111320 * cosLat(lat));
  const near = await env.DB.prepare(
    `SELECT id FROM hazard_reports WHERE kind = ? AND COALESCE(label, '') = ? AND expires_at > datetime('now')
       AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? LIMIT 1`).bind(kind, label ?? "", lat - dLat, lat + dLat, lon - dLon, lon + dLon).first<{ id: string }>();
  if (near) { await vote(env, v, near.id, true); return { id: near.id, confirmed: true }; }
  const id = randomToken(12);
  await env.DB.prepare(`INSERT INTO hazard_reports (id, kind, lat, lon, heading, reported_by, expires_at, label) VALUES (?, ?, ?, ?, ?, ?, ${until(kind, ageS)}, ?)`)
    .bind(id, kind, lat, lon, heading, v.id, label).run();
  return { id, confirmed: false };
}

/** GET /api/hazards/kinds: the extra categories of the Factory crews you're in (at most 8, each up to 20 characters). */
export async function crewHazardKinds(env: Env, v: Viewer): Promise<string[]> {
  const rows = (await env.DB.prepare(`SELECT c.id, c.hazard_kinds FROM crews c JOIN crew_members m ON m.crew_id = c.id AND m.user_id = ? WHERE c.hazard_kinds != '[]'`)
    .bind(v.id).all<{ id: string; hazard_kinds: string }>()).results;
  const out = new Set<string>();
  for (const r of rows) if (atLeast(await tierOf(env, r.id), "factory")) for (const k of JSON.parse(r.hazard_kinds) as string[]) out.add(k);
  return [...out].slice(0, 8);
}

/** Live reports within `km` of a point, nearest first. Never who reported them. */
export async function hazardsNear(env: Env, url: URL, v?: Viewer) {
  const lat = num(Number(url.searchParams.get("lat")), "lat", -85, 85), lon = num(Number(url.searchParams.get("lon")), "lon", -180, 180);
  const km = num(Number(url.searchParams.get("km") ?? 20), "km", 0.1, NEAR_MAX_KM);
  const dLat = (km * 1000) / M_LAT, dLon = (km * 1000) / (111320 * cosLat(lat));
  const rows = (await env.DB.prepare(
    `SELECT id, kind, label, lat, lon, heading, confirms, clears, created_at, expires_at FROM hazard_reports
      WHERE expires_at > datetime('now') AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`)
    .bind(lat - dLat, lat + dLat, lon - dLon, lon + dLon).all<{ id: string; kind: string; lat: number; lon: number; heading: number | null;
      confirms: number; clears: number; created_at: string; expires_at: string }>()).results;
  const dist = (r: { lat: number; lon: number }) => Math.hypot((r.lat - lat) * M_LAT, (r.lon - lon) * 111320 * cosLat(lat));
  // a crew's own word shows only to that crew's members (it's theirs, typed by their owner); everyone else reads the kind
  const mine = v && rows.some((r) => (r as { label?: string | null }).label) ? new Set(await crewHazardKinds(env, v)) : new Set<string>();
  return rows.map((r) => {
    const label = (r as { label?: string | null }).label;
    return { ...r, label: label && mine.has(label) ? label : null, m: Math.round(dist(r)) };
  }).filter((r) => r.m <= km * 1000).sort((a, b) => a.m - b.m).slice(0, MAX_LISTED);
}

/** Still there (true): pushes the expiry out by the kind's life. Gone (false): two or more "gone" outvoting the confirmations end it. */
export async function vote(env: Env, v: Viewer, id: string, still: boolean) {
  const h = await env.DB.prepare("SELECT kind FROM hazard_reports WHERE id = ? AND expires_at > datetime('now')").bind(id).first<{ kind: Kind }>();
  if (!h) throw new HttpError(404, "no_hazard");
  const prev = await env.DB.prepare("SELECT still FROM hazard_votes WHERE hazard_id = ? AND user_id = ?").bind(id, v.id).first<{ still: number }>();
  if (prev && !!prev.still === still) return { ok: true };   // the same vote twice counts once
  const reporter = await env.DB.prepare("SELECT 1 FROM hazard_reports WHERE id = ? AND reported_by = ?").bind(id, v.id).first();
  const stmts = [env.DB.prepare("INSERT INTO hazard_votes (hazard_id, user_id, still) VALUES (?, ?, ?) ON CONFLICT (hazard_id, user_id) DO UPDATE SET still = excluded.still, at = datetime('now')")
    .bind(id, v.id, still ? 1 : 0)];
  // a changed mind moves one count from one side to the other; the reporter's own report already counts as a confirmation
  if (prev) stmts.push(env.DB.prepare(`UPDATE hazard_reports SET ${prev.still ? "confirms = MAX(0, confirms - 1)" : "clears = MAX(0, clears - 1)"} WHERE id = ?`).bind(id));
  if (still) { if (!reporter) stmts.push(env.DB.prepare(`UPDATE hazard_reports SET confirms = confirms + 1, expires_at = MAX(expires_at, ${until(h.kind)}) WHERE id = ?`).bind(id)); }
  else stmts.push(env.DB.prepare("UPDATE hazard_reports SET clears = clears + 1 WHERE id = ?").bind(id),
    env.DB.prepare("UPDATE hazard_reports SET expires_at = datetime('now') WHERE id = ? AND clears >= 2 AND clears > confirms").bind(id));
  await env.DB.batch(stmts);
  return { ok: true };
}

export async function voteHazard(env: Env, v: Viewer, id: string, req: Request) {
  const { still } = await body<{ still?: unknown }>(req);
  if (typeof still !== "boolean") throw new HttpError(400, "bad_vote");
  return vote(env, v, id, still);
}
