// Developers' drives (src/dev_drives.ts): only a developer's phone may upload; the files are read back only with the internal
// read key or a developer's session; they go with the account.
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, type TestUser } from "./helpers";

beforeEach(freshDb);
const ORIGIN = "https://apexnav.test";
const gz = async (o: unknown) => new Uint8Array(await new Response(new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
const put = (u: TestUser, id: string, bytes: Uint8Array) =>
  exports.default.fetch(new Request(`${ORIGIN}/api/dev/drives/${id}`, { method: "POST", body: bytes,
    headers: { origin: ORIGIN, "x-apexnav": "1", "content-type": "application/gzip", cookie: `__Host-ax_session=${u.token}` } }));
const KEY = { authorization: "Bearer testkey-devdrives-0123456789" };

describe("dev drives", () => {
  it("a developer's drive goes up and reads back by the key; anyone else's is refused", async () => {
    const owner = await makeUser("owner"), other = await makeUser("other");
    const bytes = await gz({ id: "d1", lat: [39.1, 39.2] });
    expect((await put(other, "d1", bytes)).status).toBe(404);
    const r = await put(owner, "d1", bytes);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ key: `${owner.id}/d1.json.gz`, bytes: bytes.length });
    expect((await put(owner, "d2", new Uint8Array([1, 2, 3]))).status).toBe(415);   // not gzip
    expect((await api(null, "GET", "/api/dev/drives")).status).toBe(404);
    expect((await api(other, "GET", "/api/dev/drives")).status).toBe(404);
    expect((await api(null, "GET", "/api/dev/drives", undefined, { authorization: "Bearer not-the-key-at-all-0000" })).status).toBe(404);
    const list = (await (await api(null, "GET", "/api/dev/drives", undefined, KEY)).json()) as { drives: { key: string; handle: string }[] };
    expect(list.drives.map((d) => [d.key, d.handle])).toEqual([[`${owner.id}/d1.json.gz`, "owner"]]);
    const f = await api(null, "GET", `/api/dev/drives/file?key=${encodeURIComponent(`${owner.id}/d1.json.gz`)}`, undefined, KEY);
    expect(f.status).toBe(200);
    const back = JSON.parse(await new Response(f.body!.pipeThrough(new DecompressionStream("gzip"))).text());
    expect(back).toEqual({ id: "d1", lat: [39.1, 39.2] });
    expect((await api(owner, "GET", "/api/dev/drives")).status).toBe(200);           // the developer's own session reads too
    await env.DEV_DRIVES!.delete(`${owner.id}/d1.json.gz`);
  });

  it("goes with the account", async () => {
    const owner = await makeUser("owner");
    expect((await put(owner, "d9", await gz({ id: "d9" }))).status).toBe(200);
    expect((await api(owner, "DELETE", "/api/me", { confirm: "DELETE" })).status).toBeLessThan(300);
    expect((await env.DEV_DRIVES!.list({ prefix: `${owner.id}/` })).objects).toEqual([]);
  });
});
