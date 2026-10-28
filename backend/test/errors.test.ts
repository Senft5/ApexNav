// Anonymous crash reports (src/errors.ts): accepted signed out from the web and the app, scrubbed again, validated, counted per
// day with nothing that identifies a person. The Worker's own 500s are counted the same way, under the route pattern.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env, exports } from "cloudflare:workers";
import { ORIGIN, api, freshDb, makeUser } from "./helpers";
import { DAY_CAP, countError, scrub } from "../src/errors";

beforeEach(freshDb);
const counts = async () => (await env.DB.prepare("SELECT source, kind, message, page, n, stack FROM error_counts ORDER BY message").all()).results;

const report = { kind: "error", app: "web", message: "TypeError: x is undefined", stack: "at f (https://apexnav.test/index.html?a=1:10:5)", page: "/index.html" };

describe("crash reports", () => {
  it("logs a scrubbed line and answers 204, signed out", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await api(null, "POST", "/api/errors", { ...report, message: "bad fix 35.9606123 for nate@example.com" });
    expect(res.status).toBe(204);
    const line = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(line).toEqual({ event: "client_error", kind: "error", app: "web", message: "bad fix [num] for [email]", stack: "at f (https://apexnav.test/index.html:10:5)", page: "/index.html" });
    log.mockRestore();
  });

  it("accepts the app's signed-out report but nothing else signed out from the app", async () => {
    const app = { origin: "apexnav://app" };
    expect((await api(null, "POST", "/api/errors", { ...report, app: "ios" }, app)).status).toBe(204);
    expect((await api(null, "POST", "/api/crews", { name: "x" }, app)).status).toBe(403);
  });

  it("rejects malformed reports and foreign origins", async () => {
    expect((await api(null, "POST", "/api/errors", { ...report, kind: "debug" })).status).toBe(400);
    expect((await api(null, "POST", "/api/errors", { ...report, app: "android" })).status).toBe(400);
    expect((await api(null, "POST", "/api/errors", { ...report, message: "" })).status).toBe(400);
    expect((await api(null, "POST", "/api/errors", { ...report, stack: "x".repeat(10000) })).status).toBe(400);
    expect((await api(null, "POST", "/api/errors", report, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("scrubs like the client", () => {
    expect(scrub("https://a.b/c?token=1#f mail a@b.co 12.345678 abc123def456ghi789jkl012mno", 300)).toBe("https://a.b/c mail [email] [num] [token]");
    expect(scrub("y".repeat(400), 300)).toHaveLength(300);
    expect(scrub("at 48.137, 11.575 ws://h/x?k=v data:text/plain,Bob /u/john%40example.com", 300)).toBe("at [num], [num] ws://h/x data:[…] /u/[email]");
  });

  it("refuses an oversized body even without content-length", async () => {
    const big = new TextEncoder().encode(JSON.stringify({ ...report, stack: "x".repeat(70 * 1024) }));
    const stream = new ReadableStream({ start(c) { c.enqueue(big); c.close(); } });
    const res = await exports.default.fetch(new Request(ORIGIN + "/api/errors", { method: "POST", body: stream, duplex: "half",
      headers: { origin: ORIGIN, "x-apexnav": "1", "content-type": "application/json" } } as RequestInit));
    expect(res.status).toBe(413);
  });

  it("counts reports per day by error, scrubbed and without any person in them", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const u = await makeUser("nate");
    await api(null, "POST", "/api/errors", report);
    await api(u, "POST", "/api/errors", report);
    await api(null, "POST", "/api/errors", { ...report, app: "ios", message: "near 35.9606123" }, { origin: "apexnav://app" });
    expect(await counts()).toEqual([
      { source: "web", kind: "error", message: "TypeError: x is undefined", page: "/index.html", n: 2, stack: "at f (https://apexnav.test/index.html:10:5)" },
      { source: "ios", kind: "error", message: "near [num]", page: "/index.html", n: 1, stack: "at f (https://apexnav.test/index.html:10:5)" },
    ]);
    const cols = (await env.DB.prepare("SELECT name FROM pragma_table_info('error_counts')").all<{ name: string }>()).results.map((c) => c.name);
    expect(cols).toEqual(["day", "source", "kind", "message", "page", "n", "stack", "last_at"]);
    vi.restoreAllMocks();
  });

  it("folds new errors into one overflow row past the daily cap", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(`WITH RECURSIVE i(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM i WHERE x < ?)
                          INSERT INTO error_counts (day, source, kind, message) SELECT ?, 'web', 'error', 'm' || x FROM i`).bind(DAY_CAP, day).run();
    await countError(env, { source: "web", kind: "error", message: "new one", page: "", stack: "" });
    await countError(env, { source: "web", kind: "error", message: "another", page: "", stack: "" });
    await countError(env, { source: "web", kind: "error", message: "m7", page: "", stack: "" });   // already counted today: still bumps
    const over = await env.DB.prepare("SELECT n FROM error_counts WHERE message = '[over daily cap]'").first<{ n: number }>();
    expect(over?.n).toBe(2);
    expect((await env.DB.prepare("SELECT n FROM error_counts WHERE message = 'm7'").first<{ n: number }>())?.n).toBe(2);
    expect((await env.DB.prepare("SELECT COUNT(*) AS c FROM error_counts WHERE message IN ('new one', 'another')").first<{ c: number }>())?.c).toBe(0);
  });

  it("drops days older than 30 when a new row is written", async () => {
    await env.DB.prepare("INSERT INTO error_counts (day, source, kind, message) VALUES (date('now', '-31 days'), 'web', 'error', 'old'), (date('now', '-29 days'), 'web', 'error', 'recent')").run();
    await countError(env, { source: "web", kind: "error", message: "today", page: "", stack: "" });
    expect((await counts()).map((r) => r.message)).toEqual(["recent", "today"]);
  });

  it("counts a server 500 under its route pattern and still answers server_error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const u = await makeUser("nate");
    await env.DB.prepare("ALTER TABLE cars RENAME TO cars_gone").run();
    try {
      const res = await api(u, "GET", "/api/garage");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "server_error" });
    } finally {
      await env.DB.prepare("ALTER TABLE cars_gone RENAME TO cars").run();
    }
    const [row] = await counts();
    expect(row).toMatchObject({ source: "server", kind: "GET /api/garage", n: 1 });
    expect(row.message).toMatch(/^Error: .*cars/);
    vi.restoreAllMocks();
  });

  it("shows the counts to the owner only", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await api(null, "POST", "/api/errors", report);
    await api(null, "POST", "/api/errors", report);
    const owner = await makeUser("owner"), other = await makeUser("rider");
    expect((await api(other, "GET", "/api/ops/errors")).status).toBe(404);
    expect((await api(null, "GET", "/api/ops/errors")).status).toBe(401);
    const res = await api(owner, "GET", "/api/ops/errors?days=3");
    expect(res.status).toBe(200);
    const body = await res.json() as { days: number; errors: { message: string; n: number; days: number; stack: string }[] };
    expect(body.days).toBe(3);
    expect(body.errors).toEqual([expect.objectContaining({ message: "TypeError: x is undefined", n: 2, days: 1, stack: report.stack.replace("?a=1", "") })]);
    expect((await api(owner, "GET", "/api/ops/errors?days=99")).status).toBe(400);
    vi.restoreAllMocks();
  });
});

describe("convoy failures (IDEAS Y-18)", () => {
  it("a convoy socket frame that throws is counted like a server 500", async () => {
    const { ConvoyRoom } = await import("../src/convoy");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const waits: Promise<unknown>[] = [];
    const room = Object.create(ConvoyRoom.prototype) as { env: unknown; ctx: unknown; countFailure(w: string, e: unknown): void };
    room.env = env; room.ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p) };
    room.countFailure("frame", new Error("boom at 35.96123 for x@y.test"));
    await Promise.all(waits);
    expect(await counts()).toEqual([{ source: "server", kind: "convoy frame", message: "boom at [num] for [email]", page: "", n: 1, stack: expect.any(String) }]);
    err.mockRestore();
  });
});
