// A clip or a photo on a drive post (docs/SOCIAL.md 2.13): the corner clip a drive's page makes (web/corner_clip.js, an 8 s
// portrait video with the call, speed and g burned in) or a photo from the phone. One per post, in R2 (MEDIA, key
// post/<post id>), never in D1 or KV. Seen by exactly who sees the post (POST_SEEN), gone with the post, its removal by the
// owner's queue, or the account. Without the MEDIA bucket a post is posted as before and its media answers 503.
import type { Viewer } from "./auth";
import { Env, HttpError } from "./util";
import { POST_SEEN } from "./drive_posts";

export const MEDIA_TYPES: Record<string, { kind: "clip" | "photo"; max: number }> = {
  "video/mp4": { kind: "clip", max: 8_000_000 },
  "video/webm": { kind: "clip", max: 8_000_000 },
  "image/jpeg": { kind: "photo", max: 3_000_000 },
};
const ID_RE = /^[A-Za-z0-9_-]{16}$/;
const key = (postId: string) => `post/${postId}`;
export type Media = { kind: "clip" | "photo"; mime: string; bytes: number; label: string | null };

export const mediaOf = (raw: string | null): Media | null => {
  if (!raw) return null;
  try { const m = JSON.parse(raw) as Media; return m && (m.kind === "clip" || m.kind === "photo") ? m : null; } catch (_) { return null; }
};

/** PUT /api/posts/:id/media?label=: the bytes of your post's clip or photo (replaces any before). → the post's media. */
export async function mediaPut(env: Env, v: Viewer, id: string, req: Request): Promise<Media> {
  if (!env.MEDIA) throw new HttpError(503, "no_media_store");
  if (!ID_RE.test(id)) throw new HttpError(404, "no_post");
  const mime = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const t = MEDIA_TYPES[mime];
  if (!t) throw new HttpError(415, "bad_media_type");
  if (Number(req.headers.get("content-length") || "0") > t.max) throw new HttpError(413, "too_big");
  const post = await env.DB.prepare("SELECT id FROM drive_posts WHERE id = ? AND author = ?").bind(id, v.id).first();
  if (!post) throw new HttpError(404, "no_post");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length || bytes.length > t.max) throw new HttpError(413, "too_big");
  if (!sniff(bytes, t.kind, mime)) throw new HttpError(415, "bad_media_type");
  const raw = new URL(req.url).searchParams.get("label");
  const label = raw ? raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) || null : null;
  await env.MEDIA.put(key(id), bytes, { httpMetadata: { contentType: mime } });
  const m: Media = { kind: t.kind, mime, bytes: bytes.length, label };
  await env.DB.prepare("UPDATE drive_posts SET media = ? WHERE id = ? AND author = ?").bind(JSON.stringify(m), id, v.id).run();
  return m;
}

/** What the bytes say they are: a JPEG starts FF D8 FF, an MP4 has `ftyp` at 4, a WebM starts with the EBML magic. */
function sniff(b: Uint8Array, kind: "clip" | "photo", mime: string): boolean {
  if (kind === "photo") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "video/webm") return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  return b.length > 8 && String.fromCharCode(b[4], b[5], b[6], b[7]) === "ftyp";
}

/** GET /api/posts/:id/media: the bytes, to whoever sees the post (and no one else: a post you can't see has no media). */
export async function mediaGet(env: Env, v: Viewer, id: string): Promise<Response> {
  if (!env.MEDIA) throw new HttpError(503, "no_media_store");
  if (!ID_RE.test(id)) throw new HttpError(404, "no_post");
  const r = await env.DB.prepare(`SELECT p.media FROM drive_posts p WHERE p.id = ?2 AND ${POST_SEEN("p")}`).bind(v.id, id).first<{ media: string | null }>();
  const m = mediaOf(r ? r.media : null);
  if (!m) throw new HttpError(404, "no_media");
  const o = await env.MEDIA.get(key(id));
  if (!o) throw new HttpError(404, "no_media");
  return new Response(o.body, { headers: { "content-type": m.mime, "content-length": String(o.size), "cache-control": "private, max-age=86400" } });
}

/** The bytes of these posts go (a post deleted, removed by the owner's queue, or its author's account deleted). */
export async function mediaErase(env: Env, postIds: string[]): Promise<void> {
  if (!env.MEDIA || !postIds.length) return;
  for (let i = 0; i < postIds.length; i += 1000) await env.MEDIA.delete(postIds.slice(i, i + 1000).map(key));
}

/** The posts of this author that carry media, before their rows go with the account. */
export async function mediaOfAuthor(env: Env, userId: string): Promise<string[]> {
  return (await env.DB.prepare("SELECT id FROM drive_posts WHERE author = ? AND media IS NOT NULL").bind(userId).all<{ id: string }>()).results.map((r) => r.id);
}
