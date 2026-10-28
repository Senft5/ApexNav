// Crew standings this month (IDEAS S-11 crew-vs-crew km, S-08 smoothest crew): road data km summed over each crew's
// members, and the mean smoothness of the runs members published to the crew. Never speed, never a person's own numbers:
// only crew totals. Private crews are shown only to their members; public crews are ranked once they have 3 members
// (a crew of one or two would be a person's own totals) and smoothness once 3 runs were published to them this month.
import type { Viewer } from "./auth";
import { Env } from "./util";
import { reportedSql } from "./reports_sql";

export const MIN_MEMBERS = 3, MIN_RUNS = 3, TOP = 10;

interface Row { id: string; name: string; visibility: string; members: number; km: number; smooth: number | null; runs: number; mine: number }

export async function crewStandings(env: Env, v: Viewer) {
  const rows = (await env.DB.prepare(
    `WITH month AS (SELECT strftime('%Y-%m', 'now') AS m, date('now', 'start of month') AS since)
     SELECT c.id, c.name, c.visibility,
            (SELECT COUNT(*) FROM crew_members x WHERE x.crew_id = c.id) AS members,
            (SELECT COALESCE(SUM(mm.km), 0) FROM member_months mm JOIN crew_members x ON x.user_id = mm.user_id AND x.crew_id = c.id, month WHERE mm.month = month.m) AS km,
            (SELECT AVG(be.smoothness) FROM board_entries be, month WHERE be.audience_type = 'crew' AND be.audience_id = c.id AND be.smoothness IS NOT NULL
                AND be.driven_on >= month.since
                AND EXISTS (SELECT 1 FROM crew_members x WHERE x.crew_id = c.id AND x.user_id = be.user_id)
                AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = be.user_id AND g.audience_type = 'crew' AND g.audience_id = c.id AND g.share_scores = 1)) AS smooth,
            (SELECT COUNT(*) FROM board_entries be, month WHERE be.audience_type = 'crew' AND be.audience_id = c.id AND be.smoothness IS NOT NULL
                AND be.driven_on >= month.since
                AND EXISTS (SELECT 1 FROM crew_members x WHERE x.crew_id = c.id AND x.user_id = be.user_id)
                AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = be.user_id AND g.audience_type = 'crew' AND g.audience_id = c.id AND g.share_scores = 1)) AS runs,
            EXISTS (SELECT 1 FROM crew_members x WHERE x.crew_id = c.id AND x.user_id = ?1) AS mine
       FROM crews c
      WHERE EXISTS (SELECT 1 FROM crew_members x WHERE x.crew_id = c.id AND x.user_id = ?1)
         OR (c.visibility = 'public' AND NOT ${reportedSql("crew", "c.id")}
             AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = c.owner) OR (b.blocker = c.owner AND b.blocked = ?1)))`,
  ).bind(v.id).all<Row>()).results;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const ranked = rows.filter((r) => r.visibility === "public" && r.members >= MIN_MEMBERS);
  const byKm = [...ranked].sort((a, b) => b.km - a.km || a.name.localeCompare(b.name));
  const bySmooth = ranked.filter((r) => r.runs >= MIN_RUNS && r.smooth != null).sort((a, b) => b.smooth! - a.smooth! || a.name.localeCompare(b.name));
  const card = (r: Row) => ({ id: r.id, name: r.name, members: r.members, km: r1(r.km), smoothness: r.runs >= MIN_RUNS && r.smooth != null ? Math.round(r.smooth) : null, runs: r.runs });
  const rankOf = (list: Row[], r: Row) => { const i = list.indexOf(r); return i < 0 ? null : i + 1; };
  return {
    month: new Date().toISOString().slice(0, 7),
    mine: rows.filter((r) => r.mine).map((r) => ({ ...card(r), visibility: r.visibility, km_rank: rankOf(byKm, r), smooth_rank: rankOf(bySmooth, r), of: ranked.length })),
    top_km: byKm.slice(0, TOP).map(card),
    top_smooth: bySmooth.slice(0, TOP).map(card),
  };
}

/** Your own month (IDEAS S-11 challenges): km of road data and the km you were first to map. Only ever for yourself. */
export async function myMonth(env: Env, userId: string) {
  const r = await env.DB.prepare("SELECT km, pioneer_km FROM member_months WHERE user_id = ? AND month = strftime('%Y-%m', 'now')")
    .bind(userId).first<{ km: number; pioneer_km: number }>();
  return { km: Math.round((r?.km ?? 0) * 100) / 100, pioneer_km: Math.round((r?.pioneer_km ?? 0) * 100) / 100 };
}
