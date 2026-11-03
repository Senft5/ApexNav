// Private themes (migration 0044 theme_grants): GET /api/me sends a theme's look only to an account granted it by hand;
// any other account, signed out, or a grant taken away, gets none. The grant is in the export and goes with the account.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser } from "./helpers";
import PRIVATE_THEMES from "../src/private_themes.json";

beforeEach(freshDb);
const grant = (id: string, theme: string) => env.DB.prepare("INSERT INTO theme_grants (user_id, theme, note) VALUES (?, ?, 'test')").bind(id, theme).run();
const me = async (u: Parameters<typeof api>[0]) => (await (await api(u, "GET", "/api/me")).json()) as { signed_in: boolean; themes?: { id: string }[] };

describe("private themes", () => {
  it("a granted account gets the looks; another account gets none; signed out gets nothing", async () => {
    const owner = await makeUser("owner"), codev = await makeUser("codev", false), other = await makeUser("other");
    for (const u of [owner, codev]) { await grant(u.id, "tiburon"); await grant(u.id, "frs"); }
    const a = await me(owner), b = await me(codev), c = await me(other), out = await me(null);
    expect(a.themes!.map((t) => t.id)).toEqual(["frs", "tiburon"]);
    expect(a.themes!.find((t) => t.id === "tiburon")).toEqual(PRIVATE_THEMES.tiburon);   // the whole look, as the app checks it
    expect(b.themes!.map((t) => t.id)).toEqual(["frs", "tiburon"]);                          // not a member yet: still theirs
    expect(c.themes).toEqual([]);
    expect(out).toEqual({ signed_in: false });
    expect(JSON.stringify(out)).not.toContain("tiburon");
  });

  it("a car's own look (its cluster, its outline, its sounds) goes only with the grant", async () => {
    const owner = await makeUser("owner"), other = await makeUser("other");
    await grant(owner.id, "frs");
    const a = (await (await api(owner, "GET", "/api/me")).json()) as { themes: { id: string; car: { silhouette: { body: number[][] }; dial: { parts: unknown[] }; sounds: unknown } }[] };
    const frs = a.themes.find((t) => t.id === "frs")!;
    expect(frs.car.silhouette.body.length).toBeGreaterThan(20);
    expect(frs.car.dial.parts.length).toBeGreaterThan(5);
    expect(frs.car.sounds).toEqual(PRIVATE_THEMES.frs.car.sounds);
    const b = JSON.stringify(await (await api(other, "GET", "/api/me")).json());
    for (const s of ["silhouette", "Ultramarine", "Sterling", PRIVATE_THEMES.frs.car.paint.hex]) expect(b).not.toContain(s);
    expect(JSON.stringify(PRIVATE_THEMES).length).toBeLessThan(24000);   // /api/me carries it on every sign-in check
  });

  it("a grant taken away is gone on the next /api/me; a grant for a theme the server doesn't know is skipped", async () => {
    const u = await makeUser("owner");
    await grant(u.id, "tiburon"); await grant(u.id, "nosuch");
    expect((await me(u)).themes!.map((t) => t.id)).toEqual(["tiburon"]);
    await env.DB.prepare("DELETE FROM theme_grants WHERE user_id = ? AND theme = 'tiburon'").bind(u.id).run();
    expect((await me(u)).themes).toEqual([]);
  });

  it("the grant is in the export and goes with the account", async () => {
    const u = await makeUser("owner");
    await grant(u.id, "frs");
    const ex = (await (await api(u, "GET", "/api/me/export")).json()) as { themes_granted: { theme: string }[] };
    expect(ex.themes_granted.map((t) => t.theme)).toEqual(["frs"]);
    expect((await api(u, "DELETE", "/api/me", { confirm: "DELETE" })).status).toBe(204);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM theme_grants").first<{ n: number }>())!.n).toBe(0);
  });
});
