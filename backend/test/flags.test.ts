import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "./helpers";

const UA = (build: number) => ({ "user-agent": `Mozilla/5.0 (iPhone) AppleWebKit ApexNav/1.0 (${build})` });
const get = async (q = "", headers: Record<string, string> = {}) => (await (await api(null, "GET", `/api/flags${q}`, undefined, headers)).json()) as { flags: Record<string, boolean>; build: number | null; platform: string };
afterEach(() => { delete (env as { FLAGS?: string }).FLAGS; });

describe("feature flags (IDEAS Y-06)", () => {
  it("ships the new features on, for the web and the app, without signing in", async () => {
    const w = await get(), i = await get("", UA(377));
    expect(w).toMatchObject({ platform: "web", build: null, flags: { track_mode: true, taste_ranking: true, crowd_curvature: true, measured_stages: true } });
    expect(i).toMatchObject({ platform: "ios", build: 377 });
  });

  it("FLAGS turns a feature off, gates by build and platform, and rolls out to a stable share of installs", async () => {
    (env as { FLAGS?: string }).FLAGS = JSON.stringify({ track_mode: { on: false }, new_thing: { minBuild: 400 }, ios_only: { platforms: ["ios"] }, half: { percent: 50 } });
    const old = await get("?install=abcdefgh01", UA(390)), fresh = await get("?install=abcdefgh01", UA(401)), web = await get("?install=abcdefgh01");
    expect([old.flags.track_mode, old.flags.new_thing, fresh.flags.new_thing, old.flags.ios_only, web.flags.ios_only]).toEqual([false, false, true, true, false]);
    expect(web.flags.taste_ranking).toBe(true);                   // not in FLAGS: the default stands
    const ids = Array.from({ length: 200 }, (_, i) => `install-${String(i).padStart(4, "0")}`);
    const on = (await Promise.all(ids.map((id) => get(`?install=${id}`)))).filter((r) => r.flags.half).length;
    expect(on).toBeGreaterThan(70); expect(on).toBeLessThan(130);
    expect((await get("?install=install-0007")).flags.half).toBe((await get("?install=install-0007")).flags.half);   // the same install, the same answer
    expect((await get("?install=x")).flags.half).toBe(false);      // no install id: not in a partial rollout
  });

  it("a broken FLAGS leaves the defaults", async () => {
    (env as { FLAGS?: string }).FLAGS = "{ not json";
    expect((await get()).flags.track_mode).toBe(true);
  });
});
