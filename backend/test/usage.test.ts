// src/usage.ts: the Worker meters its own D1 rows and KV calls (Spend Management's block doesn't cover them) and, near the
// month's included amounts, road uploads and photos wait for the 1st with a 503 the app says once.
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, api, freshDb, makeUser } from "./helpers";
import { countedDb } from "../src/query_budget";
import { INCLUDED, countedKv, flushUsage, nextMonthUtc, resetUsageForTest, usageNow } from "../src/usage";

beforeEach(async () => { await freshDb(); resetUsageForTest(); });

const month = () => new Date().toISOString().slice(0, 7);
async function seed(metric: string, n: number) {
  await env.DB.prepare("INSERT INTO error_counts (day, source, kind, message, page, n) VALUES (?, 'server', 'usage', ?, '', ?)")
    .bind(`${month()}-01`, metric, n).run();
}

describe("usage guard", () => {
  it("adds up rows read and written from every result, and first() still answers like D1's", async () => {
    const db = countedDb(env.DB, { n: 0 });
    await db.prepare("CREATE TABLE IF NOT EXISTS t_usage (x INTEGER)").run();
    await db.batch([1, 2, 3].map((x) => db.prepare("INSERT INTO t_usage (x) VALUES (?)").bind(x)));
    expect(await db.prepare("SELECT x FROM t_usage ORDER BY x").first()).toEqual({ x: 1 });
    expect(await db.prepare("SELECT x FROM t_usage ORDER BY x").first("x")).toBe(1);
    expect(await db.prepare("SELECT x FROM t_usage WHERE x > 9").first()).toBeNull();
    await expect(db.prepare("SELECT x FROM t_usage").first("nope")).rejects.toThrow(/D1_COLUMN_NOTFOUND/);
    const u = await usageNow(env);
    expect(u.used.d1_written).toBeGreaterThanOrEqual(3);
    expect(u.used.d1_read).toBeGreaterThanOrEqual(9);
    expect(u.shedding).toBe(false);
  });

  it("counts KV calls and flushes the count into this month's rows", async () => {
    const kv = countedKv(env.PHOTOS!);
    await kv.put("u/1", "a"); await kv.get("u/1"); await kv.get("u/2"); await kv.delete("u/1");
    await flushUsage(env, true);
    const rows = (await env.DB.prepare("SELECT message, n FROM error_counts WHERE kind = 'usage' ORDER BY message").all<{ message: string; n: number }>()).results;
    expect(Object.fromEntries(rows.map((r) => [r.message, r.n]))).toMatchObject({ kv_read: 2, kv_write: 2 });
    await kv.put("u/3", "b");
    await flushUsage(env, true);
    expect((await usageNow(env)).used.kv_write).toBe(3);
  });

  it("near 80% of an included amount, uploads and photos answer 503 until the 1st; everything else keeps working", async () => {
    const u = await makeUser("meter");
    await seed("kv_write", INCLUDED.kv_write * 0.81);
    const s = await usageNow(env);
    expect(s.shedding).toBe(true);
    expect(s.until).toBe(new Date(nextMonthUtc()).toISOString());
    for (const res of [await api(u, "POST", "/api/contribute", { bins: [] }),
      await exports.default.fetch(new Request(`${ORIGIN}/api/photos?kind=profile`, { method: "POST", body: new Uint8Array([1]),
        headers: { origin: ORIGIN, "x-apexnav": "1", "content-type": "image/jpeg", cookie: `__Host-ax_session=${u.token}` } }))]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "service_unavailable", scope: "uploads", until: s.until });
    }
    expect((await api(u, "GET", "/api/me")).status).toBe(200);
  });

  it("under the line nothing waits, and usage rows stay out of the error views", async () => {
    await seed("d1_read", INCLUDED.d1_read * 0.5);
    expect((await usageNow(env)).shedding).toBe(false);
    const u = await makeUser("meter2");
    expect((await api(u, "POST", "/api/contribute", { bins: [] })).status).not.toBe(503);
    const health = await (await exports.default.fetch(new Request(`${ORIGIN}/api/health`))).json() as { failing?: string[] };
    expect(JSON.stringify(health)).not.toContain("d1_read");
  });
});
