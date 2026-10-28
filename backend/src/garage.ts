// Garage: your cars, and the ones your friends and crew-mates chose to show (docs/SOCIAL.md 2.4).
// A car card carries no location or drive data. Nothing is shown to anyone until its owner switches `shared` on.
import type { Viewer } from "./auth";
import { Env, HttpError, body } from "./util";
import { reportedSql } from "./safety";

const MAX_CARS = 10;
// Controls, format characters (bidi marks and overrides, zero-width), surrogates and private use; ZWJ stays for emoji.
const UNSAFE_RE = /(?!\u200d)[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u2028\u2029]/u;
const VISIBLE_RE = /(?![\u115f\u1160\u3164\uffa0])[\p{L}\p{N}]/u;   // Hangul fillers are letters that draw nothing
const COLS = "id, year, make, model, trim, nickname, color, power_hp, weight_kg, drivetrain, transmission, tyres, mods, shared, is_primary";
const PUBLIC_COLS = "c.id, c.year, c.make, c.model, c.trim, c.nickname, c.color, c.power_hp, c.weight_kg, c.drivetrain, c.transmission, c.tyres, c.mods, c.is_primary";

interface Car {
  year: number | null; make: string; model: string; trim: string | null; nickname: string | null; color: string | null;
  power_hp: number | null; weight_kg: number | null; drivetrain: string | null; transmission: string | null;
  tyres: string | null; mods: string | null; shared: number; is_primary: number;
}

/** Trimmed text or null. `lines` lets newlines through (the mods list); a required field needs a letter or digit. */
function text(v: unknown, field: string, max: number, required = false, lines = false): string | null {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    if (required) throw new HttpError(400, `bad_${field}`);
    return null;
  }
  if (typeof v !== "string") throw new HttpError(400, `bad_${field}`);
  const t = (lines ? v.replace(/\r\n?/g, "\n") : v).trim();
  if (t.length > max || UNSAFE_RE.test(lines ? t.replace(/\n/g, "") : t) || (required && !VISIBLE_RE.test(t))) throw new HttpError(400, `bad_${field}`);
  return t;
}
function whole(v: unknown, field: string, lo: number, hi: number): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new HttpError(400, `bad_${field}`);
  return v;
}
function oneOf(v: unknown, field: string, ok: string[]): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !ok.includes(v)) throw new HttpError(400, `bad_${field}`);
  return v;
}
function flag(v: unknown, field: string): number {
  if (v === undefined || v === null) return 0;
  if (typeof v !== "boolean") throw new HttpError(400, `bad_${field}`);
  return v ? 1 : 0;
}
function parseCar(b: unknown): Car {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "bad_json");
  return parseFields(b as Record<string, unknown>);
}
function parseFields(b: Record<string, unknown>): Car {
  return {
    year: whole(b.year, "year", 1886, 2035), make: text(b.make, "make", 30, true)!, model: text(b.model, "model", 40, true)!,
    trim: text(b.trim, "trim", 40), nickname: text(b.nickname, "nickname", 40), color: text(b.color, "color", 30),
    power_hp: whole(b.power_hp, "power_hp", 1, 3000), weight_kg: whole(b.weight_kg, "weight_kg", 200, 6000),
    drivetrain: oneOf(b.drivetrain, "drivetrain", ["fwd", "rwd", "awd"]), transmission: oneOf(b.transmission, "transmission", ["manual", "auto", "dct"]),
    tyres: text(b.tyres, "tyres", 80), mods: text(b.mods, "mods", 500, false, true), shared: flag(b.shared, "shared"), is_primary: flag(b.is_primary, "is_primary"),
  };
}

export async function myCars(env: Env, v: Viewer) {
  return (await env.DB.prepare(`SELECT ${COLS} FROM cars WHERE owner = ? ORDER BY is_primary DESC, created_at, rowid`).bind(v.id).all()).results;
}

export async function carCreate(env: Env, v: Viewer, req: Request): Promise<{ id: string }> {
  const c = parseCar(await body(req));
  const id = crypto.randomUUID();
  // One batch is one transaction: the cap is checked by the insert itself, so parallel adds can't pass it.
  // The first car is the primary one; a new primary unmarks the rest.
  const [ins] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO cars (id, owner, year, make, model, trim, nickname, color, power_hp, weight_kg, drivetrain, transmission, tyres, mods, shared, is_primary)
                    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                           CASE WHEN ?16 = 1 OR NOT EXISTS (SELECT 1 FROM cars WHERE owner = ?2) THEN 1 ELSE 0 END
                     WHERE (SELECT COUNT(*) FROM cars WHERE owner = ?2) < ?17`)
      .bind(id, v.id, c.year, c.make, c.model, c.trim, c.nickname, c.color, c.power_hp, c.weight_kg, c.drivetrain, c.transmission, c.tyres, c.mods, c.shared, c.is_primary, MAX_CARS),
    env.DB.prepare("UPDATE cars SET is_primary = 0 WHERE owner = ?1 AND id != ?2 AND EXISTS (SELECT 1 FROM cars WHERE id = ?2 AND is_primary = 1)").bind(v.id, id),
  ]);
  if (!ins.meta.changes) throw new HttpError(429, "too_many_cars");
  return { id };
}

/** Owner only: replaces the card. Making it primary unmarks the others. */
export async function carUpdate(env: Env, v: Viewer, id: string, req: Request): Promise<void> {
  const c = parseCar(await body(req));
  // Primary moves by choosing another car, never to none: an edit keeps whatever the row holds now (not a stale read).
  const res = await env.DB.batch([
    ...(c.is_primary ? [env.DB.prepare("UPDATE cars SET is_primary = 0 WHERE owner = ?1 AND id != ?2 AND EXISTS (SELECT 1 FROM cars WHERE id = ?2 AND owner = ?1)").bind(v.id, id)] : []),
    env.DB.prepare(`UPDATE cars SET year = ?, make = ?, model = ?, trim = ?, nickname = ?, color = ?, power_hp = ?, weight_kg = ?, drivetrain = ?,
                    transmission = ?, tyres = ?, mods = ?, shared = ?, is_primary = CASE WHEN ? = 1 THEN 1 ELSE is_primary END WHERE id = ? AND owner = ?`)
      .bind(c.year, c.make, c.model, c.trim, c.nickname, c.color, c.power_hp, c.weight_kg, c.drivetrain, c.transmission, c.tyres, c.mods, c.shared, c.is_primary, id, v.id),
  ]);
  if (!res[res.length - 1].meta.changes) throw new HttpError(404, "no_car");
}

export async function carDelete(env: Env, v: Viewer, id: string): Promise<void> {
  const [del] = await env.DB.batch([
    env.DB.prepare("DELETE FROM cars WHERE id = ? AND owner = ?").bind(id, v.id),
    // if that was the primary, the oldest remaining car takes over
    env.DB.prepare(`UPDATE cars SET is_primary = 1 WHERE id = (SELECT id FROM cars WHERE owner = ?1 ORDER BY created_at, rowid LIMIT 1)
                      AND NOT EXISTS (SELECT 1 FROM cars WHERE owner = ?1 AND is_primary = 1)`).bind(v.id),
  ]);
  if (!del.meta.changes) throw new HttpError(404, "no_car");
}

/** Shared cars of the people you know: accepted friends and members of the same private crew (anyone can join a
 *  public one, so it doesn't count), never anyone either side blocked, never someone with no handle to show. */
export async function peoplesCars(env: Env, v: Viewer) {
  // Start from the people you know (both indexed), then their cars by owner, so the cost follows your circle, not everyone's.
  const rows = (await env.DB.prepare(
    `WITH known(id) AS (
        SELECT CASE WHEN f.user_a = ?1 THEN f.user_b ELSE f.user_a END FROM friendships f WHERE f.status = 'accepted' AND (f.user_a = ?1 OR f.user_b = ?1)
        UNION
        SELECT b.user_id FROM crew_members a JOIN crews cr ON cr.id = a.crew_id AND cr.visibility = 'private'
          JOIN crew_members b ON b.crew_id = a.crew_id WHERE a.user_id = ?1)
     SELECT u.handle, ${PUBLIC_COLS} FROM known k JOIN users u ON u.id = k.id JOIN cars c ON c.owner = k.id
      WHERE k.id != ?1 AND c.shared = 1 AND u.handle IS NOT NULL AND NOT ${reportedSql("car", "c.id")}
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = k.id) OR (b.blocker = k.id AND b.blocked = ?1))
      ORDER BY u.handle, c.is_primary DESC, c.created_at, c.rowid LIMIT 1000`,
  ).bind(v.id).all<{ handle: string } & Record<string, unknown>>()).results;
  const out = new Map<string, { handle: string; cars: Record<string, unknown>[] }>();
  for (const { handle, ...car } of rows) {
    if (!out.has(handle)) out.set(handle, { handle, cars: [] });
    out.get(handle)!.cars.push(car);
  }
  return [...out.values()];
}
