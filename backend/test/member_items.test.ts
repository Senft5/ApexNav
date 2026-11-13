// Saved routes and pinned places on your account (src/member_items.ts): what one phone sends, another gets; the newest change
// wins; a removal reaches the other phone; nobody else sees them; caps hold; in the export, gone with the account.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok } from "./helpers";
import { ITEMS_SWEEP, LIVE_MAX, PAGE } from "../src/member_items";

beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const T = 1_790_000_000_000;
const route = (id: string, at: number, name = "Tail of the Dragon") => ({ kind: "route", id, at, body: { v: 1, id, name, coords: [[-84, 35], [-84.01, 35.01]] } });
const place = (name: string, at: number) => ({ kind: "place", id: name.toLowerCase(), at, body: { name, label: "12 Oak St", lat: 39.1, lon: -84.5 } });

describe("member items", () => {
  it("what one phone puts, another gets; then only what changed since", async () => {
    const a = await makeUser("alice");
    expect(await json(api(a, "PUT", "/api/me/items", { items: [route("r1", T), place("Home", T)] }))).toEqual({ taken: 2 });
    const all = await json(api(a, "GET", "/api/me/items?since=0"));
    expect(all.items.map((i: any) => [i.kind, i.id]).sort()).toEqual([["place", "home"], ["route", "r1"]]);
    expect(all.items.find((i: any) => i.kind === "place").body).toEqual({ name: "Home", label: "12 Oak St", lat: 39.1, lon: -84.5 });
    expect(all.more).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    await ok(api(a, "PUT", "/api/me/items", { items: [route("r2", T + 1)] }));
    const next = await json(api(a, "GET", `/api/me/items?since=${all.now + 1}`));
    expect(next.items.map((i: any) => i.id)).toEqual(["r2"]);
  });

  it("the newest change wins; an older one is not taken", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "PUT", "/api/me/items", { items: [route("r1", T + 10, "Newer")] }));
    expect(await json(api(a, "PUT", "/api/me/items", { items: [route("r1", T, "Older")] }))).toEqual({ taken: 0 });
    expect((await json(api(a, "GET", "/api/me/items"))).items[0].body.name).toBe("Newer");
  });

  it("a removal reaches the other phone as body null, and is swept after 60 days", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "PUT", "/api/me/items", { items: [place("Work", T)] }));
    await ok(api(a, "PUT", "/api/me/items", { items: [{ kind: "place", id: "work", at: T + 1, body: null }] }));
    expect((await json(api(a, "GET", "/api/me/items"))).items).toEqual([{ kind: "place", id: "work", at: T + 1, body: null }]);
    await env.DB.prepare("UPDATE member_items SET seen = seen - 61 * 86400000").run();
    await env.DB.prepare(ITEMS_SWEEP).run();
    expect((await json(api(a, "GET", "/api/me/items"))).items).toEqual([]);
  });

  it("your own: another account sees none of them", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    await ok(api(a, "PUT", "/api/me/items", { items: [place("Home", T)] }));
    expect((await json(api(b, "GET", "/api/me/items"))).items).toEqual([]);
    expect((await api(null, "GET", "/api/me/items")).status).toBe(401);
  });

  it("refuses bad items, too many, and a clock far ahead", async () => {
    const a = await makeUser("alice");
    const put = (items: unknown) => api(a, "PUT", "/api/me/items", { items });
    expect((await put([{ kind: "note", id: "x", at: T, body: {} }])).status).toBe(400);
    expect((await put([{ ...place("Home", T), id: "Home" }])).status).toBe(400);            // a place's id is its name in lower case
    expect((await put([route("r1", Date.now() + 3 * 86_400_000)])).status).toBe(400);
    expect((await put([{ ...route("r1", T), body: [1, 2] }])).status).toBe(400);
    const many = Array.from({ length: LIVE_MAX.place + 1 }, (_, i) => place(`P${i}`, T));
    expect((await put(many.slice(0, 20))).status).toBe(200);
    expect((await put(many.slice(20))).status).toBe(409);
    expect((await put([{ kind: "place", id: "p0", at: T + 1, body: null }, ...many.slice(20, 21)])).status).toBe(200);   // a removal makes room
  });

  it("pages: a full page says more, and the next one starts where it stopped", async () => {
    const a = await makeUser("alice");
    const rows = Array.from({ length: PAGE + 5 }, (_, i) => env.DB.prepare("INSERT INTO member_items (user_id, kind, item_id, body, at, seen) VALUES (?, 'route', ?, NULL, ?, ?)").bind(a.id, `r${i}`, T, T + i));
    await env.DB.batch(rows);
    const p1 = await json(api(a, "GET", "/api/me/items?since=0"));
    expect([p1.items.length, p1.more]).toEqual([PAGE, true]);
    const p2 = await json(api(a, "GET", `/api/me/items?since=${p1.now}`));
    expect(new Set([...p1.items, ...p2.items].map((i: any) => i.id)).size).toBe(PAGE + 5);
    expect(p2.more).toBe(false);
  });

  it("the switch off removes the account's copy of that kind only", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "PUT", "/api/me/items", { items: [route("r1", T), place("Home", T)] }));
    expect((await api(a, "DELETE", "/api/me/items?kind=place")).status).toBe(204);
    expect((await json(api(a, "GET", "/api/me/items"))).items.map((i: any) => i.kind)).toEqual(["route"]);
  });

  it("a long route fits (over the usual 64 KB body)", async () => {
    const a = await makeUser("alice");
    const coords = Array.from({ length: 8000 }, (_, i) => [-84 + i * 1e-4, 35 + i * 1e-4]);
    expect(await json(api(a, "PUT", "/api/me/items", { items: [{ kind: "route", id: "long", at: T, body: { v: 1, id: "long", name: "Long", coords } }] }))).toEqual({ taken: 1 });
  });

  it("in Download my data, and gone with the account", async () => {
    const a = await makeUser("alice");
    await ok(api(a, "PUT", "/api/me/items", { items: [place("Home", T)] }));
    const data = await json(api(a, "GET", "/api/me/export"));
    expect(data.saved_routes_and_places).toHaveLength(1);
    expect((await api(a, "DELETE", "/api/me", { confirm: "DELETE" })).status).toBe(204);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM member_items").first<{ n: number }>())!.n).toBe(0);
  });
});
