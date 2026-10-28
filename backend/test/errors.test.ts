// Anonymous crash reports (src/errors.ts): accepted signed out from the web and the app, scrubbed again, validated, never stored.
import { describe, expect, it, vi } from "vitest";
import { exports } from "cloudflare:workers";
import { ORIGIN, api } from "./helpers";
import { scrub } from "../src/errors";

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
});
