// Garage: your cars, and the ones your friends and crew-mates chose to show (docs/SOCIAL.md 2.4).
// A car card carries no location or drive data. Nothing is shown to anyone until its owner switches `shared` on.
import type { Viewer } from "./auth";
import { Env, HttpError, body } from "./util";

const MAX_CARS = 10;
const UNSAFE_RE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const COLS = "id, year, make, model, trim, nickname, color, power_hp, weight_kg, drivetrain, transmission, tyres, mods, shared, is_primary";
const PUBLIC_COLS = "c.id, c.year, c.make, c.model, c.trim, c.nickname, c.color, c.power_hp, c.weight_kg, c.drivetrain, c.transmission, c.tyres, c.mods, c.is_primary";

interface Car {
  year: number | null; make: string; model: string; trim: string | null; nickname: string | null; color: string | null;
  power_hp: number | null; weight_kg: number | null; drivetrain: string | null; transmission: string | null;
  tyres: string | null; mods: string | null; shared: number; is_primary: number;
}

function text(v: unknown, field: string, max: number, required = false): string | null {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    if (required) throw new HttpError(400, `bad_${field}`);
    return null;
  }
  if (typeof v !== "string" || v.trim().length > max || UNSAFE_RE.test(v)) throw new HttpError(400, `bad_${field}`);
  return v.trim();
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
function parseCar(b: Record<string, unknown>): Car {
  return {
    year: whole(b.year, "year", 1886, 2035), make: text(b.make, "make", 30, true)!, model: text(b.model, "model", 40, true)!,
    trim: text(b.trim, "trim", 40), nickname: text(b.nickname, "nickname", 40), color: text(b.color, "color", 30),
    power_hp: whole(b.power_hp, "power_hp", 1, 3000), weight_kg: whole(b.weight_kg, "weight_kg", 200, 6000),
    drivetrain: oneOf(b.drivetrain, "drivetrain", ["fwd", "rwd", "awd"]), transmission: oneOf(b.transmission, "transmission", ["manual", "auto", "dct"]),
    tyres: text(b.tyres, "tyres", 80), mods: text(b.mods, "mods", 500), shared: b.shared === true ? 1 : 0, is_primary: b.is_primary === true ? 1 : 0,
  };
}

export async function myCars(env: Env, v: Viewer) {
  return (await env.DB.prepare(`SELECT ${COLS} FROM cars WHERE owner = ? ORDER BY is_primary DESC, created_at`).bind(v.id).all()).results;
}

export async function carCreate(env: Env, v: Viewer, req: Request): Promise<{ id: string }> {
  const c = parseCar(await body(req));
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM cars WHERE owner = ?").bind(v.id).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_CARS) throw new HttpError(429, "too_many_cars");
  const id = crypto.randomUUID(), primary = c.is_primary || !n?.n ? 1 : 0;    // the first car is the primary one
  await env.DB.batch([
    ...(primary ? [env.DB.prepare("UPDATE cars SET is_primary = 0 WHERE owner = ?").bind(v.id)] : []),
    env.DB.prepare(`INSERT INTO cars (id, owner, year, make, model, trim, nickname, color, power_hp, weight_kg, drivetrain, transmission, tyres, mods, shared, is_primary)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, v.id, c.year, c.make, c.model, c.trim, c.nickname, c.color, c.power_hp, c.weight_kg, c.drivetrain, c.transmission, c.tyres, c.mods, c.shared, primary),
  ]);
  return { id };
}

/** Owner only: replaces the card. Making it primary unmarks the others. */
export async function carUpdate(env: Env, v: Viewer, id: string, req: Request): Promise<void> {
  const c = parseCar(await body(req));
  const own = await env.DB.prepare("SELECT is_primary FROM cars WHERE id = ? AND owner = ?").bind(id, v.id).first<{ is_primary: number }>();
  if (!own) throw new HttpError(404, "no_car");
  const primary = c.is_primary || own.is_primary ? 1 : 0;                     // primary moves by choosing another car, never to none
  await env.DB.batch([
    ...(c.is_primary ? [env.DB.prepare("UPDATE cars SET is_primary = 0 WHERE owner = ? AND id != ?").bind(v.id, id)] : []),
    env.DB.prepare(`UPDATE cars SET year = ?, make = ?, model = ?, trim = ?, nickname = ?, color = ?, power_hp = ?, weight_kg = ?, drivetrain = ?,
                    transmission = ?, tyres = ?, mods = ?, shared = ?, is_primary = ? WHERE id = ? AND owner = ?`)
      .bind(c.year, c.make, c.model, c.trim, c.nickname, c.color, c.power_hp, c.weight_kg, c.drivetrain, c.transmission, c.tyres, c.mods, c.shared, primary, id, v.id),
  ]);
}

export async function carDelete(env: Env, v: Viewer, id: string): Promise<void> {
  const r = await env.DB.prepare("DELETE FROM cars WHERE id = ? AND owner = ? RETURNING is_primary").bind(id, v.id).first<{ is_primary: number }>();
  if (!r) throw new HttpError(404, "no_car");
  if (r.is_primary) {   // the oldest remaining car takes over
    await env.DB.prepare("UPDATE cars SET is_primary = 1 WHERE id = (SELECT id FROM cars WHERE owner = ? ORDER BY created_at LIMIT 1)").bind(v.id).run();
  }
}

/** Shared cars of the people you know: accepted friends and crew-mates, never anyone either side blocked. */
export async function peoplesCars(env: Env, v: Viewer) {
  const rows = (await env.DB.prepare(
    `SELECT u.handle, ${PUBLIC_COLS} FROM cars c JOIN users u ON u.id = c.owner
      WHERE c.shared = 1 AND c.owner != ?1
        AND ( EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(c.owner, ?1) AND f.user_b = MAX(c.owner, ?1))
           OR EXISTS (SELECT 1 FROM crew_members a JOIN crew_members b ON a.crew_id = b.crew_id WHERE a.user_id = ?1 AND b.user_id = c.owner) )
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?1 AND b.blocked = c.owner) OR (b.blocker = c.owner AND b.blocked = ?1))
      ORDER BY u.handle, c.is_primary DESC, c.created_at LIMIT 300`,
  ).bind(v.id).all<{ handle: string | null } & Record<string, unknown>>()).results;
  const out = new Map<string, { handle: string | null; cars: Record<string, unknown>[] }>();
  for (const { handle, ...car } of rows) {
    const k = handle ?? "";
    if (!out.has(k)) out.set(k, { handle, cars: [] });
    out.get(k)!.cars.push(car);
  }
  return [...out.values()];
}
