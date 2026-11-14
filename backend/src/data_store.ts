// The map data in our own R2 bucket (DATA, `apexnav-data`; big bet #1, 2026-11-13): the road graph's tiles, the context
// grid's bundles and the camera list, which until now were relayed from raw.githubusercontent.com on every edge-cache
// miss. GitHub raw has no uptime promise for an app and the graph-data branch can't hold the lower 48. CI writes here
// (.github/workflows/data-mirror.yml, tools/graph_etl/upload_r2.sh) with a GitHub OIDC token, checked by
// src/github_oidc.ts: no secret anywhere. The serving routes read R2 first and fall back to GitHub, so nothing breaks
// before the first mirror run or if R2 has a bad hour.
//
// Keys:  graph/v1/index.json            the live index (its `build` names the tile set)
//        graph/v1/b/<build>/<i>_<j>.vgr  one build's tiles: a new build is written beside the old, then the index switches
//        ctx/v1/index.json, ctx/v1/8/<x>/<y>.vcg, cameras/v1/region.json, osm/v2/<bi>_<bj>.bin (+ index.json)
import { verifyGitHubOidc } from "./github_oidc";
import { Env, HttpError, json } from "./util";

export const BUILD = /^[\w.:-]{1,64}$/;
const KEYS = [
  /^graph\/v1\/index\.json$/,
  /^graph\/v1\/b\/[\w.:-]{1,64}\/\d{1,4}_\d{1,4}\.vgr$/,
  /^ctx\/v1\/(index\.json|8\/\d{1,3}\/\d{1,3}\.vcg)$/,
  /^cameras\/v1\/region\.json$/,
  /^osm\/v2\/(index\.json|-?\d{1,4}_-?\d{1,4}\.bin)$/,   // the OSM route context bundles (tools/osm_ctx/build.py, osm_relay.ts)
];
export const MAX_BYTES = 50 * 1024 * 1024;   // a graph tile is about 0.4 MB, the largest bundle a few MB
const KEEP_BUILDS = 2;                        // the live build and the one before it (a phone mid-route may still ask)

export const graphTileKey = (build: string, name: string) => `graph/v1/b/${build}/${name}`;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

// the index is asked for on every tile request: kept a minute per isolate (R2 reads are class B operations)
let indexMemo: { at: number; text: string | null } | null = null;
const INDEX_MS = 60_000;
export function resetDataForTest(): void { indexMemo = null; }

/** graph/v1/index.json's text from R2, or null (no bucket, not mirrored yet, or R2 failed). */
export async function r2GraphIndex(env: Env, now = Date.now()): Promise<string | null> {
  if (!env.DATA) return null;
  if (indexMemo && now - indexMemo.at < INDEX_MS) return indexMemo.text;
  let text: string | null = null;
  try { const o = await env.DATA.get("graph/v1/index.json"); text = o ? await o.text() : null; } catch { text = null; }
  indexMemo = { at: now, text };
  return text;
}

/** A key's bytes from R2, or null. Never throws: GitHub is the fallback. */
export async function r2Bytes(env: Env, key: string): Promise<ArrayBuffer | null> {
  if (!env.DATA) return null;
  try { const o = await env.DATA.get(key); return o ? await o.arrayBuffer() : null; } catch { return null; }
}

/** PUT /api/ops/data?key=…: CI's upload, with `authorization: Bearer <GitHub OIDC token>`. Same bytes as stored: no write. */
export async function dataPut(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  if (!env.DATA) throw new HttpError(404, "not_found");
  const auth = req.headers.get("authorization") ?? "";
  const claims = auth.startsWith("Bearer ") ? await verifyGitHubOidc(auth.slice(7)) : null;
  if (!claims) throw new HttpError(401, "bad_token");
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!KEYS.some((re) => re.test(key))) throw new HttpError(400, "bad_key");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new HttpError(413, "too_big");
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new HttpError(413, "too_big");
  const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
  let previous: string | null = null;
  if (key === "graph/v1/index.json") previous = await checkGraphIndex(env, bytes);
  const had = await env.DATA.head(key);
  if (had && had.customMetadata?.sha256 === sha) return json({ key, same: true });
  const type = key.endsWith(".json") ? "application/json" : "application/octet-stream";
  await env.DATA.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { sha256: sha, run: claims.run_id, sha: claims.sha.slice(0, 12) } });
  console.log(JSON.stringify({ event: "data_put", key, bytes: bytes.byteLength, workflow: claims.workflow, run: claims.run_id }));
  if (key === "graph/v1/index.json") {
    indexMemo = null;
    const ix = JSON.parse(new TextDecoder().decode(bytes)) as { build: string };
    const sweep = dropOldBuilds(env, [ix.build, previous].filter((b): b is string => !!b));
    if (ctx) ctx.waitUntil(sweep); else await sweep;
  }
  return json({ key, bytes: bytes.byteLength }, 201);
}

/** A new graph index goes live only when every tile it lists is already in R2 under its build (409 otherwise), so a
 *  phone never reads an index whose tiles aren't there. Returns the build it replaces. */
async function checkGraphIndex(env: Env, bytes: ArrayBuffer): Promise<string | null> {
  let ix: { build?: unknown; tiles?: Record<string, unknown> };
  try { ix = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, "bad_index"); }
  if (typeof ix.build !== "string" || !BUILD.test(ix.build) || !ix.tiles || typeof ix.tiles !== "object") throw new HttpError(400, "bad_index");
  const want = Object.keys(ix.tiles), have = new Set<string>();
  const prefix = `graph/v1/b/${ix.build}/`;
  let cursor: string | undefined;
  do {
    const l = await env.DATA!.list({ prefix, cursor, limit: 1000 });
    for (const o of l.objects) have.add(o.key.slice(prefix.length, -4));
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  const missing = want.filter((t) => !have.has(t));
  if (missing.length) throw new HttpError(409, `tiles_missing:${missing.length}`);
  try {
    const cur = await env.DATA!.get("graph/v1/index.json");
    const b = cur ? (JSON.parse(await cur.text()) as { build?: unknown }).build : null;
    return typeof b === "string" && b !== ix.build ? b : null;
  } catch { return null; }
}

/** Deletes every build's tiles but `keep` (the new live build and the one it replaced). */
async function dropOldBuilds(env: Env, keep: string[]): Promise<void> {
  try {
    const builds = new Set<string>();
    let cursor: string | undefined;
    do {
      const l = await env.DATA!.list({ prefix: "graph/v1/b/", delimiter: "/", cursor });
      for (const p of l.delimitedPrefixes) builds.add(p.slice("graph/v1/b/".length, -1));
      cursor = l.truncated ? l.cursor : undefined;
    } while (cursor);
    for (const b of builds) {
      if (keep.slice(0, KEEP_BUILDS).includes(b)) continue;
      // each page is deleted before the next list, so it always lists from the start
      for (let more = true; more;) {
        const l = await env.DATA!.list({ prefix: `graph/v1/b/${b}/`, limit: 1000 });
        if (l.objects.length) await env.DATA!.delete(l.objects.map((o) => o.key));
        more = l.truncated && l.objects.length > 0;
      }
      console.log(JSON.stringify({ event: "data_build_dropped", build: b }));
    }
  } catch (err) {
    console.error("data_sweep", err);   // the next index upload tries again
  }
}
