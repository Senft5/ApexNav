// Block and report on every social surface, and the owner's queue of reports (docs/BACKEND.md section 6, IDEAS S-16).
// A report never tells the reported person who sent it. Three different reporters take a public crew out of "Crews near you"
// and a car out of friends' garages until the owner looks; the owner can dismiss the reports or act on them.
import type { Viewer } from "./auth";
import { Env, HANDLE_RE, HttpError, body, str } from "./util";
import { convoysRecheck } from "./convoy";
import { removePair } from "./social";

export const HIDE_AFTER_REPORTS = 3;
const REPORTS_PER_DAY = 20;
const KINDS = ["user", "crew", "car", "highlight"] as const;
type Kind = typeof KINDS[number];
const REASONS = ["spam", "abuse", "impersonation", "unsafe", "other"] as const;
const UNSAFE_RE = /(?!\u200d)[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u2028\u2029]/u;

const first = <T>(env: Env, sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<T>();
const all = async <T>(env: Env, sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;

/** SQL that is true when a target has reports from at least HIDE_AFTER_REPORTS different people. */
export const reportedSql = (kind: Kind, idExpr: string) =>
  `(SELECT COUNT(DISTINCT reporter) FROM reports WHERE kind = '${kind}' AND target_id = ${idExpr}) >= ${HIDE_AFTER_REPORTS}`;

const isOwner = (env: Env, v: Viewer) => !!env.OWNER_EMAIL && v.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase();
export const isModerator = isOwner;

async function userByHandle(env: Env, handle: unknown): Promise<string | null> {
  const h = str(handle, "handle", 3, 20).toLowerCase();
  if (!HANDLE_RE.test(h)) throw new HttpError(400, "bad_handle");
  return (await first<{ id: string }>(env, "SELECT id FROM users WHERE handle = ?", h))?.id ?? null;
}

// ---- blocks --------------------------------------------------------------------------------------
/** Block by user id (friends list) or by handle (crew members, convoys). Unknown handles answer the same as real ones. */
export async function block(env: Env, v: Viewer, req: Request): Promise<void> {
  const b = await body<{ user_id?: unknown; handle?: unknown }>(req);
  const other = b.handle !== undefined ? await userByHandle(env, b.handle) : str(b.user_id, "user_id", 1, 64);
  if (other === v.id) throw new HttpError(400, "bad_user_id");
  if (!other) return;
  await doBlock(env, v.id, other);
}

async function doBlock(env: Env, me: string, other: string): Promise<void> {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO blocks (blocker, blocked) SELECT ?1, id FROM users WHERE id = ?2").bind(me, other).run();
  if (!r.meta.changes && !(await first(env, "SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?", me, other))) return;   // no such user
  await removePair(env, me, other);
  await convoysRecheck(env, me);                                     // a convoy the two share drops one of them now
}

/** The people you blocked, by handle, so you can undo it. Nothing about who blocked you. */
export async function blockList(env: Env, v: Viewer) {
  return all<{ handle: string | null; name: string | null }>(env,
    `SELECT u.handle, u.display_name AS name FROM blocks b JOIN users u ON u.id = b.blocked WHERE b.blocker = ? ORDER BY u.handle`, v.id);
}

/** Unblocking restores nothing by itself: friendships, shares and grants removed by the block stay removed. */
export async function unblock(env: Env, v: Viewer, handle: string): Promise<void> {
  const other = await userByHandle(env, handle);
  if (other) await env.DB.prepare("DELETE FROM blocks WHERE blocker = ? AND blocked = ?").bind(v.id, other).run();
}

// ---- reports -------------------------------------------------------------------------------------
interface ReportBody { kind?: unknown; target?: unknown; reason?: unknown; note?: unknown; block?: unknown }

/** Resolves what is being reported to a stored target id, and the person behind it (for "also block"). Answers 404 for
 *  anything the reporter couldn't have seen, so reports can't be used to probe for private crews or cars. */
async function resolveTarget(env: Env, v: Viewer, kind: Kind, target: unknown): Promise<{ id: string; person: string | null } | null> {
  if (kind === "user") {
    const id = await userByHandle(env, target);
    return id && id !== v.id ? { id, person: id } : null;            // an unknown handle answers like a real one
  }
  const id = str(target, "target", 1, 64);
  if (kind === "crew") {
    const c = await first<{ owner: string }>(env,
      `SELECT owner FROM crews c WHERE id = ?1 AND (visibility = 'public' OR EXISTS (SELECT 1 FROM crew_members m WHERE m.crew_id = c.id AND m.user_id = ?2))`, id, v.id);
    if (!c) throw new HttpError(404, "no_crew");
    return { id, person: c.owner };
  }
  if (kind === "car") {
    const c = await first<{ owner: string }>(env, "SELECT owner FROM cars WHERE id = ? AND shared = 1 AND owner != ?", id, v.id);
    if (!c) throw new HttpError(404, "no_car");
    return { id, person: c.owner };
  }
  const h = await first<{ author_id: string }>(env, "SELECT author_id FROM highlights WHERE id = ?", id);
  if (!h) throw new HttpError(404, "no_highlight");
  return { id, person: h.author_id };
}

export async function report(env: Env, v: Viewer, req: Request): Promise<void> {
  const b = await body<ReportBody>(req);
  if (!b || typeof b !== "object") throw new HttpError(400, "bad_json");
  const kind = KINDS.find((k) => k === b.kind);
  if (!kind) throw new HttpError(400, "bad_kind");
  const reason = REASONS.find((r) => r === b.reason);
  if (!reason) throw new HttpError(400, "bad_reason");
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null && b.note !== "") {
    if (typeof b.note !== "string" || UNSAFE_RE.test(b.note.replace(/\r?\n/g, ""))) throw new HttpError(400, "bad_note");
    note = b.note.trim().slice(0, 280) || null;
  }
  if (b.block !== undefined && typeof b.block !== "boolean") throw new HttpError(400, "bad_block");
  const t = await resolveTarget(env, v, kind, b.target);
  if (t) {
    const today = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND created_at > datetime('now', '-1 day')", v.id);
    if ((today?.n ?? 0) >= REPORTS_PER_DAY) throw new HttpError(429, "too_many_reports");
    // one report per person per target; a second one updates the reason and note
    const text = `[${reason}]${note ? " " + note : ""}`;
    const upd = await env.DB.prepare("UPDATE reports SET note = ? WHERE reporter = ? AND kind = ? AND target_id = ?").bind(text, v.id, kind, t.id).run();
    if (!upd.meta.changes) {
      await env.DB.prepare("INSERT INTO reports (id, reporter, kind, target_id, note) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), v.id, kind, t.id, text).run();
    }
    if (kind === "highlight") {
      await env.DB.prepare(`UPDATE highlights SET status = 'hidden' WHERE id = ?1 AND ${reportedSql("highlight", "?1")}`).bind(t.id).run();
    }
    if (b.block === true && t.person && t.person !== v.id) await doBlock(env, v.id, t.person);
  }
}

// ---- the owner's queue ---------------------------------------------------------------------------
export async function moderationQueue(env: Env, v: Viewer) {
  if (!isOwner(env, v)) throw new HttpError(404, "not_found");
  const rows = await all<{ kind: Kind; target_id: string; reporters: number; latest: string; notes: string }>(env,
    `SELECT kind, target_id, COUNT(DISTINCT reporter) AS reporters, MAX(created_at) AS latest, GROUP_CONCAT(COALESCE(note, ''), char(10)) AS notes
       FROM reports GROUP BY kind, target_id ORDER BY reporters DESC, latest DESC LIMIT 100`);
  const out = [];
  for (const r of rows) {
    let label: string | null = null;
    if (r.kind === "user") label = (await first<{ handle: string | null }>(env, "SELECT handle FROM users WHERE id = ?", r.target_id))?.handle ?? null;
    else if (r.kind === "crew") label = (await first<{ name: string }>(env, "SELECT name FROM crews WHERE id = ?", r.target_id))?.name ?? null;
    else if (r.kind === "car") {
      const c = await first<{ make: string; model: string; nickname: string | null; handle: string | null }>(env,
        "SELECT c.make, c.model, c.nickname, u.handle FROM cars c JOIN users u ON u.id = c.owner WHERE c.id = ?", r.target_id);
      label = c ? `${c.make} ${c.model}${c.nickname ? ` "${c.nickname}"` : ""} · @${c.handle ?? "?"}` : null;
    } else label = (await first<{ name: string }>(env, "SELECT name FROM highlights WHERE id = ?", r.target_id))?.name ?? null;
    out.push({ kind: r.kind, target: r.target_id, label, gone: label === null, reporters: r.reporters, latest: r.latest,
               notes: r.notes.split("\n").filter(Boolean).slice(0, 10), hidden: r.reporters >= HIDE_AFTER_REPORTS });
  }
  return out;
}

/** dismiss: the reports go and anything they hid comes back. remove: a crew stops being public, a car stops being shown,
 *  a highlight is hidden, a person loses membership and is signed out everywhere (they keep their account and can sign in to export or delete it). */
export async function moderationResolve(env: Env, v: Viewer, req: Request): Promise<void> {
  if (!isOwner(env, v)) throw new HttpError(404, "not_found");
  const b = await body<{ kind?: unknown; target?: unknown; action?: unknown }>(req);
  const kind = KINDS.find((k) => k === b.kind);
  if (!kind) throw new HttpError(400, "bad_kind");
  const id = str(b.target, "target", 1, 64);
  if (b.action !== "dismiss" && b.action !== "remove") throw new HttpError(400, "bad_action");
  const clear = env.DB.prepare("DELETE FROM reports WHERE kind = ? AND target_id = ?").bind(kind, id);
  if (b.action === "dismiss") {
    await env.DB.batch([clear, ...(kind === "highlight" ? [env.DB.prepare("UPDATE highlights SET status = 'active' WHERE id = ? AND status = 'hidden'").bind(id)] : [])]);
    return;
  }
  if (kind === "user" && id === v.id) throw new HttpError(400, "bad_target");
  const act = {
    user: env.DB.prepare("DELETE FROM members WHERE user_id = ?").bind(id),
    crew: env.DB.prepare("UPDATE crews SET visibility = 'private' WHERE id = ?").bind(id),
    car: env.DB.prepare("UPDATE cars SET shared = 0 WHERE id = ?").bind(id),
    highlight: env.DB.prepare("UPDATE highlights SET status = 'hidden' WHERE id = ?").bind(id),
  }[kind];
  await env.DB.batch([act, clear, ...(kind === "user" ? [env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id)] : [])]);
  if (kind === "user") await convoysRecheck(env, id);
}
