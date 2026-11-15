// Anonymous drives (the owner, 2026-11-15; web/anon_drives.js): every phone with "Help improve Vetta roads" on (the default)
// sends an anonymous copy of each drive, made anonymous on the phone (no account, name, car or clock time, the first and
// last 1 to 1.5 km cut, nothing inside a privacy zone, a fresh random id per piece). Used to improve Vetta's roads and
// analysis, internally only. This route never asks who is calling: no session, user id, handle or IP is read or stored
// with a piece (the global write limit, src/ratelimit.ts, counts calls and keeps nothing). R2 bucket ANON_DRIVES
// (apexnav-anondrives), key <yyyy-mm-dd>/<random id>.json.gz. Read back only with the internal key (src/dev_drives.ts).
import { mayReadInternal } from "./dev_drives";
import { Env, HttpError } from "./util";

export const MAX_BYTES = 8_000_000;
const KEY_RE = /^\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}\.json\.gz$/;
const bucket = (env: Env) => { if (!env.ANON_DRIVES) throw new HttpError(503, "no_store"); return env.ANON_DRIVES; };
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

/** POST /api/anon/drives: one anonymous piece, gzipped JSON. The key is the server's own random id, never the phone's. */
export async function anonDrivePut(env: Env, req: Request): Promise<void> {
  const b = bucket(env);
  if (Number(req.headers.get("content-length") || "0") > MAX_BYTES) throw new HttpError(413, "too_big");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new HttpError(413, "too_big");
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new HttpError(415, "not_gzip");
  await b.put(`${new Date().toISOString().slice(0, 10)}/${hex(16)}.json.gz`, bytes, { httpMetadata: { contentType: "application/gzip" } });
}

/** GET /api/anon/drives?prefix=yyyy-mm(-dd): the pieces' keys and sizes (internal key only). */
export async function anonDriveList(env: Env, req: Request) {
  if (!(await mayReadInternal(env, req))) throw new HttpError(404, "not_found");
  const prefix = new URL(req.url).searchParams.get("prefix") || "";
  if (prefix && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(prefix)) throw new HttpError(400, "bad_prefix");
  const out: { key: string; bytes: number }[] = [];
  let cursor: string | undefined;
  do {
    const r = await bucket(env).list({ prefix: prefix || undefined, cursor });
    for (const o of r.objects) out.push({ key: o.key, bytes: o.size });
    cursor = r.truncated && out.length < 10000 ? r.cursor : undefined;
  } while (cursor);
  return { drives: out };
}

/** GET /api/anon/drives/file?key=: one piece's gzipped bytes (internal key only). */
export async function anonDriveGet(env: Env, req: Request): Promise<Response> {
  if (!(await mayReadInternal(env, req))) throw new HttpError(404, "not_found");
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!KEY_RE.test(key)) throw new HttpError(400, "bad_key");
  const o = await bucket(env).get(key);
  if (!o) throw new HttpError(404, "no_drive");
  return new Response(o.body, { headers: { "content-type": "application/gzip", "content-length": String(o.size), "cache-control": "no-store" } });
}
