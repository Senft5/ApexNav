// src/query_budget.ts: every request's D1 queries are counted; tests run with QUERY_LIMIT 50 (wrangler.test.jsonc), so any
// route that makes more single queries than Workers Free allows fails here as it would in production.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { QueryLimitError, countedDb } from "../src/query_budget";

describe("query budget", () => {
  it("counts each single query and each batch as one, and throws past the limit", async () => {
    const q = { n: 0 }, db = countedDb(env.DB, q, 3);
    expect(await db.prepare("SELECT ? AS x").bind(7).first("x")).toBe(7);
    const res = await db.batch([db.prepare("SELECT 1 AS a"), db.prepare("SELECT ? AS b").bind(2), db.prepare("SELECT 3 AS c")]);
    expect(res.map((r) => Object.values(r.results[0] as object)[0])).toEqual([1, 2, 3]);
    expect(q.n).toBe(2);
    await db.prepare("SELECT 1").all();
    expect(() => db.prepare("SELECT 1").run()).toThrow(QueryLimitError);
    expect(q.n).toBe(4);
  });

  it("without a limit it only counts", async () => {
    const q = { n: 0 }, db = countedDb(env.DB, q);
    for (let i = 0; i < 60; i++) await db.prepare("SELECT 1").first();
    expect(q.n).toBe(60);
  });
});
