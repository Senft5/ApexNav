// Decals and livery tiers (docs/design/REVIEW.md 5.1, roadmap 22). A crew-mate with Vetta Pro puts Decals on every crew
// they're in: one in their first month of continuous Pro, two in the second, three from the third on. A crew's Decals
// set its livery tier; each tier unlocks more of the crew page's look. Decals never touch the board (the Vetta Score only).
// Pro comes only from pro_entitlements, which nothing writes until StoreKit ships (docs/MONETIZATION.md), so every crew is
// Plain today.
import type { Viewer } from "./auth";
import { Env, HttpError, body } from "./util";
import { isCrewMember } from "./social";

export const TIERS = [{ name: "plain", at: 0 }, { name: "club", at: 5 }, { name: "works", at: 12 }, { name: "factory", at: 20 }] as const;
export type Tier = typeof TIERS[number]["name"];
export const MAX_PER_MEMBER = 3;
export const PATTERNS = ["blocks", "bands", "chevron", "checker", "pinstripe"] as const;
/** Event templates a crew may keep at its tier (REVIEW.md 5.1): none Plain, 3 Club, 10 Works and up. */
export const templateCap = (t: Tier) => (t === "plain" ? 0 : t === "club" ? 3 : 10);
const RANK: Record<Tier, number> = { plain: 0, club: 1, works: 2, factory: 3 };

/** The tier for a Decal count, and the next one to reach (null at Factory). */
export function tierFor(decals: number): { tier: Tier; next: { tier: Tier; at: number } | null } {
  let i = 0;
  for (let k = 0; k < TIERS.length; k++) if (decals >= TIERS[k].at) i = k;
  const next = TIERS[i + 1];
  return { tier: TIERS[i].name, next: next ? { tier: next.name, at: next.at } : null };
}
export const atLeast = (have: Tier, need: Tier) => RANK[have] >= RANK[need];

/** SQL: a member's Decals on crew `crewExpr` (0 without active Pro or when they keep them off), for user `userExpr`. */
const DECALS_SQL = (userExpr: string, crewExpr: string) => `
  (SELECT CASE WHEN p.user_id IS NULL OR (p.expires_at IS NOT NULL AND p.expires_at <= datetime('now'))
               OR EXISTS (SELECT 1 FROM decal_optouts o WHERE o.user_id = ${userExpr} AND o.crew_id = ${crewExpr}) THEN 0
          ELSE MIN(${MAX_PER_MEMBER}, 1 + CAST((julianday('now') - julianday(p.since)) / 30 AS INTEGER)) END
     FROM (SELECT ${userExpr} AS uid) x LEFT JOIN pro_entitlements p ON p.user_id = x.uid)`;

/** A crew's livery: its Decals, tier, the next tier, and its supporters (handles and how many each gives). */
export async function liveryOf(env: Env, crewId: string, viewer?: string) {
  const rows = (await env.DB.prepare(
    `SELECT u.handle, ${DECALS_SQL("m.user_id", "m.crew_id")} AS decals, (m.user_id = ?2) AS mine
       FROM crew_members m JOIN users u ON u.id = m.user_id WHERE m.crew_id = ?1`).bind(crewId, viewer ?? "").all<{ handle: string | null; decals: number; mine: number }>()).results;
  const supporters = rows.filter((r) => r.decals > 0).sort((a, b) => b.decals - a.decals).map((r) => ({ handle: r.handle, decals: r.decals }));
  const decals = supporters.reduce((n, r) => n + r.decals, 0);
  return { decals, ...tierFor(decals), supporters };
}
export async function tierOf(env: Env, crewId: string): Promise<Tier> { return (await liveryOf(env, crewId)).tier; }

/** PUT /api/crews/:id/decals { on }: put your Decals on this crew, or keep them off it. */
export async function decalsPlace(env: Env, v: Viewer, crewId: string, req: Request): Promise<void> {
  if (!(await isCrewMember(env, crewId, v.id))) throw new HttpError(404, "no_crew");
  const { on } = await body<{ on?: unknown }>(req);
  if (typeof on !== "boolean") throw new HttpError(400, "bad_on");
  await env.DB.prepare(on ? "DELETE FROM decal_optouts WHERE user_id = ? AND crew_id = ?" : "INSERT OR IGNORE INTO decal_optouts (user_id, crew_id) VALUES (?, ?)").bind(v.id, crewId).run();
}

/** Your own Pro, as the server knows it, and whether your Decals are on this crew. */
export async function myDecals(env: Env, userId: string, crewId: string) {
  const r = await env.DB.prepare(`SELECT ${DECALS_SQL("?1", "?2")} AS decals,
      EXISTS (SELECT 1 FROM pro_entitlements p WHERE p.user_id = ?1 AND (p.expires_at IS NULL OR p.expires_at > datetime('now'))) AS pro,
      EXISTS (SELECT 1 FROM decal_optouts o WHERE o.user_id = ?1 AND o.crew_id = ?2) AS off`).bind(userId, crewId).first<{ decals: number; pro: number; off: number }>();
  return { pro: !!r?.pro, decals: r?.decals ?? 0, on: !r?.off };
}
