import { env, exports } from "cloudflare:workers";
import m1 from "../migrations/0001_init.sql?raw";
import m2 from "../migrations/0002_segment_sharing.sql?raw";
import m3 from "../migrations/0003_camber_count.sql?raw";
import m4 from "../migrations/0004_realtime_ingest.sql?raw";
import m5 from "../migrations/0005_app_auth.sql?raw";
import m6 from "../migrations/0006_crest_count.sql?raw";
import m7 from "../migrations/0007_public_crews.sql?raw";
import m8 from "../migrations/0008_garage.sql?raw";
import m9 from "../migrations/0009_moderation.sql?raw";
import m10 from "../migrations/0010_error_counts.sql?raw";
import m11 from "../migrations/0011_hazard_reports.sql?raw";
import m12 from "../migrations/0012_route_sharing.sql?raw";
import m13 from "../migrations/0013_crew_events.sql?raw";
import m14 from "../migrations/0014_health_counts.sql?raw";
import m15 from "../migrations/0015_public_meets.sql?raw";
import m16 from "../migrations/0016_eta_shares.sql?raw";
import m17 from "../migrations/0017_feedback.sql?raw";
import m18 from "../migrations/0018_kudos.sql?raw";
import m19 from "../migrations/0019_pioneer_badges.sql?raw";
import m20 from "../migrations/0020_referral.sql?raw";
import m21 from "../migrations/0021_route_stats.sql?raw";
import m22 from "../migrations/0022_rank_slot_holder.sql?raw";
import m23 from "../migrations/0023_road_ways.sql?raw";
import m24 from "../migrations/0024_car_routing.sql?raw";
import m25 from "../migrations/0025_road_freshness.sql?raw";
import m26 from "../migrations/0026_crew_standings.sql?raw";
import m27 from "../migrations/0027_bin_curvature.sql?raw";
import m28 from "../migrations/0028_redemptions.sql?raw";
import m29 from "../migrations/0029_open_roads.sql?raw";
import m30 from "../migrations/0030_photos_crew_page_builds.sql?raw";
import m31 from "../migrations/0031_crew_crest.sql?raw";
import m32 from "../migrations/0032_event_roles_regroup.sql?raw";
import { sha256hex } from "../src/util";

export const ORIGIN = "https://apexnav.test";

export function splitSql(sql: string): string[] {
  return sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter((s) => s && !/^PRAGMA/i.test(s));
}

/** Fresh schema for each test (D1 in the test pool is a local throw-away database). */
export async function freshDb(): Promise<void> {
  const have = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first();
  if (have) {   // schema exists from an earlier test: empty it (users first, which cascades to most tables)
    await env.DB.prepare("DELETE FROM users").run();
    const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()).results;
    await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t.name}`)));
    return;
  }
  await env.DB.batch([...splitSql(m1), ...splitSql(m2), ...splitSql(m3), ...splitSql(m4), ...splitSql(m5), ...splitSql(m6), ...splitSql(m7), ...splitSql(m8), ...splitSql(m9), ...splitSql(m10), ...splitSql(m11), ...splitSql(m12), ...splitSql(m13), ...splitSql(m14), ...splitSql(m15), ...splitSql(m16), ...splitSql(m17), ...splitSql(m18), ...splitSql(m19), ...splitSql(m20), ...splitSql(m21), ...splitSql(m22), ...splitSql(m23), ...splitSql(m24), ...splitSql(m25), ...splitSql(m26), ...splitSql(m27), ...splitSql(m28), ...splitSql(m29), ...splitSql(m30), ...splitSql(m31), ...splitSql(m32)].map((s) => env.DB.prepare(s)));
}

export interface TestUser { id: string; handle: string; token: string }

export async function makeUser(handle: string, member = true): Promise<TestUser> {
  const id = crypto.randomUUID(), token = `tok-${handle}-${crypto.randomUUID()}`;
  const hash = await sha256hex(token);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, google_sub, email, handle, display_name) VALUES (?, ?, ?, ?, ?)").bind(id, `sub-${handle}`, `${handle}@example.test`, handle, handle.toUpperCase()),
    env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").bind(hash, id),
    ...(member ? [env.DB.prepare("INSERT INTO members (user_id) VALUES (?)").bind(id)] : []),
  ]);
  return { id, handle, token };
}

export async function api(u: TestUser | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN, "x-apexnav": "1", "content-type": "application/json", ...extra };
  if (u) headers.cookie = `__Host-ax_session=${u.token}`;
  return exports.default.fetch(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
}

export const ok = async (r: Promise<Response>) => { const res = await r; if (res.status >= 400) throw new Error(`HTTP ${res.status} ${await res.text()}`); return res; };

export async function befriend(a: TestUser, b: TestUser): Promise<void> {
  await ok(api(a, "POST", "/api/friends/request", { handle: b.handle }));
  await ok(api(b, "POST", "/api/friends/accept", { user_id: a.id }));
}

export async function makeSegment(u: TestUser, name = "Dry Ridge climb"): Promise<string> {
  const r = await ok(api(u, "POST", "/api/segments", { name, length_m: 2500, geom: "_p~iF~ps|U_ulLnnqC", start_lat: 39.25, start_lon: -84.6, end_lat: 39.27, end_lon: -84.58 }));
  return ((await r.json()) as { id: string }).id;
}
