// src/hosts.ts: vettadrive.app is the app, vettadrive.com the information page, www. goes to the bare name, and the
// app-links file says which links open the iPhone app.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { AASA, routeHost } from "../src/hosts";
import type { Env } from "../src/util";

const seen: string[] = [];
const fakeEnv = { ASSETS: { fetch: async (r: Request | string) => { const u = new URL(typeof r === "string" ? r : r.url); seen.push(u.host + u.pathname); return new Response(`asset ${u.pathname}`, { headers: { "content-type": "text/html" } }); } } } as unknown as Env;

describe("hosts", () => {
  it("sends www. to the bare name, path and query kept", async () => {
    const r = (await routeHost(new Request("https://www.vettadrive.app/?road=abc"), fakeEnv))!;
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://vettadrive.app/?road=abc");
    expect((await routeHost(new Request("https://www.vettadrive.com/privacy.html"), fakeEnv))!.headers.get("location")).toBe("https://vettadrive.com/privacy.html");
  });

  it("vettadrive.com's front page is the information page; vettadrive.app's and workers.dev's are the app", async () => {
    seen.length = 0;
    expect(await (await routeHost(new Request("https://vettadrive.com/"), fakeEnv))!.text()).toBe("asset /about");
    expect(await (await routeHost(new Request("https://vettadrive.app/"), fakeEnv))!.text()).toBe("asset /");
    expect(await (await routeHost(new Request("https://apexnav.senftns.workers.dev/index.html"), fakeEnv))!.text()).toBe("asset /index.html");
    expect(await routeHost(new Request("https://vettadrive.app/api/health"), fakeEnv)).toBeNull();
  });

  it("serves apple-app-site-association as JSON: shared links open the app, the API and plain pages don't", async () => {
    const r = await exports.default.fetch(new Request("https://vettadrive.app/.well-known/apple-app-site-association"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json");
    const j = await r.json() as typeof AASA;
    const d = j.applinks.details[0];
    expect(d.appIDs).toEqual(["JNX759T5W6.com.senft.ApexNav"]);
    expect(d.components[0]).toEqual({ "/": "/api/*", exclude: true });
    expect(d.components).toContainEqual({ "/": "/", "?": { road: "?*" } });
    expect(d.components).toContainEqual({ "/": "/", "#": "road=*" });
  });
});
