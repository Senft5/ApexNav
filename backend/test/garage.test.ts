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
                       { ...m3, mods: "x".repeat(501) }, { ...m3, nickname: "Gr‮ace" }, { ...m3, weight_kg: "heavy" }]) {
      expect((await api(a, "POST", "/api/garage", bad)).status, JSON.stringify(bad)).toBe(400);
    }
    for (let i = 0; i < 10; i++) await add(a, { make: "Car", model: String(i) });
    expect((await api(a, "POST", "/api/garage", m3)).status).toBe(429);
  });

  it("only the owner can change or delete a car", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const id = await add(a, m3);
    expect((await api(b, "PUT", `/api/garage/${id}`, m3)).status).toBe(404);
    expect((await api(b, "DELETE", `/api/garage/${id}`)).status).toBe(404);
    expect((await mine(b))).toEqual([]);
  });

  it("friends and crew-mates see shared cars only; strangers and blocked people see nothing", async () => {
    const [a, friend, mate, stranger] = [await makeUser("alice"), await makeUser("frank"), await makeUser("mia"), await makeUser("stan")];
    await add(a, { ...m3, shared: true });
    await add(a, { make: "Honda", model: "Civic", shared: false });
    await befriend(a, friend);
    const crew = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners", visibility: "public", area: { name: "Robbinsville", lat: 35.3, lon: -83.8 } }))).json()) as { id: string }).id;
    await ok(api(mate, "POST", `/api/crews/${crew}/join`));
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
