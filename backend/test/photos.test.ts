import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, api, freshDb, makeBanned, makeUser, ok, type TestUser } from "./helpers";
import { stripJpeg } from "../src/photos";

beforeEach(freshDb);

// A tiny JPEG skeleton: SOI, APP0 (JFIF), APP1 (EXIF with a GPS position), COM, SOF0 (w x h), SOS and a few bytes, EOI.
function jpeg(w = 640, h = 480, withExif = true): Uint8Array {
  const seg = (m: number, payload: number[]) => [0xff, m, ((payload.length + 2) >> 8) & 255, (payload.length + 2) & 255, ...payload];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const bytes = [0xff, 0xd8,
    ...seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(withExif ? seg(0xe1, [...ascii("Exif"), 0, 0, ...ascii("GPS 35.6 -83.9 home")]) : []),
    ...(withExif ? seg(0xfe, ascii("taken at my house")) : []),
    ...seg(0xc0, [8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 0x3f, 0]), 1, 2, 3, 4, 0xff, 0xd9];
  return new Uint8Array(bytes);
}
const upload = (u: TestUser, q: string, body: Uint8Array, type = "image/jpeg") =>
  exports.default.fetch(new Request(`${ORIGIN}/api/photos?${q}`, { method: "POST", body,
    headers: { origin: ORIGIN, "x-apexnav": "1", "content-type": type, cookie: `__Host-ax_session=${u.token}` } }));
const text = (b: ArrayBuffer) => new TextDecoder("latin1").decode(b);

describe("photos", () => {
  it("strips every metadata segment and reads the size", () => {
    const out = stripJpeg(jpeg(800, 600));
    expect([out.w, out.h]).toEqual([800, 600]);
    const s = new TextDecoder("latin1").decode(out.bytes);
    expect(s).toContain("JFIF");
    expect(s).not.toContain("Exif"); expect(s).not.toContain("GPS"); expect(s).not.toContain("my house");
    expect(() => stripJpeg(new Uint8Array([1, 2, 3, 4]))).toThrow();
    expect(() => stripJpeg(jpeg(4000, 300))).toThrow();               // too big a side
  });

  it("a profile photo: uploaded clean, set on you, served to members, gone with the account", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), out = await makeBanned("outsider");
    const { id } = (await (await ok(upload(a, "kind=profile", jpeg()))).json()) as { id: string };
    expect(((await (await ok(api(a, "GET", "/api/me"))).json()) as { photo_id: string }).photo_id).toBe(id);
    const got = await ok(api(b, "GET", `/api/photos/${id}`));
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(text(await got.arrayBuffer())).not.toContain("GPS");
    expect((await api(out, "GET", `/api/photos/${id}`)).status).toBe(403);   // members only
    expect(((await (await ok(api(a, "GET", "/api/me/export"))).json()) as { photos: unknown[] }).photos).toHaveLength(1);
    await ok(api(a, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await api(b, "GET", `/api/photos/${id}`)).status).toBe(404);
  });

  it("only JPEG, only small, only on your own car, at most 12 a car", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const car = ((await (await ok(api(a, "POST", "/api/garage", { make: "Mazda", model: "MX-5" }))).json()) as { id: string }).id;
    expect((await upload(a, `kind=car&ref=${car}`, jpeg(), "image/png")).status).toBe(415);
    expect((await upload(a, `kind=car&ref=${car}`, new Uint8Array(800_000))).status).toBe(413);
    expect((await upload(b, `kind=car&ref=${car}`, jpeg())).status).toBe(404);   // not bob's car
    expect((await upload(a, "kind=car", jpeg())).status).toBe(404);
    const cover = (await (await ok(upload(a, `kind=car&ref=${car}&cover=1`, jpeg()))).json()) as { id: string };
    expect(((await (await ok(api(a, "GET", "/api/garage"))).json()) as { cover_photo_id: string }[])[0].cover_photo_id).toBe(cover.id);
    const res = await Promise.all(Array.from({ length: 14 }, () => upload(a, `kind=car&ref=${car}`, jpeg())));
    expect(res.filter((r) => r.status === 201)).toHaveLength(11);         // 12 with the cover
    const list = (await (await ok(api(b, "GET", `/api/photos?kind=car&ref=${car}`))).json()) as { id: string }[];
    expect(list).toHaveLength(12);
    await ok(api(a, "DELETE", `/api/photos/${cover.id}`));
    expect(((await (await ok(api(a, "GET", "/api/garage"))).json()) as { cover_photo_id: string | null }[])[0].cover_photo_id).toBeNull();
    expect((await api(b, "DELETE", `/api/photos/${list[1].id}`)).status).toBe(404);   // not bob's to delete
    await ok(api(a, "PUT", `/api/photos/${list[1].id}/use`));                          // make another the cover
    expect(((await (await ok(api(a, "GET", "/api/garage"))).json()) as { cover_photo_id: string }[])[0].cover_photo_id).toBe(list[1].id);
    expect((await api(b, "PUT", `/api/photos/${list[2].id}/use`)).status).toBe(404);
  });

  it("one report hides a photo for a day while the owner looks; its owner still sees it", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob"), c = await makeUser("carol");
    const { id } = (await (await ok(upload(a, "kind=profile", jpeg()))).json()) as { id: string };
    await ok(api(b, "POST", "/api/reports", { kind: "photo", target: id, reason: "abuse" }));
    expect((await api(c, "GET", `/api/photos/${id}`)).status).toBe(404);
    expect((await api(a, "GET", `/api/photos/${id}`)).status).toBe(200);
    expect((await api(a, "POST", "/api/reports", { kind: "photo", target: id, reason: "abuse" })).status).toBe(404);   // not your own
  });

  it("a crew's cover is its owner's; a crest of its own needs the Club livery (REVIEW.md 5.1)", async () => {
    const a = await makeUser("alice"), b = await makeUser("bob");
    const crew = ((await (await ok(api(a, "POST", "/api/crews", { name: "Ridge Runners" }))).json()) as { id: string }).id;
    await ok(upload(a, `kind=crew&ref=${crew}`, jpeg()));
    expect((await upload(b, `kind=crew&ref=${crew}`, jpeg())).status).toBe(404);
    expect((await upload(a, `kind=crest&ref=${crew}`, jpeg())).status).toBe(404);          // Plain
    await env.DB.prepare("INSERT INTO pro_entitlements (user_id, source, since) VALUES (?, 'founder', datetime('now', '-90 days'))").bind(a.id).run();
    const tok = ((await (await ok(api(a, "POST", `/api/crews/${crew}/invite`))).json()) as { token: string }).token;
    await ok(api(b, "POST", "/api/crews/join", { token: tok }));
    await env.DB.prepare("INSERT INTO pro_entitlements (user_id, source, since) VALUES (?, 'founder', datetime('now', '-40 days'))").bind(b.id).run();
    await ok(upload(a, `kind=crest&ref=${crew}`, jpeg()));                                  // 3 + 2 = Club
  });
});
