import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);

const add = async (u: TestUser, car: Record<string, unknown>) => ((await (await ok(api(u, "POST", "/api/garage", car))).json()) as { id: string }).id;
const mine = async (u: TestUser) => (await (await ok(api(u, "GET", "/api/garage"))).json()) as Record<string, any>[];
const people = async (u: TestUser) => (await (await ok(api(u, "GET", "/api/garage/people"))).json()) as { handle: string; cars: Record<string, any>[] }[];
const m3 = { year: 2003, make: "BMW", model: "M3", trim: "E46 CSL", nickname: "Grace", power_hp: 355, weight_kg: 1385, drivetrain: "rwd", transmission: "manual", tyres: "Michelin PS4S", mods: "Coilovers, bucket seats" };

describe("garage", () => {
  it("you add, edit and delete your cars; the first one is the primary", async () => {
    const a = await makeUser("alice");
    const one = await add(a, m3);
    const two = await add(a, { make: "Mazda", model: "MX-5", year: 1990 });
    let cars = await mine(a);
    expect(cars.map((c) => [c.model, c.is_primary, c.shared])).toEqual([["M3", 1, 0], ["MX-5", 0, 0]]);
    await ok(api(a, "PUT", `/api/garage/${two}`, { make: "Mazda", model: "MX-5", year: 1990, is_primary: true, shared: true }));
    cars = await mine(a);
    expect(cars.map((c) => [c.model, c.is_primary, c.shared])).toEqual([["MX-5", 1, 1], ["M3", 0, 0]]);
    await ok(api(a, "DELETE", `/api/garage/${two}`));
    expect((await mine(a)).map((c) => [c.id, c.is_primary])).toEqual([[one, 1]]);   // the primary moves to the next car
  });

  it("validates every field", async () => {
    const a = await makeUser("alice");
    for (const bad of [{ make: "", model: "M3" }, { make: "BMW" }, { ...m3, year: 1700 }, { ...m3, power_hp: 1.5 }, { ...m3, drivetrain: "4wd" },
                       { ...m3, mods: "x".repeat(501) }, { ...m3, nickname: "Gr‮ace" }, { ...m3, weight_kg: "heavy" },
                       { ...m3, nickname: "Gr\u200face" }, { ...m3, trim: "E46\u200bCSL" }, { ...m3, make: "\u200b", model: "\u200b" }, { ...m3, nickname: "a\nb" }, { ...m3, shared: "true" }, { ...m3, is_primary: 1 }, { ...m3, make: "\u3164" },
                       { ...m3, clearance: "slammed" }, { ...m3, width_cm: 90 }, { ...m3, width_cm: 180.5 }]) {
      expect((await api(a, "POST", "/api/garage", bad)).status, JSON.stringify(bad)).toBe(400);
    }
    for (const bad of [null, [], "car"]) expect((await api(a, "POST", "/api/garage", bad)).status, JSON.stringify(bad)).toBe(400);
    // a mods list keeps its lines; emoji (with joiners) are fine
    const id = await add(a, { ...m3, nickname: "Grace 👩‍🔧", mods: "Coilovers\r\nBucket seats\nLSD" });
    const car = (await mine(a)).find((c) => c.id === id)!;
    expect([car.nickname, car.mods]).toEqual(["Grace 👩‍🔧", "Coilovers\nBucket seats\nLSD"]);
  });

  it("keeps ride height and width for routing (IDEAS R-20); unknown stays null", async () => {
    const a = await makeUser("alice");
    const id = await add(a, { ...m3, clearance: "low", width_cm: 190 });
    expect((await mine(a)).find((c) => c.id === id)).toMatchObject({ clearance: "low", width_cm: 190 });
    await ok(api(a, "PUT", `/api/garage/${id}`, { ...m3, clearance: "stock" }));
    expect((await mine(a)).find((c) => c.id === id)).toMatchObject({ clearance: "stock", width_cm: null });
  });

  it("ten cars at most, even when added all at once", async () => {
    const a = await makeUser("alice");
    const res = await Promise.all(Array.from({ length: 14 }, (_, i) => api(a, "POST", "/api/garage", { make: "Car", model: String(i) })));
    expect(res.filter((r) => r.status === 201).length).toBe(10);
    expect(res.filter((r) => r.status === 429).length).toBe(4);
    const cars = await mine(a);
    expect(cars.length).toBe(10);
    expect(cars.filter((c) => c.is_primary).length).toBe(1);
  });

  it("there is always exactly one primary car while you have any", async () => {
    const a = await makeUser("alice");
    const one = await add(a, m3), two = await add(a, { make: "Mazda", model: "MX-5" }), three = await add(a, { make: "Honda", model: "S2000", is_primary: true });
    const primaries = async () => (await mine(a)).filter((c) => c.is_primary).map((c) => c.id);
    expect(await primaries()).toEqual([three]);
    await ok(api(a, "DELETE", `/api/garage/${two}`));              // not the primary: nothing moves
    expect(await primaries()).toEqual([three]);
    await ok(api(a, "DELETE", `/api/garage/${three}`));
    expect(await primaries()).toEqual([one]);
    expect((await api(a, "DELETE", `/api/garage/${three}`)).status).toBe(404);
  });

  it("only the owner can change or delete a car", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const id = await add(a, m3);
    expect((await api(b, "PUT", `/api/garage/${id}`, m3)).status).toBe(404);
    expect((await api(b, "DELETE", `/api/garage/${id}`)).status).toBe(404);
    expect((await mine(b))).toEqual([]);
  });

  it("friends and private crew-mates see shared cars only; strangers, public-crew joiners and blocked people see nothing", async () => {
    const [a, friend, mate, stranger, joiner, asked] = [await makeUser("alice"), await makeUser("frank"), await makeUser("mia"), await makeUser("stan"), await makeUser("pat"), await makeUser("quinn")];
    await add(a, { ...m3, shared: true });
    await add(a, { make: "Honda", model: "Civic", shared: false });
    await befriend(a, friend);
    await ok(api(asked, "POST", "/api/friends/request", { handle: "alice" }));    // a request alice hasn't accepted
    const mk = async (crew: Record<string, unknown>) => ((await (await ok(api(a, "POST", "/api/crews", crew))).json()) as { id: string }).id;
    const priv = await mk({ name: "Secret Squirrels" });
    const { token } = (await (await ok(api(a, "POST", `/api/crews/${priv}/invite`))).json()) as { token: string };
    await ok(api(mate, "POST", "/api/crews/join", { token }));
    const pub = await mk({ name: "Ridge Runners", visibility: "public", area: { name: "Robbinsville", lat: 35.3, lon: -83.8 } });
    await ok(api(joiner, "POST", `/api/crews/${pub}/join`));
    expect(await people(joiner)).toEqual([]);
    expect(await people(asked)).toEqual([]);
    for (const who of [friend, mate]) {
      const seen = await people(who);
      expect(seen.map((p) => p.handle)).toEqual(["alice"]);
      expect(seen[0].cars.map((c) => c.model)).toEqual(["M3"]);
      expect(Object.keys(seen[0].cars[0])).not.toContain("owner");
      expect(Object.keys(seen[0].cars[0])).not.toContain("shared");
    }
    expect(await people(stranger)).toEqual([]);
    await ok(api(mate, "POST", "/api/blocks", { user_id: a.id }));
    expect(await people(mate)).toEqual([]);
    await ok(api(a, "POST", "/api/blocks", { user_id: friend.id }));      // the owner blocking works too
    expect(await people(friend)).toEqual([]);
  });

  it("leaving the crew ends the view; people with no handle aren't listed", async () => {
    const [a, mate, nameless] = [await makeUser("alice"), await makeUser("mia"), await makeUser("nemo")];
    await add(a, { ...m3, shared: true });
    await add(nameless, { make: "Mazda", model: "MX-5", shared: true });
    const crew = ((await (await ok(api(a, "POST", "/api/crews", { name: "Secret Squirrels" }))).json()) as { id: string }).id;
    for (const u of [mate, nameless]) {
      const { token } = (await (await ok(api(a, "POST", `/api/crews/${crew}/invite`))).json()) as { token: string };
      await ok(api(u, "POST", "/api/crews/join", { token }));
    }
    const { env } = await import("cloudflare:workers");
    await env.DB.prepare("UPDATE users SET handle = NULL WHERE id = ?").bind(nameless.id).run();
    expect((await people(mate)).map((p) => p.handle)).toEqual(["alice"]);
    await ok(api(mate, "DELETE", `/api/crews/${crew}/membership`));
    expect(await people(mate)).toEqual([]);
  });

  it("cars are in your export and go with your account", async () => {
    const a = await makeUser("alice");
    await add(a, m3);
    const ex = (await (await ok(api(a, "GET", "/api/me/export"))).json()) as { cars: { model: string }[] };
    expect(ex.cars.map((c) => c.model)).toEqual(["M3"]);
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    const { env } = await import("cloudflare:workers");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM cars").first<{ n: number }>())!.n).toBe(0);
  });
});
