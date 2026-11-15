// Developers' drives (the owner, 2026-11-15: "just automatically send all of my and my codevs drives for internal use"):
// the app (web/dev_drives.js) uploads every drive recorded on a developer's phone (src/developers.ts: the owner and the
// fingerprinted co-developer), so the replay, the drive page and the analysis can be reviewed on real roads. Nobody else's
// drive is ever taken: the upload answers 404 to anyone /api/me does not call a developer. The files sit in their own
// private R2 bucket (DEV_DRIVES, apexnav-devdrives), key <user id>/<drive id>.json.gz, as the phone gzipped them; never
// in D1, never in the repo. Read back only with the internal read key (its sha256 is DEV_DRIVES_READ_HASH; the key is
// in the owner's private project files, dev-drives/READ_KEY.txt) or by a developer's own session.
import type { Viewer } from "./auth";
import { isDeveloper } from "./developers";
import { Env, HttpError, sha256hex } from "./util";

export const DEV_DRIVES_READ_HASH = "a9f3ed5a74d88fc117d500603a3184e1cf3c02ca1014cb04f19dc04ee28c8f4e";
export const MAX_BYTES = 20_000_000;           // a long day's drive gzipped is a few MB
const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.:-]{1,100}\.json\.gz$/;

const bucket = (env: Env) => { if (!env.DEV_DRIVES) throw new HttpError(503, "no_store"); return env.DEV_DRIVES; };

/** POST /api/dev/drives/:id: a developer's drive, gzipped JSON (the record as the phone keeps it). */
export async function devDrivePut(env: Env, v: Viewer, id: string, req: Request): Promise<{ key: string; bytes: number }> {
  if (!(await isDeveloper(env, v))) throw new HttpError(404, "not_found");
  const b = bucket(env);
  if (!ID_RE.test(id)) throw new HttpError(400, "bad_id");
  if (Number(req.headers.get("content-length") || "0") > MAX_BYTES) throw new HttpError(413, "too_big");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new HttpError(413, "too_big");
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new HttpError(415, "not_gzip");
  const key = `${v.id}/${id}.json.gz`;
  await b.put(key, bytes, { httpMetadata: { contentType: "application/gzip" }, customMetadata: { handle: v.handle || "" } });
  return { key, bytes: bytes.length };
}

/** The internal read key, or a developer's own session. */
async function mayRead(env: Env, req: Request, v: Viewer | null): Promise<boolean> {
  const a = req.headers.get("authorization") || "";
  const m = /^Bearer (.{20,200})$/.exec(a);
  if (m && (await sha256hex(m[1])) === (env.DEV_DRIVES_READ_HASH || DEV_DRIVES_READ_HASH)) return true;
  return !!v && (await isDeveloper(env, v));
}

/** GET /api/dev/drives: every kept drive's key, size and upload time. */
export async function devDriveList(env: Env, req: Request, v: Viewer | null) {
  if (!(await mayRead(env, req, v))) throw new HttpError(404, "not_found");
  const b = bucket(env), out: { key: string; bytes: number; uploaded: string; handle: string | null }[] = [];
  let cursor: string | undefined;
  do {
    const r = await b.list({ cursor, include: ["customMetadata"] });
    for (const o of r.objects) out.push({ key: o.key, bytes: o.size, uploaded: o.uploaded.toISOString(), handle: o.customMetadata?.handle || null });
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return { drives: out };
}

/** GET /api/dev/drives/file?key=: one drive's gzipped bytes. */
export async function devDriveGet(env: Env, req: Request, v: Viewer | null): Promise<Response> {
  if (!(await mayRead(env, req, v))) throw new HttpError(404, "not_found");
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!KEY_RE.test(key)) throw new HttpError(400, "bad_key");
  const o = await bucket(env).get(key);
  if (!o) throw new HttpError(404, "no_drive");
  return new Response(o.body, { headers: { "content-type": "application/gzip", "content-length": String(o.size), "cache-control": "no-store" } });
}

/** Every drive a developer uploaded goes with their account. */
export async function devDrivesErase(env: Env, userId: string): Promise<void> {
  if (!env.DEV_DRIVES) return;
  let cursor: string | undefined;
  do {
    const r = await env.DEV_DRIVES.list({ prefix: `${userId}/`, cursor });
    if (r.objects.length) await env.DEV_DRIVES.delete(r.objects.map((o) => o.key));
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
}
