// Octane redemptions (IDEAS S-10): cosmetic items only (cockpit accents), bought with the Octane a member earned by
// sharing road data. Octane can't be bought, nothing redeemable changes safety or a score, and prices live here.
import type { Viewer } from "./auth";
import { Env, HttpError, body } from "./util";

export const ITEMS: Record<string, number> = { accent_rally_blue: 40, accent_racing_green: 80, accent_ink: 150 };

async function balance(env: Env, userId: string): Promise<{ earned: number; spent: number; owned: string[] }> {
  const e = await env.DB.prepare("SELECT COALESCE(SUM(octane), 0) AS s FROM points_ledger WHERE user_id = ?").bind(userId).first<{ s: number }>();
  const r = (await env.DB.prepare("SELECT item, octane FROM redemptions WHERE user_id = ? ORDER BY created_at, item").bind(userId).all<{ item: string; octane: number }>()).results;
  return { earned: e?.s ?? 0, spent: r.reduce((s, x) => s + x.octane, 0), owned: r.map((x) => x.item) };
}

export async function shop(env: Env, v: Viewer) {
  const b = await balance(env, v.id);
  return { balance: Math.round((b.earned - b.spent) * 100) / 100, owned: b.owned, items: Object.entries(ITEMS).map(([id, octane]) => ({ id, octane })) };
}

export async function redeem(env: Env, v: Viewer, req: Request) {
  const { item } = await body<{ item?: string }>(req);
  if (typeof item !== "string" || !(item in ITEMS)) throw new HttpError(400, "bad_item");
  const price = ITEMS[item];
  // one statement: only inserted when the balance (earned - spent, counted inside the insert) covers it, so two
  // redemptions at once can't overspend; the primary key stops buying the same item twice
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO redemptions (user_id, item, octane)
     SELECT ?1, ?2, ?3 WHERE (SELECT COALESCE(SUM(octane), 0) FROM points_ledger WHERE user_id = ?1)
                           - (SELECT COALESCE(SUM(octane), 0) FROM redemptions WHERE user_id = ?1) >= ?3`,
  ).bind(v.id, item, price).run();
  if (!r.meta.changes) {
    const owned = await env.DB.prepare("SELECT 1 FROM redemptions WHERE user_id = ? AND item = ?").bind(v.id, item).first();
    throw new HttpError(owned ? 409 : 402, owned ? "already_owned" : "not_enough_octane");
  }
  return shop(env, v);
}
