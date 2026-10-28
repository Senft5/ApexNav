// Daily housekeeping (IDEAS Y-13): rows that expired and can never be used again are deleted, so D1 doesn't keep
// them forever. Used account invites stay (they record who invited whom, which moderation reads as invite chains).
import { Env } from "./util";
import { HEALTH_SWEEP } from "./health";
import { ETA_SWEEP } from "./eta_share";

export const SWEEPS: Record<string, string> = {
  sessions: "DELETE FROM sessions WHERE expires_at <= datetime('now')",
  app_auth_codes: "DELETE FROM app_auth_codes WHERE expires_at <= datetime('now')",
  invites: "DELETE FROM invites WHERE used_at IS NULL AND expires_at <= datetime('now')",
  crew_invites: "DELETE FROM crew_invites WHERE expires_at <= datetime('now')",
  hazard_reports: "DELETE FROM hazard_reports WHERE expires_at <= datetime('now', '-1 day')",   // votes go with them (cascade)
  shared_routes: "DELETE FROM shared_routes WHERE created_at <= datetime('now', '-30 days')",       // audience rows go with them
  // answers first (not left to the cascade), then the drives
  crew_event_rsvps: "DELETE FROM crew_event_rsvps WHERE event_id IN (SELECT id FROM crew_events WHERE starts_at <= datetime('now', '-7 days'))",
  crew_events: "DELETE FROM crew_events WHERE starts_at <= datetime('now', '-7 days')",
  health_counts: HEALTH_SWEEP,
  eta_shares: ETA_SWEEP,
};

export async function sweepExpired(env: Env): Promise<Record<string, number>> {
  const names = Object.keys(SWEEPS);
  const res = await env.DB.batch(names.map((n) => env.DB.prepare(SWEEPS[n])));
  const deleted = Object.fromEntries(names.map((n, i) => [n, res[i].meta.changes ?? 0]));
  console.log(JSON.stringify({ event: "sweep", deleted }));
  return deleted;
}
