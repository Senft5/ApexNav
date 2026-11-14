// A clip or a photo on a drive post (src/post_media.ts): the author puts it, whoever sees the post gets it and no one
// else does, the bytes must be what they say, and it goes with the post, the owner's removal, or the account.
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, befriend, freshDb, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);
const today = new Date().toISOString().slice(0, 10);
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as any;
const post = async (u: TestUser) => (await json(api(u, "POST", "/api/posts", { title: "Cherohala Skyway", driven_on: today }))).id as string;
const mp4 = () => { const b = new Uint8Array(4000); b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70], 0); return b; };   // ....ftyp
const jpeg = () => { const b = new Uint8Array(2000); b.set([0xff, 0xd8, 0xff, 0xe0], 0); return b; };
const put = (u: TestUser, id: string, bytes: Uint8Array, type: string, q = "") =>
  exports.default.fetch(new Request(`https://apexnav.test/api/posts/${id}/media${q}`, { method: "PUT", body: bytes,
    headers: { origin: "https://apexnav.test", "x-apexnav": "1", "content-type": type, cookie: `__Host-ax_session=${u.token}` } }));

describe("post media", () => {
  it("the author puts a clip; friends get it and see it on the card; a stranger gets nothing", async () => {
    const [a, b, c] = [await makeUser("alice"), await makeUser("bob"), await makeUser("cara")];
    await befriend(a, b);
    const id = await post(a);
    expect((await put(b, id, mp4(), "video/mp4")).status).toBe(404);                 // not bob's post
    const r = await put(a, id, mp4(), "video/mp4", "?label=Turn%203");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ kind: "clip", mime: "video/mp4", bytes: 4000, label: "Turn 3" });
    const [p] = (await json(api(b, "GET", "/api/feed"))) as any[];
    expect(p.media).toEqual({ kind: "clip", label: "Turn 3" });
    const got = await api(b, "GET", `/api/posts/${id}/media`);
    expect([got.status, got.headers.get("content-type"), (await got.arrayBuffer()).byteLength]).toEqual([200, "video/mp4", 4000]);
    expect((await api(c, "GET", `/api/posts/${id}/media`)).status).toBe(404);
  });

  it("refuses what isn't what it says, or is too big", async () => {
    const a = await makeUser("alice");
    const id = await post(a);
    expect((await put(a, id, jpeg(), "video/mp4")).status).toBe(415);
    expect((await put(a, id, mp4(), "image/png")).status).toBe(415);
    expect((await put(a, id, new Uint8Array(3_000_001).fill(0xff), "image/jpeg")).status).toBe(413);
    expect((await put(a, id, jpeg(), "image/jpeg")).status).toBe(200);
  });

  it("gone with the post, with the owner's removal, and with the account", async () => {
    const a = await makeUser("alice");
    const ids = [await post(a), await post(a), await post(a)];
    for (const id of ids) await ok(put(a, id, jpeg(), "image/jpeg"));
    await ok(api(a, "DELETE", `/api/posts/${ids[0]}`));
    expect(await env.MEDIA!.head(`post/${ids[0]}`)).toBeNull();
    const owner = await makeUser("owner");
    await ok(api(owner, "POST", "/api/moderation/resolve", { kind: "drive", target: ids[1], action: "remove" }));
    expect(await env.MEDIA!.head(`post/${ids[1]}`)).toBeNull();
    expect(await env.MEDIA!.head(`post/${ids[2]}`)).not.toBeNull();
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect(await env.MEDIA!.head(`post/${ids[2]}`)).toBeNull();
  });
});
