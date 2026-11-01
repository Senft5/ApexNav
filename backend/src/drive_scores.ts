// The crew Score board as a total (the owner's TestFlight note 06): every drive's Vetta Score, added up over a week, a
// month, a year or all time, for each member who shares Scores with the crew. The app publishes a drive's Score (the
// number and the day only) to each crew the driver has a Scores grant for; switching the grant off, leaving the crew or
// the crew ending removes them (social.ts, account.ts). The old board (best stage Score this month, crew_page.ts `board`)
// stays on the page for old builds.
import type { Viewer } from "./auth";
import { Env, HttpError, body, str } from "./util";
import { isCrewMember } from "./social";
import { reportedSql } from "./reports_sql";
import { atLeast, liveryOf } from "./livery";

export const PERIODS = ["week", "month", "year", "all"] as const;
export type Period = (typeof PERIODS)[number];
export const MAX_BATCH = 50;

/** The first day counted for a period, as a SQLite date expression (UTC; weeks start Monday). */
export function sinceSql(p: Period): string {
  return p === "week" ? "date('now', '-6 days', 'weekday 1')" : p === "month" ? "date('now', 'start of month')"
    : p === "year" ? "date('now', 'start of year')" : "'0000-01-01'";
}

/** POST /api/drives/scores {drives: [{id, score, driven_on}]}: to every crew you share Scores with and are in. */
export async function publishDriveScores(env: Env, v: Viewer, req: Request): Promise<{ published: number; crews: string[] }> {
  const b = await body<{ drives?: unknown }>(req);
  if (!Array.isArray(b.drives) || b.drives.length > MAX_BATCH) throw new HttpError(400, "bad_drives");
  const drives = b.drives.map((d) => {
    const x = (d ?? {}) as { id?: unknown; score?: unknown; driven_on?: unknown };
    const id = str(x.id, "id", 1, 64), day = str(x.driven_on, "driven_on", 10, 10), score = x.score;
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 1000) throw new HttpError(400, "bad_score");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, "bad_driven_on");
    return { id, score, day };
  });
  const crews = (await env.DB.prepare(
    `SELECT g.audience_id AS id FROM grants g JOIN crew_members m ON m.crew_id = g.audience_id AND m.user_id = g.user_id
      WHERE g.user_id = ? AND g.audience_type = 'crew' AND g.share_scores = 1`).bind(v.id).all<{ id: string }>()).results;
  const stmts = crews.flatMap((c) => drives.map((d) => env.DB.prepare(
    `INSERT INTO drive_scores (user_id, drive_id, crew_id, score, driven_on) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (user_id, drive_id, crew_id) DO UPDATE SET score = ?4, driven_on = ?5`).bind(v.id, d.id, c.id, d.score, d.day)));
  if (stmts.length) await env.DB.batch(stmts);
  return { published: stmts.length, crews: crews.map((c) => c.id) };   // which crews got them, so the app knows what's still to send
}

interface Row { handle: string | null; photo_id: string | null; total: number | null; drives: number; mine: number; car: string | null; badge: string | null }

/** GET /api/crews/:id/board?period=week|month|year|all: every member you can see, the total of the drive Scores they
 *  published to this crew in the period (grant still on), else null ("--"). Members only. */
export async function crewBoard(env: Env, v: Viewer, crewId: string, url: URL) {
  if (!(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const q = url.searchParams.get("period") ?? "month";
  if (!(PERIODS as readonly string[]).includes(q)) throw new HttpError(400, "bad_period");
  const period = q as Period;
  const crew = await env.DB.prepare("SELECT visibility FROM crews WHERE id = ?").bind(crewId).first<{ visibility: string }>();
  const works = atLeast((await liveryOf(env, crewId)).tier, "works");
  const shared = `ds.user_id = m.user_id AND ds.crew_id = ?2 AND ds.driven_on >= ${sinceSql(period)}
                  AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = m.user_id AND g.audience_type = 'crew' AND g.audience_id = ?2 AND g.share_scores = 1)`;
  // the same people as the page's board: every member, blocked people left out, a car named only in a private crew
  const rows = (await env.DB.prepare(
    `SELECT u.handle, u.photo_id, (m.user_id = ?1) AS mine, m.badge,
            (SELECT SUM(ds.score) FROM drive_scores ds WHERE ${shared}) AS total,
            (SELECT COUNT(*) FROM drive_scores ds WHERE ${shared}) AS drives,
            CASE WHEN ?3 = 'private' THEN (SELECT TRIM(car.make || ' ' || car.model) FROM cars car
               WHERE car.owner = m.user_id AND car.shared = 1 AND (car.owner = ?1 OR NOT ${reportedSql("car", "car.id")}) ORDER BY car.is_primary DESC, car.created_at LIMIT 1) END AS car
       FROM crew_members m JOIN users u ON u.id = m.user_id
      WHERE m.crew_id = ?2 AND (m.user_id = ?1 OR NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = m.user_id) OR (b.blocker = m.user_id AND b.blocked = ?1)))
      ORDER BY total IS NULL, total DESC, u.handle LIMIT 100`).bind(v.id, crewId, crew?.visibility ?? "public").all<Row>()).results;
  return { period, rows: rows.map((r) => ({ ...r, mine: !!r.mine, badge: works ? r.badge : null })) };
}
