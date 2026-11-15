// src/link_preview.ts: a link to the app's front page carries a preview card; a public roadbook's names the book.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeUser, ok } from "./helpers";
import { previewFor, tags, withPreview } from "../src/link_preview";
import type { Env } from "../src/util";

const road = (lat = 35.5, lon = -83.9, n = 60) => Array.from({ length: n }, (_, i) => [lon + i * 1e-3, lat + Math.sin(i / 5) * 1e-3]);
const page = () => new Response("<!doctype html><html><head><title>Vetta</title></head><body></body></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
const E = env as unknown as Env;

describe("link previews", () => {
  beforeEach(freshDb);

  it("a public roadbook's link names the book, its roads and length and who keeps it; private ones stay plain", async () => {
    const a = await makeUser("alice");
    const id = ((await (await ok(api(a, "POST", "/api/roadbooks", { name: "Smokies classics", about: "Three for a dry Saturday" }))).json()) as { id: string }).id;
    await ok(api(a, "POST", `/api/roadbooks/${id}/roads`, { name: "The Dragon", geom: road() }));
    const u = new URL(`https://vettadrive.app/?roadbook=${id}`);
    expect((await previewFor(E, u)).title).toBe("Vetta");                         // private: nothing about it
    await ok(api(a, "PUT", `/api/roadbooks/${id}`, { visibility: "public" }));
    const p = await previewFor(E, u);
    expect(p.title).toBe("Smokies classics · a roadbook on Vetta");
    expect(p.description).toMatch(/^1 road · \d+(\.\d)? mi · kept by @alice\. Three for a dry Saturday$/);
    expect(p.image).toBe("https://vettadrive.app/brand/icon-1024.png");
    expect(p.url).toBe(`https://vettadrive.app/?roadbook=${id}`);
    const html = await (await withPreview(page(), E, u)).text();
    expect(html).toContain('<meta property="og:title" content="Smokies classics · a roadbook on Vetta" />');
    expect(html).toContain("<title>Smokies classics · a roadbook on Vetta</title>");
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });

  it("other links say what they are, never whose; a plain visit gets Vetta's line; a bad id asks nothing", async () => {
    expect((await previewFor(E, new URL("https://vettadrive.app/?crew=abc"))).title).toBe("A crew on Vetta");
    expect((await previewFor(E, new URL("https://vettadrive.app/?add=sam"))).description).not.toContain("sam");
    expect((await previewFor(E, new URL("https://vettadrive.app/"))).title).toBe("Vetta");
    expect((await previewFor(E, new URL("https://vettadrive.app/?roadbook=x'--"))).title).toBe("Vetta");
    const html = await (await withPreview(page(), E, new URL("https://vettadrive.app/"))).text();
    expect(html).toContain('<meta property="og:site_name" content="Vetta" />');
    expect(html).toContain("<title>Vetta</title>");
  });

  it("escapes what members wrote", () => {
    expect(tags({ title: '"><script>x</script>', description: "a & b", image: "i", url: "u" })).toContain('content="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
  });

  it("leaves anything but an HTML page alone", async () => {
    const r = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(await withPreview(r, E, new URL("https://vettadrive.app/"))).toBe(r);
  });
});
