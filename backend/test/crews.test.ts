import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok } from "./helpers";

beforeEach(freshDb);

const make = async (who: Awaited<ReturnType<typeof makeUser>>, body: Record<string, unknown>) =>
  ((await (await ok(api(who, "POST", "/api/crews", body))).json()) as { id: string }).id;
const discover = async (who: Awaited<ReturnType<typeof makeUser>>, lat: number, lon: number) =>
  (await (await ok(api(who, "GET", `/api/crews/discover?lat=${lat}&lon=${lon}`))).json()) as { id: string; name: string; area_name: string; members: number; km: number }[];

describe("public and private crews", () => {
  it("public crews nearby are listed with name, area and size only; private ones never are", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await make(a, { name: "Ridge Runners", visibility: "public", about: "Sunday mornings", area: { name: "Robbinsville", lat: 35.3254, lon: -83.8071 } });
    await make(a, { name: "Secret Squirrels" });                               // private by default
    await make(a, { name: "Far Away", visibility: "public", area: { name: "Denver", lat: 39.74, lon: -104.99 } });
    const near = await discover(b, 35.4, -83.9);
    expect(near.map((c) => c.name)).toEqual(["Ridge Runners"]);
    expect(near[0]).toMatchObject({ area_name: "Robbinsville", members: 1 });
    expect(Object.keys(near[0]).sort()).toEqual(["about", "area_name", "id", "km", "members", "name"]);   // no owner, no members, no exact point
  });

  it("the area is stored rounded to about 11 km, never the exact point", async () => {
    const a = await makeUser("alice");
    const id = await make(a, { name: "Ridge Runners", visibility: "public", area: { name: "Robbinsville", lat: 35.3254, lon: -83.8071 } });
    const { env } = await import("cloudflare:workers");
    const row = await env.DB.prepare("SELECT area_lat, area_lon FROM crews WHERE id = ?").bind(id).first<{ area_lat: number; area_lon: number }>();
    expect(row!.area_lat).toBeCloseTo(35.3, 6);
    expect(row!.area_lon).toBeCloseTo(-83.8, 6);
  });

  it("anyone can join a public crew; a private one still needs its invite", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const pub = await make(a, { name: "Ridge Runners", visibility: "public", area: { name: "Robbinsville", lat: 35.3, lon: -83.8 } });
    const priv = await make(a, { name: "Secret Squirrels" });
    await ok(api(b, "POST", `/api/crews/${pub}/join`));
    expect(((await (await ok(api(b, "GET", `/api/crews/${pub}/members`))).json()) as unknown[]).length).toBe(2);
    expect((await api(b, "POST", `/api/crews/${priv}/join`)).status).toBe(404);
    expect(await discover(b, 35.3, -83.8)).toEqual([]);                          // already in it: not suggested
  });

  it("blocking hides the owner's public crews both ways", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const pub = await make(a, { name: "Ridge Runners", visibility: "public", area: { name: "Robbinsville", lat: 35.3, lon: -83.8 } });
    await ok(api(a, "POST", "/api/blocks", { user_id: b.id }));
    expect(await discover(b, 35.3, -83.8)).toEqual([]);
    expect((await api(b, "POST", `/api/crews/${pub}/join`)).status).toBe(404);
  });

  it("only the owner changes settings; going public needs an area", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const id = await make(a, { name: "Ridge Runners" });
    expect((await api(a, "PUT", `/api/crews/${id}`, { visibility: "public" })).status).toBe(400);
    expect((await api(b, "PUT", `/api/crews/${id}`, { visibility: "public", area: { name: "X", lat: 35, lon: -83 } })).status).toBe(404);
    await ok(api(a, "PUT", `/api/crews/${id}`, { visibility: "public", about: "All welcome", area: { name: "Robbinsville", lat: 35.3, lon: -83.8 } }));
    expect((await discover(b, 35.3, -83.8)).map((c) => c.name)).toEqual(["Ridge Runners"]);
    const mine = (await (await ok(api(a, "GET", "/api/crews"))).json()) as { visibility: string; about: string; area_name: string }[];
    expect(mine[0]).toMatchObject({ visibility: "public", about: "All welcome", area_name: "Robbinsville" });
    expect((await api(a, "POST", "/api/crews", { name: "Bad", visibility: "everyone" })).status).toBe(400);
  });
});

describe("crew invite links (IDEAS Z-15)", () => {
  const invite = async (who: Awaited<ReturnType<typeof makeUser>>, id: string) => api(who, "POST", `/api/crews/${id}/invite`);

  it("the owner can turn off every link; members already in stay, the old link stops working", async () => {
    const owner = await makeUser("owner"), early = await makeUser("early"), late = await makeUser("late");
    const id = await make(owner, { name: "Night Owls" });
    const { token } = (await (await ok(invite(owner, id))).json()) as { token: string };
    await ok(api(early, "POST", "/api/crews/join", { token }));
    expect((await api(early, "DELETE", `/api/crews/${id}/invites`)).status).toBe(404);   // members can't, only the owner
    expect(await (await ok(api(owner, "DELETE", `/api/crews/${id}/invites`))).json()).toEqual({ revoked: 1 });
    expect((await api(late, "POST", "/api/crews/join", { token })).status).toBe(400);
    const members = (await (await ok(api(owner, "GET", `/api/crews/${id}/members`))).json()) as { handle: string }[];
    expect(members.map((m) => m.handle).sort()).toEqual(["early", "owner"]);
  });

  it("an owner holds at most 10 open links across their crews", async () => {
    const owner = await makeUser("owner");
    const a = await make(owner, { name: "Crew A" }), b = await make(owner, { name: "Crew B" });
    for (let i = 0; i < 10; i++) await ok(invite(owner, i % 2 ? a : b));
    const r = await invite(owner, a);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "too_many_open_invites" });
    await ok(api(owner, "DELETE", `/api/crews/${b}/invites`));
    await ok(invite(owner, a));
  });
});
