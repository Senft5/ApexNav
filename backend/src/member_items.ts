// Saved routes and pinned places on your account (big bet #11, migration 0060): save a route or pin Home on one phone and it
// is on the next one, and after a reinstall. The phone sends what changed since it last asked; the newest change wins per
// item (its `at`). A removal is kept as a row with no body for TOMB_DAYS so other phones learn of it, then swept.
// Your own: no one else ever reads these rows. In Download my data; gone with the account (cascade).
import type { Viewer } from "./auth";
import { Env, HttpError } from "./util";

export const KINDS = ["route", "place"] as const;
type Kind = (typeof KINDS)[number];
// The phone keeps 20 routes and 12 places; twice that here, so two phones that each filled up still merge.
export const LIVE_MAX: Record<Kind, number> = { route: 40, place: 24 };
export const ITEM_MAX: Record<Kind, number> = { route: 400_000, place: 2_000 };   // characters of JSON per item
export const PAGE = 50, PUT_MAX_ITEMS = 25, PUT_MAX_CHARS = 1_000_000, TOMB_DAYS = 60;
export const ITEMS_SWEEP = `DELETE FROM member_items WHERE body IS NULL AND seen <= (unixepoch('now', '-${TOMB_DAYS} days') * 1000)`;

const ID_RE = /^[^\u0000-\u001f\u007f]{1,120}$/;   // a route id, or a place name in lower case (any letters, no control characters)
// the phone's clock: not before 2020, not more than a day ahead of ours
const okAt = (at: unknown, now: number): at is number => typeof at === "number" && Number.isInteger(at) && at >= 1_577_836_800_000 && at <= now + 86_400_000;

interface Row { kind: Kind; item_id: string; body: string | null; at: number; seen: number }

/** GET /api/me/items?since=ms: every item changed at or after `since` (0 for all), removals as body null, and the server's
 *  `now` to ask from next time. */
export async function itemsGet(env: Env, v: Viewer, url: URL) {
  const since = Math.max(0, Math.floor(Number(url.searchParams.get("since")) || 0));
  const now = Date.now();
  const rows = (await env.DB.prepare("SELECT kind, item_id, body, at, seen FROM member_items WHERE user_id = ? AND seen >= ? ORDER BY seen LIMIT ?")
    .bind(v.id, since, PAGE).all<Row>()).results;
  // a full page means more may wait: the phone asks again from the last row's seen
  const more = rows.length === PAGE;
  return {
    now: more ? rows[rows.length - 1].seen : now, more,
    items: rows.map((r) => ({ kind: r.kind, id: r.item_id, at: r.at, body: r.body === null ? null : JSON.parse(r.body) })),
  };
}

async function readBody(req: Request): Promise<{ items?: unknown }> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > PUT_MAX_CHARS) throw new HttpError(413, "too_large");
  const raw = await req.text();
  if (raw.length > PUT_MAX_CHARS) throw new HttpError(413, "too_large");
  try { return JSON.parse(raw); } catch { throw new HttpError(400, "bad_json"); }
}

/** PUT /api/me/items { items: [{ kind, id, at, body | null }] }: each one is kept unless the server already has a newer
 *  change of it. Returns how many were taken. One batch, whatever the count (Workers Free: 50 queries per call). */
export async function itemsPut(env: Env, v: Viewer, req: Request) {
  const b = await readBody(req);
  if (!Array.isArray(b.items) || b.items.length > PUT_MAX_ITEMS) throw new HttpError(400, "bad_items");
  const now = Date.now();
  const items = b.items.map((x: any) => {
    if (!x || !KINDS.includes(x.kind) || typeof x.id !== "string" || !ID_RE.test(x.id) || !okAt(x.at, now)) throw new HttpError(400, "bad_item");
    const kind = x.kind as Kind;
    if (kind === "place" && x.id !== x.id.toLowerCase()) throw new HttpError(400, "bad_item");
    const body = x.body === null ? null : JSON.stringify(x.body);
    if (body !== null && (typeof x.body !== "object" || Array.isArray(x.body) || body.length > ITEM_MAX[kind])) throw new HttpError(400, "bad_item");
    return { kind, id: x.id, at: x.at as number, body };
  });
  // how many are live now, and which of these ids are already here, to hold the caps
  const have = (await env.DB.prepare("SELECT kind, item_id, body IS NOT NULL AS live FROM member_items WHERE user_id = ?").bind(v.id)
    .all<{ kind: Kind; item_id: string; live: number }>()).results;
  const live = new Set(have.filter((h) => h.live).map((h) => `${h.kind}\u0000${h.item_id}`));
  for (const it of items) {
    const k = `${it.kind}\u0000${it.id}`;
    if (it.body === null) live.delete(k); else live.add(k);
  }
  for (const kind of KINDS) if ([...live].filter((k) => k.startsWith(kind + "\u0000")).length > LIVE_MAX[kind]) throw new HttpError(409, "too_many");
  if (!items.length) return { taken: 0 };
  // a removal only marks a row that is here: one of an item the account never had keeps nothing (else made-up ids would
  // pile up as removals, uncapped, until the sweep)
  const res = await env.DB.batch(items.map((it) => it.body === null
    ? env.DB.prepare("UPDATE member_items SET body = NULL, at = ?4, seen = ?5 WHERE user_id = ?1 AND kind = ?2 AND item_id = ?3 AND ?4 > at")
      .bind(v.id, it.kind, it.id, it.at, now)
    : env.DB.prepare(
      `INSERT INTO member_items (user_id, kind, item_id, body, at, seen) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, kind, item_id) DO UPDATE SET body = excluded.body, at = excluded.at, seen = excluded.seen
         WHERE excluded.at > member_items.at`).bind(v.id, it.kind, it.id, it.body, it.at, now)));
  return { taken: res.reduce((n, r) => n + (r.meta.changes || 0), 0) };
}

/** DELETE /api/me/items?kind=place: the account's copy of that kind is removed (the switch turned off); the phone keeps its own. */
export async function itemsDelete(env: Env, v: Viewer, url: URL): Promise<void> {
  const kind = url.searchParams.get("kind");
  if (kind !== null && !KINDS.includes(kind as Kind)) throw new HttpError(400, "bad_kind");
  if (kind) await env.DB.prepare("DELETE FROM member_items WHERE user_id = ? AND kind = ?").bind(v.id, kind).run();
  else await env.DB.prepare("DELETE FROM member_items WHERE user_id = ?").bind(v.id).run();
}
