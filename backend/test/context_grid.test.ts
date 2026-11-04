import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb } from "./helpers";
import { ctxServe } from "../src/context_grid";

beforeEach(freshDb);

describe("context grid bundles (KV)", () => {
  it("serves the index and a bundle to anyone, cached a day", async () => {
    const bytes = new Uint8Array([0x1f, 0x8b, 1, 2, 3]);
    await env.CTX!.put("v1/8/67/97.vcg", bytes);
    await env.CTX!.put("v1/index.json", JSON.stringify({ v: 1, bundles: { "67/97": { bytes: 5 } } }));
    const r = await api(null, "GET", "/api/ctx/v1/8/67/97.vcg");
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
    expect(r.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    const ix = await api(null, "GET", "/api/ctx/v1/index.json");
    expect(ix.status).toBe(200);
    expect(((await ix.json()) as { bundles: Record<string, unknown> }).bundles["67/97"]).toBeTruthy();
  });

  it("a missing bundle, an odd path, or no KV yet is a plain 404", async () => {
    expect((await api(null, "GET", "/api/ctx/v1/8/1/2.vcg")).status).toBe(404);
    expect((await api(null, "GET", "/api/ctx/v1/8/67/97.png")).status).toBe(404);
    expect((await api(null, "GET", "/api/ctx/v1/8/..%2F..%2Fsecret/1.vcg")).status).toBe(404);
    await expect(ctxServe({ ...env, CTX: undefined }, "v1/index.json")).rejects.toThrow("ctx_off");
  });
});
