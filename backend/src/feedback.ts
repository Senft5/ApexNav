// Feedback (IDEAS L-05, web/feedback.js): Settings → Send feedback. Anyone may send it (signed out too; the global write limit
// applies per IP). Kept as typed (only the owner reads it), with diagnostics only when attached: a fixed set of fields,
// validated here, never a place or a drive. A handle is stored only when the person asked for a reply and is signed in.
// Owner: GET /api/ops/feedback, POST /api/ops/feedback/:id/done.
import { Env, HttpError, body, str } from "./util";
import type { Viewer } from "./auth";

const KINDS = new Set(["bug", "idea", "other"]);
export const DAY_CAP = 300, KEEP_DAYS = 180, MAX_MESSAGE = 2000;

/** Diagnostics as stored: only these keys, short strings or small whole numbers. Null when none or not an object. */
export function cleanDiag(d: unknown): Record<string, string | number> | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const src = d as Record<string, unknown>, out: Record<string, string | number> = {};
  for (const k of ["version", "build", "platform", "screen", "lang", "voice", "page"]) {
    const v = src[k];
    if (typeof v === "string" && v.length && v.length <= 80) out[k] = v;
  }
  for (const k of ["errors_today", "drives", "offline"]) {
    const v = src[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1_000_000) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export async function feedbackCreate(req: Request, env: Env, v: Viewer | null): Promise<{ id: number }> {
  const b = await body<{ kind?: unknown; message?: unknown; app?: unknown; diag?: unknown; reply?: unknown }>(req);
  if (typeof b.kind !== "string" || !KINDS.has(b.kind)) throw new HttpError(400, "bad_kind");
  if (b.app !== "ios" && b.app !== "web") throw new HttpError(400, "bad_app");
  const message = str(b.message, "message", 1, MAX_MESSAGE * 2).trim().slice(0, MAX_MESSAGE);
  if (!message) throw new HttpError(400, "bad_message");
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE created_at >= date('now')").first<{ n: number }>();
  if ((today?.n ?? 0) >= DAY_CAP) throw new HttpError(429, "busy");
  const diag = cleanDiag(b.diag);
  const handle = b.reply === true && v && v.handle ? v.handle : null;
  const r = await env.DB.prepare("INSERT INTO feedback (kind, message, app, diag, handle) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(b.kind, message, b.app, diag ? JSON.stringify(diag) : null, handle).first<{ id: number }>();
  return { id: r!.id };
}

/** Open feedback first, newest first; at most 100. */
export async function feedbackList(env: Env) {
  const rows = (await env.DB.prepare(
    "SELECT id, created_at, kind, message, app, diag, handle, done FROM feedback ORDER BY done, id DESC LIMIT 100")
    .all<{ id: number; created_at: string; kind: string; message: string; app: string; diag: string | null; handle: string | null; done: number }>()).results;
  return rows.map((r) => ({ ...r, diag: r.diag ? JSON.parse(r.diag) : null, done: !!r.done }));
}

export async function feedbackDone(env: Env, id: string): Promise<void> {
  if (!/^\d{1,12}$/.test(id)) throw new HttpError(404, "not_found");
  const r = await env.DB.prepare("UPDATE feedback SET done = 1 WHERE id = ?").bind(Number(id)).run();
  if (!r.meta.changes) throw new HttpError(404, "not_found");
}

export const FEEDBACK_SWEEP = `DELETE FROM feedback WHERE created_at < datetime('now', '-${KEEP_DAYS} days')`;
