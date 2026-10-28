// Health check (IDEAS Y-05): the status workflow reads it to tell "Worker up" from "Worker and database up".
import { describe, expect, it } from "vitest";
import { api } from "./helpers";

describe("health", () => {
  it("answers ok with the database, signed out, never cached", async () => {
    const res = await api(null, "GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, db: true });
  });
});
