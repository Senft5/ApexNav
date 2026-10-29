// Photos (docs/design/REVIEW.md 5.2): a profile photo, a car's cover and gallery, a crew's cover and crest, and the photos
// on build-thread posts. JPEG only; the phone re-encodes before sending (which drops EXIF), and the server strips every
// metadata segment again (APP1-APP15, comments), so a photo never carries where it was taken. The bytes live in KV
// (PHOTOS), the row in D1. Members only, both ways. One report hides a photo for 24 hours while the owner looks; three
// from different people (reports_sql.ts) or the owner's remove keep it down.
import type { Viewer } from "./auth";
import { Env, HttpError } from "./util";
import { removedSql, reportedSql } from "./reports_sql";
import { atLeast, tierOf } from "./livery";

export const MAX_BYTES = 700_000, MAX_SIDE = 2400, MAX_PER_OWNER = 300, MAX_PER_REF = 12;
export const KINDS = ["profile", "car", "crew", "crest", "post"] as const;
type Kind = typeof KINDS[number];

/** A report hides a photo at once, for a day, until the owner looks (REVIEW.md 5.2); removed or widely reported stays down. */
export const photoHiddenSql = (idExpr: string) =>
  `(${reportedSql("photo", idExpr)} OR EXISTS (SELECT 1 FROM reports rh WHERE rh.kind = 'photo' AND rh.target_id = ${idExpr} AND rh.status = 'open' AND rh.created_at > datetime('now', '-1 day')))`;

/**
 * A JPEG with every metadata segment taken out, and its size: { bytes, w, h }. Throws 400 for anything that isn't a
 * baseline or progressive JPEG. Keeps SOI, APP0 (JFIF), DQT, SOFn, DHT, DRI and the scan; drops APP1-APP15 (EXIF, XMP,
 * ICC, Photoshop) and COM.
 */
export function stripJpeg(input: Uint8Array): { bytes: Uint8Array; w: number; h: number } {
  const b = input;
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new HttpError(400, "not_jpeg");
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2, w = 0, h = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new HttpError(400, "bad_jpeg");
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }                               // fill bytes
    if (m === 0xda) { out.push(b.subarray(i)); i = b.length; break; } // start of scan: the rest is image data and EOI
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) throw new HttpError(400, "bad_jpeg");
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) throw new HttpError(400, "bad_jpeg");
    const seg = b.subarray(i, i + 2 + len);
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      h = (b[i + 5] << 8) | b[i + 6]; w = (b[i + 7] << 8) | b[i + 8];
    }
    const meta = (m >= 0xe1 && m <= 0xef) || m === 0xfe;             // APP1..APP15, COM
    if (!meta) out.push(seg);
    i += 2 + len;
  }
  if (!w || !h) throw new HttpError(400, "bad_jpeg");
  if (w > MAX_SIDE || h > MAX_SIDE) throw new HttpError(400, "too_big");
  const total = out.reduce((n, s) => n + s.length, 0), bytes = new Uint8Array(total);
  let o = 0;
  for (const s of out) { bytes.set(s, o); o += s.length; }
  return { bytes, w, h };
}

/** May this person attach a photo of this kind to this thing? Its owner (a car, a post), a crew's owner (cover, crest). */
async function canAttach(env: Env, v: Viewer, kind: Kind, ref: string | null): Promise<boolean> {
  if (kind === "profile") return ref === null;
  if (!ref) return false;
  if (kind === "car") return !!(await env.DB.prepare("SELECT 1 FROM cars WHERE id = ? AND owner = ?").bind(ref, v.id).first());
  if (kind === "crew" || kind === "crest") {
    if (!(await env.DB.prepare("SELECT 1 FROM crews WHERE id = ? AND owner = ?").bind(ref, v.id).first())) return false;
    return kind === "crew" || atLeast(await tierOf(env, ref), "club");     // a crest of your own is the Club livery (REVIEW.md 5.1)
  }
  if (kind === "post") return !!(await env.DB.prepare("SELECT 1 FROM build_posts p JOIN builds b ON b.id = p.build_id WHERE p.id = ? AND b.owner = ?").bind(ref, v.id).first());
  return false;
}

/** POST /api/photos?kind=car&ref=<id>[&cover=1]: the body is the JPEG. Sets the profile photo, a car's cover or a crew's
 *  cover or crest when asked. Answers { id }. */
export async function photoUpload(env: Env, v: Viewer, req: Request): Promise<{ id: string; w: number; h: number }> {
  if (!env.PHOTOS) throw new HttpError(503, "photos_off");
  const u = new URL(req.url), kind = KINDS.find((k) => k === u.searchParams.get("kind"));
  if (!kind) throw new HttpError(400, "bad_kind");
  const ref = u.searchParams.get("ref") || null;
  if (ref !== null && (ref.length > 64 || !/^[A-Za-z0-9_-]+$/.test(ref))) throw new HttpError(400, "bad_ref");
  if (!(req.headers.get("content-type") || "").startsWith("image/jpeg")) throw new HttpError(415, "jpeg_only");
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > MAX_BYTES) throw new HttpError(413, "too_big");
  const raw = new Uint8Array(await req.arrayBuffer());
  if (!raw.length || raw.length > MAX_BYTES) throw new HttpError(413, "too_big");
  if (!(await canAttach(env, v, kind, ref))) throw new HttpError(404, "no_ref");
  const { bytes, w, h } = stripJpeg(raw);
  const id = crypto.randomUUID();
  // the caps are checked by the insert itself, so parallel uploads can't pass them
  const ins = await env.DB.prepare(
    `INSERT INTO photos (id, owner, kind, ref_id, bytes, w, h) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
      WHERE (SELECT COUNT(*) FROM photos WHERE owner = ?2) < ?8
        AND (?4 IS NULL OR (SELECT COUNT(*) FROM photos WHERE kind = ?3 AND ref_id = ?4) < ?9)`,
  ).bind(id, v.id, kind, ref, bytes.length, w, h, MAX_PER_OWNER, MAX_PER_REF).run();
  if (!ins.meta.changes) throw new HttpError(429, "too_many_photos");
  await env.PHOTOS.put(`p/${id}`, bytes);
  const cover = u.searchParams.get("cover") === "1";
  if (kind === "profile") await env.DB.prepare("UPDATE users SET photo_id = ? WHERE id = ?").bind(id, v.id).run();
  else if (kind === "car" && cover) await env.DB.prepare("UPDATE cars SET cover_photo_id = ? WHERE id = ? AND owner = ?").bind(id, ref, v.id).run();
  else if (kind === "crew") await env.DB.prepare("UPDATE crews SET cover_photo_id = ? WHERE id = ? AND owner = ?").bind(id, ref, v.id).run();
  else if (kind === "crest") await env.DB.prepare("UPDATE crews SET crest_photo_id = ? WHERE id = ? AND owner = ?").bind(id, ref, v.id).run();
  return { id, w, h };
}

/** PUT /api/photos/:id/use: make one of your photos the thing it belongs to's face: your profile photo, its car's cover,
 *  its crew's cover or crest. */
export async function photoUse(env: Env, v: Viewer, id: string): Promise<void> {
  const p = await env.DB.prepare("SELECT kind, ref_id FROM photos WHERE id = ? AND owner = ?").bind(id, v.id).first<{ kind: Kind; ref_id: string | null }>();
  if (!p) throw new HttpError(404, "no_photo");
  const set = {
    profile: ["UPDATE users SET photo_id = ?1 WHERE id = ?2", null],
    car: ["UPDATE cars SET cover_photo_id = ?1 WHERE owner = ?2 AND id = ?3", p.ref_id],
    crew: ["UPDATE crews SET cover_photo_id = ?1 WHERE owner = ?2 AND id = ?3", p.ref_id],
    crest: ["UPDATE crews SET crest_photo_id = ?1 WHERE owner = ?2 AND id = ?3", p.ref_id],
    post: null,
  }[p.kind];
  if (!set) throw new HttpError(400, "bad_kind");
  const [sql, ref] = set;
  await (ref === null ? env.DB.prepare(sql as string).bind(id, v.id) : env.DB.prepare(sql as string).bind(id, v.id, ref)).run();
}

/** GET /api/photos/:id: the JPEG, to members, unless it is hidden (your own you always see). */
export async function photoServe(env: Env, v: Viewer, id: string): Promise<Response> {
  if (!env.PHOTOS) throw new HttpError(404, "no_photo");
  const row = await env.DB.prepare(`SELECT owner, ${photoHiddenSql("p.id")} AS hidden FROM photos p WHERE p.id = ?`).bind(id).first<{ owner: string; hidden: number }>();
  if (!row || (row.hidden && row.owner !== v.id)) throw new HttpError(404, "no_photo");
  const blocked = row.owner !== v.id && await env.DB.prepare("SELECT 1 FROM blocks WHERE (blocker = ?1 AND blocked = ?2) OR (blocker = ?2 AND blocked = ?1)").bind(v.id, row.owner).first();
  if (blocked) throw new HttpError(404, "no_photo");
  const bytes = await env.PHOTOS.get(`p/${id}`, "arrayBuffer");
  if (!bytes) throw new HttpError(404, "no_photo");
  return new Response(bytes, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'" } });
}

/** GET /api/photos?kind=car&ref=<id>: the gallery's photo ids, newest first, hidden ones left out (yours kept). */
export async function photoList(env: Env, v: Viewer, url: URL) {
  const kind = KINDS.find((k) => k === url.searchParams.get("kind")), ref = url.searchParams.get("ref");
  if (!kind || !ref) throw new HttpError(400, "bad_ref");
  return (await env.DB.prepare(`SELECT p.id, p.w, p.h, p.owner = ?3 AS mine FROM photos p WHERE p.kind = ?1 AND p.ref_id = ?2
      AND (p.owner = ?3 OR NOT ${photoHiddenSql("p.id")}) ORDER BY p.created_at DESC, p.rowid DESC LIMIT ${MAX_PER_REF}`)
    .bind(kind, ref, v.id).all()).results;
}

/** DELETE /api/photos/:id: the owner takes it down; covers and the profile photo that pointed at it are cleared. */
export async function photoDelete(env: Env, v: Viewer, id: string): Promise<void> {
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE users SET photo_id = NULL WHERE id = ? AND photo_id = ?").bind(v.id, id),
    env.DB.prepare("UPDATE cars SET cover_photo_id = NULL WHERE owner = ? AND cover_photo_id = ?").bind(v.id, id),
    env.DB.prepare("UPDATE crews SET cover_photo_id = NULL WHERE owner = ? AND cover_photo_id = ?").bind(v.id, id),
    env.DB.prepare("UPDATE crews SET crest_photo_id = NULL WHERE owner = ? AND crest_photo_id = ?").bind(v.id, id),
    env.DB.prepare("DELETE FROM photos WHERE id = ? AND owner = ?").bind(id, v.id),
  ]);
  if (!res[res.length - 1].meta.changes) throw new HttpError(404, "no_photo");
  if (env.PHOTOS) await env.PHOTOS.delete(`p/${id}`);
}

/** Every photo of a person, out of KV and D1 (account deletion, a ban). */
export async function photosEraseOwner(env: Env, owner: string): Promise<void> {
  const ids = (await env.DB.prepare("SELECT id FROM photos WHERE owner = ?").bind(owner).all<{ id: string }>()).results.map((r) => r.id);
  if (env.PHOTOS) for (const id of ids) await env.PHOTOS.delete(`p/${id}`);
  await env.DB.prepare("DELETE FROM photos WHERE owner = ?").bind(owner).run();
}
