// Developers (src/developers.ts): GET /api/me says `developer: true` to the owner and the fingerprinted co-developer only,
// members both; anyone else, signed out, or banned gets no such key. The app's developer tools (the Satellite layer) hang on it.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, freshDb, makeBanned, makeUser } from "./helpers";
import { DEV_FINGERPRINTS, emailFingerprint } from "../src/developers";

beforeEach(freshDb);
const me = async (u: Parameters<typeof api>[0]) => (await (await api(u, "GET", "/api/me")).json()) as Record<string, unknown>;

describe("developers", () => {
  it("the owner and the co-developer are developers; another member and signed out are not", async () => {
    const owner = await makeUser("owner"), codev = await makeUser("codev"), other = await makeUser("other");
    // the address as Google may send it: case and spaces don't change the fingerprint (the test's DEV_FINGERPRINTS names it)
    await env.DB.prepare("UPDATE users SET email = ' CODEV@Example.TEST ' WHERE id = ?").bind(codev.id).run();
    expect((await me(owner)).developer).toBe(true);
    expect((await me(codev)).developer).toBe(true);
    const o = await me(other);
    expect(o.signed_in).toBe(true);
    expect("developer" in o).toBe(false);
    expect(await me(null)).toEqual({ signed_in: false });
  });

  it("a banned account is never a developer, even with the address", async () => {
    const codev = await makeBanned("codev");
    const m = await me(codev);
    expect(m.member).toBe(false);
    expect("developer" in m).toBe(false);
  });

  it("only fingerprints are kept, never an address", async () => {
    expect(await emailFingerprint(" Codev@Example.test")).toBe("982c50c806e5c861");
    for (const f of DEV_FINGERPRINTS) expect(f).toMatch(/^[0-9a-f]{16}$/);
  });
});
