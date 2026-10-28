// Share your ETA (src/eta_share.ts, IDEAS S-19): the driver starts, refreshes and ends a link; anyone with it sees only the
// handle, arrival time and freshness; wrong tokens, other people and ended shares get nothing more.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { api, freshDb, makeUser, ok } from "./helpers";
import { MAX_LIVE } from "../src/eta_share";

beforeEach(freshDb);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Record<string, any>;

describe("share your ETA", () => {
  it("shows who and when, nothing else, to anyone with the link; refreshes; ends", async () => {
    const a = await makeUser("alice");
    const { token } = await json(api(a, "POST", "/api/eta", { left_s: 720 }));
    const v = await json(api(null, "GET", `/api/eta/${token}`));
    expect(Object.keys(v).sort()).toEqual(["arrive_at", "ended", "handle", "updated_at"]);
    expect(v.handle).toBe("alice"); expect(v.ended).toBeNull();
    const mins = (Date.parse(v.arrive_at) - Date.now()) / 60000;
    expect(mins).toBeGreaterThan(11); expect(mins).toBeLessThan(13);
    await ok(api(a, "PUT", `/api/eta/${token}`, { left_s: 120 }));
    expect((Date.parse((await json(api(null, "GET", `/api/eta/${token}`))).arrive_at) - Date.now()) / 60000).toBeLessThan(3);
    await ok(api(a, "PUT", `/api/eta/${token}`, { ended: "arrived" }));
    expect((await json(api(null, "GET", `/api/eta/${token}`))).ended).toBe("arrived");
    expect((await api(a, "PUT", `/api/eta/${token}`, { left_s: 60 })).status).toBe(404);   // ended: no more updates
    const row = await env.DB.prepare("SELECT * FROM eta_shares").first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain(token);                                      // only the hash is stored
  });

  it("only the driver updates; bad input and unknown links are refused; a few at a time", async () => {
    const [a, b] = [await makeUser("alice"), await makeUser("bob")];
    const { token } = await json(api(a, "POST", "/api/eta", { left_s: 600 }));
    expect((await api(b, "PUT", `/api/eta/${token}`, { left_s: 1 })).status).toBe(404);
    expect((await api(null, "POST", "/api/eta", { left_s: 600 })).status).toBe(401);
    for (const bad of [{}, { left_s: -1 }, { left_s: 99999999 }]) expect((await api(a, "POST", "/api/eta", bad)).status).toBe(400);
    expect((await api(a, "PUT", `/api/eta/${token}`, { ended: "nope" })).status).toBe(400);
    expect((await api(null, "GET", "/api/eta/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).status).toBe(404);
    expect((await api(null, "GET", "/api/eta/short")).status).toBe(404);
    for (let i = 1; i < MAX_LIVE; i++) await ok(api(a, "POST", "/api/eta", { left_s: 600 }));
    expect((await api(a, "POST", "/api/eta", { left_s: 600 })).status).toBe(429);
  });
});
