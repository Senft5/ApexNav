// Feature flags and staged rollouts (IDEAS Y-06). A TestFlight build is the binary that later goes to the App Store, so
// rollouts can't be per binary: the Worker says which features are on for the asking build instead. A flag can need a
// minimum build, a platform, or a share of installs (a stable bucket from a random install id the phone made up, never a
// person), and any feature the app ships with can be switched off here without a release. The `FLAGS` variable (JSON,
// Cloudflare dashboard → Workers → apexnav → Settings → Variables) overrides the defaults below, flag by flag.
import { Env } from "./util";

export interface Rule { on?: boolean; minBuild?: number; percent?: number; platforms?: ("ios" | "web")[] }

/** What ships on: kill switches for the newest features (all on; set { "on": false } in FLAGS to turn one off). */
export const DEFAULT_FLAGS: Record<string, Rule> = {
  track_mode: { on: true },          // D-15 lap timing on raceways
  taste_ranking: { on: true },       // R-33 your taste nudging fun routes
  crowd_curvature: { on: true },     // Q-04 members' corners over the map's
  measured_stages: { on: true },     // R-04 measurements and hazards in stage discovery
};

const BUILD = /ApexNav\/[\d.]+ \((\d+)\)/;

async function bucket(install: string, name: string): Promise<number> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${install}|${name}`)));
  return ((h[0] << 8) | h[1]) % 100;
}

export async function flagsFor(env: Env, req: Request) {
  const ua = req.headers.get("user-agent") ?? "", m = BUILD.exec(ua);
  const build = m ? Number(m[1]) : null, platform: "ios" | "web" = m ? "ios" : "web";
  const install = new URL(req.url).searchParams.get("install") ?? "";
  let override: Record<string, Rule> = {};
  try { override = env.FLAGS ? JSON.parse(env.FLAGS) : {}; } catch { override = {}; }   // a typo in FLAGS: the defaults stand
  const rules = { ...DEFAULT_FLAGS, ...override };
  const flags: Record<string, boolean> = {};
  for (const [name, r] of Object.entries(rules)) {
    if (!r || typeof r !== "object") continue;
    let on = r.on !== false;
    if (on && Array.isArray(r.platforms) && !r.platforms.includes(platform)) on = false;
    if (on && typeof r.minBuild === "number" && platform === "ios" && !(build !== null && build >= r.minBuild)) on = false;
    if (on && typeof r.percent === "number" && r.percent < 100) on = /^[A-Za-z0-9_-]{8,64}$/.test(install) && (await bucket(install, name)) < r.percent;
    flags[name] = on;
  }
  return { flags, build, platform };
}
