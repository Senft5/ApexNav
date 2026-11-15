// Anonymous drives (src/anon_drives.ts): anyone sends a gzipped piece; it is stored under the server's own random id with
// nothing about the sender; only the internal read key lists or reads them.
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, type TestUser } from "./helpers";

beforeEach(freshDb);
const ORIGIN = "https://apexnav.test";
const gz = async (o: unknown) => new Uint8Array(await new Response(new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
const send = (u: TestUser | null, bytes: Uint8Array) =>
  exports.default.fetch(new Request(`${ORIGIN}/api/anon/drives`, { method: "POST", body: bytes,
    headers: { origin: ORIGIN, "x-apexnav": "1", "content-type": "application/gzip", ...(u ? { cookie: `__Host-ax_session=${u.token}` } : {}) } }));
const KEY = { authorization: "Bearer testkey-devdrives-0123456789" };

describe("anonymous drives", () => {
  it("a member's or a signed-out phone's piece is kept with no trace of who sent it", async () => {
    const u = await makeUser("alice");
    expect((await send(u, await gz({ v: 1, id: "abc", lat: [39.1] }))).status).toBe(204);
    expect((await send(null, await gz({ v: 1, id: "def", lat: [39.2] }))).status).toBe(204);
    expect((await send(null, new Uint8Array([1, 2, 3]))).status).toBe(415);
    const list = (await (await api(null, "GET", "/api/anon/drives", undefined, KEY)).json()) as { drives: { key: string }[] };
    expect(list.drives).toHaveLength(2);
    for (const d of list.drives) {
      expect(d.key).toMatch(/^\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}\.json\.gz$/);
      expect(d.key).not.toContain(u.id);
      const o = await env.ANON_DRIVES!.head(d.key);
      expect(o!.customMetadata).toEqual({});                                     // no handle, user or IP beside it
    }
    const f = await api(null, "GET", `/api/anon/drives/file?key=${encodeURIComponent(list.drives[0].key)}`, undefined, KEY);
    const back = JSON.parse(await new Response(f.body!.pipeThrough(new DecompressionStream("gzip"))).text());
    expect(["abc", "def"]).toContain(back.id);
    for (const d of list.drives) await env.ANON_DRIVES!.delete(d.key);
  });

  it("only the internal key reads them", async () => {
    const owner = await makeUser("owner");
    expect((await api(null, "GET", "/api/anon/drives")).status).toBe(404);
    expect((await api(owner, "GET", "/api/anon/drives")).status).toBe(404);
    expect((await api(null, "GET", "/api/anon/drives/file?key=2026-11-15/00000000000000000000000000000000.json.gz")).status).toBe(404);
    expect((await api(null, "GET", "/api/anon/drives?prefix=../x", undefined, KEY)).status).toBe(400);
  });
});
