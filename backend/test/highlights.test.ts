import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);

const spot = (over: Record<string, unknown> = {}) => ({ name: "Hawk Overlook", category: "overlook", lat: 39.26, lon: -84.6, ...over });
type H = { id: string; name: string; score: number; ratings: number; my_stars: number | null; mine: number };
const list = async (u: Parameters<typeof api>[0], bbox = "39,-85,40,-84") => (await (await ok(api(u, "GET", `/api/highlights?bbox=${bbox}`))).json()) as H[];

describe("highlights", () => {
  it("are members-only", async () => {
    const out = await makeUser("outsider", false);
    expect((await api(null, "GET", "/api/highlights?bbox=39,-85,40,-84")).status).toBe(401);
    expect((await api(out, "GET", "/api/highlights?bbox=39,-85,40,-84")).status).toBe(403);
    expect((await api(out, "POST", "/api/highlights", spot())).status).toBe(403);
  });

  it("never reveal who added a highlight", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await ok(api(a, "POST", "/api/highlights", spot()));
    const raw = await (await ok(api(b, "GET", "/api/highlights?bbox=39,-85,40,-84"))).text();
    expect(raw).not.toContain(a.id);
    expect(raw).not.toContain("author");
    expect(raw).not.toContain("alice");
  });

  it("are found by bounding box, and an oversized or malformed box is refused", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "POST", "/api/highlights", spot()));
    expect(await list(a)).toHaveLength(1);
    expect(await list(a, "35,-85,36,-84")).toHaveLength(0);
    for (const bad of ["x", "40,-85,39,-84", "30,-100,40,-80", "39,-85,40"]) expect((await api(a, "GET", `/api/highlights?bbox=${bad}`)).status).toBe(400);
  });

  it("score shrinks toward 3 stars so one enthusiastic account cannot pin a spot at 5.0", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("carol")];
    const id = ((await (await ok(api(a, "POST", "/api/highlights", spot()))).json()) as { id: string }).id;
    expect((await list(b))[0].score).toBe(3);
    await ok(api(b, "POST", `/api/highlights/${id}/rating`, { stars: 5 }));
    expect((await list(b))[0]).toMatchObject({ ratings: 1, score: 3.67, my_stars: 5 });
    await ok(api(c, "POST", `/api/highlights/${id}/rating`, { stars: 5, visited: true }));
    expect((await list(c))[0].score).toBe(4);
    await ok(api(c, "POST", `/api/highlights/${id}/rating`, { stars: 1 }));          // changing a rating replaces it
    expect((await list(c))[0]).toMatchObject({ ratings: 2, my_stars: 1 });
  });

  it("the author cannot rate their own spot; only they can delete it", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const id = ((await (await ok(api(a, "POST", "/api/highlights", spot()))).json()) as { id: string }).id;
    expect((await api(a, "POST", `/api/highlights/${id}/rating`, { stars: 5 })).status).toBe(403);
    expect((await api(b, "DELETE", `/api/highlights/${id}`)).status).toBe(404);
    expect((await api(a, "DELETE", `/api/highlights/${id}`)).status).toBe(204);
    expect(await list(a)).toHaveLength(0);
  });

  it("three different reporters hide a highlight; one person reporting three times does not", async () => {
    const users = [await makeUser("u1"), await makeUser("u2"), await makeUser("u3"), await makeUser("u4")];
    const id = ((await (await ok(api(users[0], "POST", "/api/highlights", spot()))).json()) as { id: string }).id;
    for (let i = 0; i < 3; i++) await ok(api(users[1], "POST", `/api/highlights/${id}/report`, {}));
    expect(await list(users[3])).toHaveLength(1);
    await ok(api(users[2], "POST", `/api/highlights/${id}/report`, {}));
    await ok(api(users[3], "POST", `/api/highlights/${id}/report`, {}));
    expect(await list(users[3])).toHaveLength(0);
  });

  it("refuses duplicates within 40 m, validates input, keeps to the US, and limits how many a person adds per day", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "POST", "/api/highlights", spot()));
    expect((await api(a, "POST", "/api/highlights", spot({ name: "Same place again", lat: 39.2601 }))).status).toBe(409);
    expect((await api(a, "POST", "/api/highlights", spot({ category: "secret-base" }))).status).toBe(400);
    expect((await api(a, "POST", "/api/highlights", spot({ lat: 51.5, lon: -0.12 }))).status).toBe(400);
    expect((await api(a, "POST", "/api/highlights", spot({ name: "x" }))).status).toBe(400);
    for (let i = 0; i < 9; i++) await ok(api(a, "POST", "/api/highlights", spot({ name: `Spot ${i}`, lat: 38 + i * 0.01 })));
    expect((await api(a, "POST", "/api/highlights", spot({ name: "One too many", lat: 37 }))).status).toBe(429);
    void env;
  });
});
