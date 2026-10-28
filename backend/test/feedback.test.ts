// Feedback (src/feedback.ts, IDEAS L-05): anyone may send it; only known diagnostics are kept; a handle only when asked for
// a reply and signed in; a daily cap; the owner reads and closes it, nobody else can.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { api, freshDb, makeUser } from "./helpers";
import { DAY_CAP } from "../src/feedback";
import { SWEEPS } from "../src/sweep";

beforeEach(freshDb);

describe("feedback", () => {
  it("takes feedback signed out, keeps only known diagnostics, never a handle unasked", async () => {
    const r = await api(null, "POST", "/api/feedback", { kind: "bug", message: "  The map went black after a long route  ", app: "ios",
      diag: { version: "1.0 (384)", platform: "iPhone", errors_today: 2, lat: 35.6, secret: "x".repeat(100), screen: 1 }, reply: true });
    expect(r.status).toBe(201);
    const row = await env.DB.prepare("SELECT kind, message, app, diag, handle FROM feedback").first<Record<string, unknown>>();
    expect(row).toEqual({ kind: "bug", message: "The map went black after a long route", app: "ios",
      diag: JSON.stringify({ version: "1.0 (384)", platform: "iPhone", errors_today: 2 }), handle: null });
  });

  it("keeps the handle only when a signed-in person asks for a reply", async () => {
    const u = await makeUser("alice");
    await api(u, "POST", "/api/feedback", { kind: "idea", message: "Night mode", app: "web" });
    await api(u, "POST", "/api/feedback", { kind: "idea", message: "Reply please", app: "web", reply: true });
    const rows = (await env.DB.prepare("SELECT message, handle, diag FROM feedback ORDER BY id").all()).results;
    expect(rows).toEqual([{ message: "Night mode", handle: null, diag: null }, { message: "Reply please", handle: "alice", diag: null }]);
  });

  it("refuses bad feedback and stops at the daily cap", async () => {
    for (const b of [{ kind: "rant", message: "x", app: "ios" }, { kind: "bug", message: "   ", app: "ios" }, { kind: "bug", message: "x", app: "android" },
                     { kind: "bug", app: "ios" }, { kind: "bug", message: "x".repeat(5000), app: "ios" }])
      expect((await api(null, "POST", "/api/feedback", b)).status).toBe(400);
    await env.DB.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${DAY_CAP})
      INSERT INTO feedback (kind, message, app) SELECT 'other', 'x', 'web' FROM n`).run();
    expect((await api(null, "POST", "/api/feedback", { kind: "bug", message: "one more", app: "web" })).status).toBe(429);
  });

  it("the owner reads it and marks it done; others can't", async () => {
    await api(null, "POST", "/api/feedback", { kind: "bug", message: "first", app: "web" });
    await api(null, "POST", "/api/feedback", { kind: "idea", message: "second", app: "ios", diag: { version: "1.0" } });
    const owner = await makeUser("owner"), someone = await makeUser("someone");
    expect((await api(someone, "GET", "/api/ops/feedback")).status).toBe(404);
    let list = (await (await api(owner, "GET", "/api/ops/feedback")).json()) as { id: number; message: string; done: boolean; diag: unknown }[];
    expect(list.map((f) => [f.message, f.done])).toEqual([["second", false], ["first", false]]);
    expect(list[0].diag).toEqual({ version: "1.0" });
    expect((await api(someone, "POST", `/api/ops/feedback/${list[1].id}/done`)).status).toBe(404);
    expect((await api(owner, "POST", `/api/ops/feedback/${list[1].id}/done`)).status).toBe(204);
    expect((await api(owner, "POST", "/api/ops/feedback/999999/done")).status).toBe(404);
    list = (await (await api(owner, "GET", "/api/ops/feedback")).json()) as typeof list;
    expect(list.map((f) => [f.message, f.done])).toEqual([["second", false], ["first", true]]);
  });

  it("deleting the account takes the handle off its feedback", async () => {
    const u = await makeUser("bob");
    await api(u, "POST", "/api/feedback", { kind: "idea", message: "Reply please", app: "web", reply: true });
    expect((await api(u, "DELETE", "/api/me", { confirm: "DELETE" })).status).toBe(204);
    expect((await env.DB.prepare("SELECT message, handle FROM feedback").all()).results).toEqual([{ message: "Reply please", handle: null }]);
  });

  it("the sweep removes feedback after 180 days", async () => {
    await env.DB.prepare("INSERT INTO feedback (kind, message, app, created_at) VALUES ('bug', 'old', 'web', datetime('now', '-200 days')), ('bug', 'new', 'web', datetime('now'))").run();
    await env.DB.prepare(SWEEPS.feedback).run();
    expect((await env.DB.prepare("SELECT message FROM feedback").all()).results).toEqual([{ message: "new" }]);
  });
});
