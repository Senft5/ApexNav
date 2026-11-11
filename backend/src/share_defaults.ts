// Sharing on by default (the owner, 2026-11-11: "data sharing with friends and private crews should be on by default,
// with an option to turn each off case by case. Public crews should default to off, but prompt you when you join").
// A new friendship, and joining or starting a private crew, gives each side a grant with Scores and Times on. It is an
// INSERT OR IGNORE: a grant someone already set (on or off) is never touched, so only the starting point changes. Each
// one is switched off per friend or per crew as before (PUT /api/grants). Live position, cars and road data are not
// grants and keep their own switches and defaults. A public crew gets no grant: the phone asks on joining.
import type { Env } from "./util";

const GRANT = `INSERT OR IGNORE INTO grants (user_id, audience_type, audience_id, share_scores, share_times)`;

/** Both sides of an accepted friendship start sharing Scores and Times with each other (never across a block). */
export function friendDefaults(env: Env, a: string, b: string) {
  const ok = `EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(?1, ?2) AND f.user_b = MAX(?1, ?2))
    AND NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.blocker = ?1 AND k.blocked = ?2) OR (k.blocker = ?2 AND k.blocked = ?1))`;
  return env.DB.batch([
    env.DB.prepare(`${GRANT} SELECT ?1, 'friend', ?2, 1, 1 WHERE ${ok}`).bind(a, b),
    env.DB.prepare(`${GRANT} SELECT ?2, 'friend', ?1, 1, 1 WHERE ${ok}`).bind(a, b),
  ]);
}

/** A member of a private crew starts sharing Scores and Times with it; a public crew, nothing. */
export function crewDefaults(env: Env, userId: string, crewId: string) {
  return env.DB.prepare(`${GRANT} SELECT ?1, 'crew', ?2, 1, 1 WHERE EXISTS (SELECT 1 FROM crews c WHERE c.id = ?2 AND c.visibility = 'private')
      AND EXISTS (SELECT 1 FROM crew_members m WHERE m.crew_id = ?2 AND m.user_id = ?1)`).bind(userId, crewId).run();
}
