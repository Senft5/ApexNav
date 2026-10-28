// Weekly database backup (src/backup.ts): the dump rebuilds an identical database, the cron writes it to KV, old copies go.
import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";
import { freshDb, makeUser, splitSql } from "./helpers";
import { KEEP, backupDatabase, dumpStatements, literal } from "../src/backup";

const restoreDb = (env as unknown as { RESTORE_TEST: D1Database }).RESTORE_TEST;

/** Every table's rows, in primary-key order, as quoted SQL: equal output means equal data. */
async function snapshot(db: D1Database): Promise<Record<string, string[]>> {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{ name: string }>()).results;
  const out: Record<string, string[]> = {};
  for (const { name } of tables) {
    const cols = (await db.prepare("SELECT name FROM pragma_table_info(?)").bind(name).all<{ name: string }>()).results.map((c) => `typeof(${c.name}) || ':' || quote(${c.name})`);
    out[name] = (await db.prepare(`SELECT ${cols.join(" || '|' || ")} AS r FROM ${name} ORDER BY 1`).all<{ r: string }>()).results.map((x) => x.r);
  }
  return out;
}

async function seed(): Promise<void> {
  await freshDb();
  const a = await makeUser("alpha"), b = await makeUser("beta");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO crews (id, name, owner, about, area_lat, area_lon) VALUES ('c1', 'O''Brien''s; crew\n-- not a comment', ?, NULL, 39.2585571, -84.5994801)").bind(a.id),
    env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, camber_mean, rough_mean, rough_m2) VALUES (664950836, 0, 3, 2, NULL, 0.1, 0.0)"),
    env.DB.prepare("INSERT INTO upload_counts (user_id, bucket, uploads, km) VALUES (?, '2026-10-26T21', 21, 4.5450000000000008)").bind(b.id),
    env.DB.prepare("INSERT INTO seen (h, d) VALUES (X'00FF10', NULL)"),
    env.DB.prepare("INSERT INTO segments (id, owner, name, length_m, geom, start_lat, start_lon, end_lat, end_lon) VALUES ('s1', ?, 'ünïcode 🏁', 3055.0, '[[1,2]]', 1, 2, 3, 4)").bind(a.id),
  ]);
}

describe("database backup", () => {
  it("writes SQL literals for every value D1 returns", () => {
    expect(literal(null)).toBe("NULL");
    expect(literal(4.5450000000000008)).toBe("4.545000000000001");
    expect(Number(literal(4.5450000000000008))).toBe(4.5450000000000008);
    expect(literal("it's")).toBe("'it''s'");
    expect(literal([0, 255, 16])).toBe("X'00FF10'");
    expect(literal(new Uint8Array([1, 2]).buffer)).toBe("X'0102'");
    expect(() => literal(NaN)).toThrow();
  });

  it("rebuilds an identical database from the dump", async () => {
    await seed();
    const { statements, counts } = await dumpStatements(env.DB);
    expect(counts.users).toBe(2);
    expect(counts.road_bins).toBe(1);
    // Restore into an empty second database, the way `wrangler d1 execute --file` would.
    const existing = (await restoreDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()).results;
    if (existing.length) await restoreDb.batch(existing.map((t) => restoreDb.prepare(`DROP TABLE "${t.name}"`)));
    await restoreDb.batch(statements.map((s) => restoreDb.prepare(s)));
    expect(await snapshot(restoreDb)).toEqual(await snapshot(env.DB));
    const idx = async (db: D1Database) => (await db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all()).results;
    expect(await idx(restoreDb)).toEqual(await idx(env.DB));
  });

  it("pages through tables longer than one query page", async () => {
    await freshDb();
    const rows = Array.from({ length: 1205 }, (_, i) => env.DB.prepare("INSERT INTO road_bins (way_id, dir, bin_idx, n, rough_mean) VALUES (1, 0, ?, 1, ?)").bind(i, i / 1000));
    await env.DB.batch(rows);
    const { statements, counts } = await dumpStatements(env.DB);
    expect(counts.road_bins).toBe(1205);
    expect(new Set(statements.filter((s) => s.startsWith('INSERT INTO "road_bins"'))).size).toBe(1205);
  });

  it("the cron stores a dated copy with row counts and keeps the last few", async () => {
    await seed();
    const kv = env.BACKUPS!;
    for (const k of (await kv.list()).keys) await kv.delete(k.name);
    for (let w = 0; w < KEEP + 2; w++) await backupDatabase(env, new Date(Date.UTC(2026, 0, 5 + 7 * w, 7)));
    const keys = (await kv.list({ prefix: "d1/apexnav-db/" })).keys.map((k) => k.name);
    expect(keys).toHaveLength(KEEP);
    expect(keys[0]).toBe("d1/apexnav-db/2026-01-19.sql");
    const { value, metadata } = await kv.getWithMetadata<{ counts: Record<string, number>; bytes: number }>(keys.at(-1)!);
    expect(metadata!.counts.users).toBe(2);
    expect(new TextEncoder().encode(value!).byteLength).toBe(metadata!.bytes);
    expect(splitSql(value!).some((s) => s.startsWith('INSERT INTO "users"'))).toBe(true);
  });

  it("runs from the scheduled handler and logs a line", async () => {
    await seed();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const waits: Promise<unknown>[] = [];
    await worker.scheduled({ cron: "0 7 * * 1", scheduledTime: Date.now(), noRetry() {} } as ScheduledController, env,
      { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
    await Promise.all(waits);
    const line = JSON.parse(log.mock.calls.map((c) => c[0] as string).find((l) => l.includes('"backup"'))!);
    expect(line).toMatchObject({ event: "backup", tables: expect.any(Number), rows: expect.any(Number) });
    log.mockRestore();
  });
});
