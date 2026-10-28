import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);
const earn = (id: string, octane: number, week = "2026-W43") => env.DB.prepare("INSERT INTO points_ledger (user_id, iso_week, octane) VALUES (?, ?, ?)").bind(id, week, octane).run();

describe("Octane redemptions (IDEAS S-10)", () => {
  it("buys a cosmetic with earned Octane, once, and only with enough", async () => {
    const a = await makeUser("alice");
    await earn(a.id, 50);
    let s = await (await ok(api(a, "GET", "/api/shop"))).json() as { balance: number; owned: string[]; items: { id: string; octane: number }[] };
    expect(s).toMatchObject({ balance: 50, owned: [] });
    expect(s.items.map((i) => i.id)).toContain("accent_rally_blue");
    s = await (await ok(api(a, "POST", "/api/redeem", { item: "accent_rally_blue" }))).json() as typeof s;
    expect(s).toMatchObject({ balance: 10, owned: ["accent_rally_blue"] });
    expect((await api(a, "POST", "/api/redeem", { item: "accent_rally_blue" })).status).toBe(409);
    expect((await api(a, "POST", "/api/redeem", { item: "accent_racing_green" })).status).toBe(402);
    expect((await api(a, "POST", "/api/redeem", { item: "free_octane" })).status).toBe(400);
  });

  it("two at once can't overspend", async () => {
    const a = await makeUser("alice");
    await earn(a.id, 90);
    const r = await Promise.all([api(a, "POST", "/api/redeem", { item: "accent_racing_green" }), api(a, "POST", "/api/redeem", { item: "accent_rally_blue" })]);
    const spent = (await env.DB.prepare("SELECT COALESCE(SUM(octane), 0) AS s FROM redemptions WHERE user_id = ?").bind(a.id).first<{ s: number }>())!.s;
    expect(spent).toBeLessThanOrEqual(90);
    expect(r.filter((x) => x.ok).length).toBe(1);
  });

  it("members only, and in the data export", async () => {
    expect((await api(null, "GET", "/api/shop")).status).toBe(401);
    const a = await makeUser("alice");
    await earn(a.id, 40);
    await ok(api(a, "POST", "/api/redeem", { item: "accent_rally_blue" }));
    const ex = await (await ok(api(a, "GET", "/api/me/export"))).json() as { octane_redemptions: { item: string }[] };
    expect(ex.octane_redemptions.map((x) => x.item)).toEqual(["accent_rally_blue"]);
  });
});
