// Leaving, and taking your data with you (docs/BACKEND.md section 11). Merged road data is anonymous and stays; everything
// tied to a person goes. Tables without a foreign key to the audience (grants, board entries, segment shares) are cleaned by hand.
import { photosEraseOwner } from "./photos";
import { Env, HttpError, body, cookie } from "./util";
import { SESSION_COOKIE, type Viewer } from "./auth";
import { convoysLeaveAll } from "./convoy";

const all = async <T>(env: Env, sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).all<T>()).results;

export async function exportMyData(env: Env, v: Viewer) {
  const me = await env.DB.prepare("SELECT id, email, handle, display_name AS name, created_at FROM users WHERE id = ?").bind(v.id).first();
  const q = <T>(sql: string) => all<T>(env, sql, v.id);
  return {
    exported_at: new Date().toISOString(),
    profile: me,
    member: await env.DB.prepare("SELECT joined_at, contribute FROM members WHERE user_id = ?").bind(v.id).first(),
    // other people appear only as the handle they already show you
    friends: await q("SELECT u.handle, f.status, f.created_at FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ?1 THEN f.user_b ELSE f.user_a END WHERE f.user_a = ?1 OR f.user_b = ?1"),
    blocks: await q("SELECT u.handle FROM blocks b JOIN users u ON u.id = b.blocked WHERE b.blocker = ?"),
    shared_routes: await q("SELECT name, created_at FROM shared_routes WHERE owner = ?"),
    hazard_reports: await q("SELECT kind, lat, lon, heading, created_at, expires_at, confirms, clears FROM hazard_reports WHERE reported_by = ?"),
    crew_drives_planned: await q("SELECT title, starts_at, meet_name, meet_lat, meet_lon, notes, cancelled, created_at FROM crew_events WHERE created_by = ?"),
    crew_drive_rsvps: await q("SELECT e.title, e.starts_at, r.status, r.updated_at FROM crew_event_rsvps r JOIN crew_events e ON e.id = r.event_id WHERE r.user_id = ?"),
    crew_drives_came_to: await q("SELECT e.title, e.starts_at, a.created_at FROM crew_event_attendance a JOIN crew_events e ON e.id = a.event_id WHERE a.user_id = ?"),
    crews: await q("SELECT c.name, m.role, m.joined_at FROM crew_members m JOIN crews c ON c.id = m.crew_id WHERE m.user_id = ?"),
    segments: await q("SELECT id, name, length_m, geom, origin_id, created_at FROM segments WHERE owner = ?"),
    // audiences are named by what you see in the app (a friend's handle, a crew's name), never by someone else's internal id
    grants: await q(`SELECT g.audience_type, COALESCE(u.handle, c.name) AS audience, g.share_scores, g.share_times FROM grants g
                       LEFT JOIN users u ON g.audience_type = 'friend' AND u.id = g.audience_id LEFT JOIN crews c ON g.audience_type = 'crew' AND c.id = g.audience_id WHERE g.user_id = ?`),
    published_results: await q(`SELECT s.name AS segment, e.audience_type, COALESCE(u.handle, c.name) AS audience, e.driver_score, e.time_s, e.smoothness, e.driven_on FROM board_entries e
                       JOIN segments s ON s.id = e.segment_id LEFT JOIN users u ON e.audience_type = 'friend' AND u.id = e.audience_id
                       LEFT JOIN crews c ON e.audience_type = 'crew' AND c.id = e.audience_id WHERE e.user_id = ?`),
    photos: await q("SELECT id, kind, ref_id, bytes, w, h, created_at FROM photos WHERE owner = ?"),
    pro: await q("SELECT source, since, expires_at FROM pro_entitlements WHERE user_id = ?"),
    decals_kept_off: await q("SELECT c.name FROM decal_optouts o JOIN crews c ON c.id = o.crew_id WHERE o.user_id = ?"),
    builds: await q("SELECT b.id, c.make, c.model, b.stages, b.created_at FROM builds b JOIN cars c ON c.id = b.car_id WHERE b.owner = ?"),
    build_posts: await q("SELECT p.n, p.title, p.body, p.parts, p.score, p.created_at FROM build_posts p JOIN builds b ON b.id = p.build_id WHERE b.owner = ?"),
    build_replies: await q("SELECT body, suggestion, tried, created_at FROM build_replies WHERE author = ?"),
    sharing_on_map: await q("SELECT audience, delay_s, fuzz, updated_at FROM presence_settings WHERE user_id = ?"),
    build_chat: await q("SELECT body, created_at FROM build_chat WHERE author = ?"),
    crew_chat: await q("SELECT c.name AS crew, m.body, m.created_at FROM crew_chat m JOIN crews c ON c.id = m.crew_id WHERE m.author = ?"),
    cars: await q("SELECT year, make, model, trim, nickname, color, power_hp, weight_kg, drivetrain, transmission, tyres, mods, shared, is_primary, created_at FROM cars WHERE owner = ?"),
    highlights: await q("SELECT id, name, category, note, lat, lon, status, created_at FROM highlights WHERE author_id = ?"),
    reports_you_made: await q("SELECT kind, note, status, created_at FROM reports WHERE reporter = ?"),
    highlight_ratings: await q("SELECT highlight_id, stars, visited, created_at FROM highlight_ratings WHERE user_id = ?"),
    points_by_week: await q("SELECT iso_week, octane FROM points_ledger WHERE user_id = ?"),
    road_data_by_month: await q("SELECT month, km, pioneer_km FROM member_months WHERE user_id = ?"),
    octane_redemptions: await q("SELECT item, octane, created_at FROM redemptions WHERE user_id = ?"),
    note: "Merged road data (banking, roughness, crests per 5 m bin) is anonymous and cannot be traced to you, so it is not part of this export and is not deleted with your account.",
  };
}

export async function deleteAccount(env: Env, v: Viewer, req: Request): Promise<Response> {
  const { confirm } = await body<{ confirm?: string }>(req);
  if (confirm !== "DELETE") throw new HttpError(400, "confirmation_required");
  await convoysLeaveAll(env, v.id);                                  // live convoys first: leave them, or end the ones they lead
  await photosEraseOwner(env, v.id);                                 // the JPEGs in KV, then their rows (REVIEW.md 5.2)
  const owned = (await all<{ id: string }>(env, "SELECT id FROM crews WHERE owner = ?", v.id)).map((c) => c.id);
  if (env.PHOTOS) for (const id of owned) for (const p of ["marguerite", "kit", "hale"]) await env.PHOTOS.delete(`cv/${id}/${p}`);   // crews' regroup clips
  const stmts: D1PreparedStatement[] = [];
  const run = (sql: string, ...a: unknown[]) => stmts.push(env.DB.prepare(sql).bind(...a));
  // things other people hold that point at this person (no foreign key, so removed by hand)
  run("DELETE FROM grants WHERE audience_type = 'friend' AND audience_id = ?", v.id);
  run("DELETE FROM board_entries WHERE audience_type = 'friend' AND audience_id = ?", v.id);
  run("DELETE FROM segment_shares WHERE audience_type = 'friend' AND audience_id = ?", v.id);
  // crews they own are dissolved, with everything published to them
  for (const id of owned) {
    run("DELETE FROM grants WHERE audience_type = 'crew' AND audience_id = ?", id);
    run("DELETE FROM board_entries WHERE audience_type = 'crew' AND audience_id = ?", id);
    run("DELETE FROM segment_shares WHERE audience_type = 'crew' AND audience_id = ?", id);
    run("DELETE FROM crews WHERE id = ?", id);
  }
  // crews they only belong to: nothing else of theirs remains there after the cascade below, but their grants/entries use user_id and cascade too
  run("DELETE FROM highlights WHERE author_id = ?", v.id);
  if (v.handle) run("UPDATE feedback SET handle = NULL WHERE handle = ?", v.handle);   // feedback stays, without who sent it (L-05)          // their spots go with them (ratings by others on them cascade)
  run("DELETE FROM users WHERE id = ?", v.id);                       // cascades: sessions, member, friendships, blocks, segments, grants, entries, ratings, pending uploads, points
  await env.DB.batch(stmts);
  return new Response(null, { status: 204, headers: { "set-cookie": cookie(SESSION_COOKIE, "", 0) } });
}
