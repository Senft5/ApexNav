// Fair meeting points for crew drives (web/crew_meet.js). A member may share, per crew and off by default, the rough area
// they drive from: one 0.1-degree cell (about 11 x 9 km at 40 N, VI-1), stored as its centre. The phone coarsens it before
// sending (from Home in its pinned places, which itself never leaves the phone) and the server coarsens again, so nothing
// finer is kept even from an older or altered client. Crew-mates never see whose cell is whose: the meet answer is the set
// of cells (sorted, no names, no member ids) and only once MIN_SHARING members of that crew share, so one cell can't be
// pinned on the only person sharing. Leaving the crew deletes it (crew_members row); switching it off clears it.
import type { Viewer } from "./auth";
import { Env, HttpError, body } from "./util";

export const CELL_DEG = 0.1;
export const MIN_SHARING = 2;

/** A coordinate pair coarsened to its 0.1-degree cell centre, as stored ("35.85,-83.95"); null when it isn't a position. */
export function cellOf(lat: unknown, lon: unknown): string | null {
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  const c = (x: number) => (Math.floor(x / CELL_DEG) * CELL_DEG + CELL_DEG / 2).toFixed(2);
  return `${c(lat)},${c(lon)}`;
}

const isMember = async (env: Env, crewId: string, userId: string) =>
  !!(await env.DB.prepare("SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?").bind(crewId, userId).first());

/** PUT /api/crews/:id/home { on: true, lat, lon } shares the cell; { on: false } clears it. Members only (else 404). */
export async function crewHomeSet(env: Env, v: Viewer, crewId: string, req: Request): Promise<{ shared: boolean }> {
  if (!(await isMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const b = await body<{ on?: boolean; lat?: number; lon?: number }>(req);
  if (typeof b.on !== "boolean") throw new HttpError(400, "bad_on");
  const cell = b.on ? cellOf(b.lat, b.lon) : null;
  if (b.on && !cell) throw new HttpError(400, "bad_position");
  await env.DB.prepare("UPDATE crew_members SET home_cell = ? WHERE crew_id = ? AND user_id = ?").bind(cell, crewId, v.id).run();
  return { shared: !!cell };
}

/**
 * GET /api/crews/:id/meet: { cells: [[lat, lon], ...] (one per sharing member, sorted, no names), sharing, mine, need }.
 * cells is empty until MIN_SHARING members share (need says how many must). Members only.
 */
export async function crewMeetCells(env: Env, v: Viewer, crewId: string) {
  if (!(await isMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const rows = (await env.DB.prepare("SELECT home_cell, (user_id = ?2) AS mine FROM crew_members WHERE crew_id = ?1 AND home_cell IS NOT NULL")
    .bind(crewId, v.id).all<{ home_cell: string; mine: number }>()).results;
  const mine = rows.some((r) => r.mine === 1);
  if (rows.length < MIN_SHARING) return { cells: [], sharing: rows.length, mine, need: MIN_SHARING };
  const cells = rows.map((r) => r.home_cell.split(",").map(Number) as [number, number]).filter((c) => c.every(Number.isFinite))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { cells, sharing: rows.length, mine, need: MIN_SHARING };
}
