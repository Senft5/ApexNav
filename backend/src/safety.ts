// Block and report on every social surface, and the owner's queue of reports (docs/BACKEND.md section 6, IDEAS S-16).
// A report never tells the reported person who sent it. Open reports from three people with different inviters take a public crew
// out of "Crews near you", a car out of friends' garages and a highlight off the map until the owner looks (reports_sql.ts).
// The owner dismisses (the reports close for good, so the same people can't re-trigger it) or removes (it stays down).
import type { Viewer } from "./auth";
import { Env, HANDLE_RE, HttpError, body, str } from "./util";
import { convoysLeaveAll, convoysRecheck } from "./convoy";
import { removePair } from "./social";
import { REPORT_KINDS, type ReportKind, reportedSql } from "./reports_sql";

const REPORTS_PER_DAY = 20;
const REASONS = ["spam", "abuse", "impersonation", "unsafe", "other"] as const;
const UNSAFE_RE = /(?!\u200d)[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u2028\u2029]/u;
/** Where an auto-hide actually hides something (a person or a private crew is only queued for the owner). */
const HIDES: Record<ReportKind, string | null> = {
  user: null, car: "1",
  crew: "(SELECT visibility FROM crews WHERE id = r.target_id) = 'public'",
  highlight: "1",
};

const first = <T>(env: Env, sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<T>();
const all = async <T>(env: Env, sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const object = <T>(b: unknown): T => { if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "bad_json"); return b as T; };

export const isModerator = (env: Env, v: Viewer) => !!env.OWNER_EMAIL && v.email.toLowerCase() === env.OWNER_EMAIL.trim().toLowerCase();

async function userByHandle(env: Env, handle: unknown): Promise<string | null> {
  const h = str(handle, "handle", 3, 20).toLowerCase();
  if (!HANDLE_RE.test(h)) throw new HttpError(400, "bad_handle");
  return (await first<{ id: string }>(env, "SELECT id FROM users WHERE handle = ?", h))?.id ?? null;
}

// ---- blocks --------------------------------------------------------------------------------------
/** Block by user id (friends list) or by handle (crew members, convoys). Unknown ones answer the same as real ones. */
export async function block(env: Env, v: Viewer, req: Request): Promise<void> {
  const b = object<{ user_id?: unknown; handle?: unknown }>(await body(req));
  const other = b.handle !== undefined ? await userByHandle(env, b.handle) : str(b.user_id, "user_id", 1, 64);
  if (other === v.id) throw new HttpError(400, "bad_user_id");
  if (other) await doBlock(env, v.id, other);
}

async function doBlock(env: Env, me: string, other: string): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO blocks (blocker, blocked) SELECT ?1, id FROM users WHERE id = ?2").bind(me, other).run();
  if (!(await first(env, "SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?", me, other))) return;   // no such user
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
export interface ReportBody { kind?: unknown; target?: unknown; reason?: unknown; note?: unknown; block?: unknown }

/** Resolves what is being reported to a stored target id, and the person behind it (for "also block"). Answers 404 for
 *  anything the reporter couldn't have seen, so reports can't be used to probe for private crews or cars. */
async function resolveTarget(env: Env, v: Viewer, kind: ReportKind, target: unknown): Promise<{ id: string; person: string | null } | null> {
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
  if (kind === "car") {   // the same audience as GET /api/garage/people
    const c = await first<{ owner: string }>(env,
      `SELECT c.owner FROM cars c WHERE c.id = ?1 AND c.shared = 1 AND c.owner != ?2
          AND ( EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND f.user_a = MIN(c.owner, ?2) AND f.user_b = MAX(c.owner, ?2))
             OR EXISTS (SELECT 1 FROM crew_members a JOIN crews cr ON cr.id = a.crew_id AND cr.visibility = 'private'
                          JOIN crew_members b ON b.crew_id = a.crew_id WHERE a.user_id = ?2 AND b.user_id = c.owner) )
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker = ?2 AND b.blocked = c.owner) OR (b.blocker = c.owner AND b.blocked = ?2))`, id, v.id);
    if (!c) throw new HttpError(404, "no_car");
    return { id, person: c.owner };
  }
  const h = await first<{ author_id: string | null }>(env, "SELECT author_id FROM highlights WHERE id = ? AND status = 'active'", id);
  if (!h) throw new HttpError(404, "no_highlight");
  return { id, person: h.author_id };
}

export async function report(env: Env, v: Viewer, req: Request): Promise<void> {
  await fileReport(env, v, object<ReportBody>(await body(req)));
}

/** Also used by the older POST /api/highlights/:id/report. */
export async function fileReport(env: Env, v: Viewer, b: ReportBody): Promise<void> {
  const kind = REPORT_KINDS.find((k) => k === b.kind);
  if (!kind) throw new HttpError(400, "bad_kind");
  const reason = REASONS.find((r) => r === b.reason);
  if (!reason) throw new HttpError(400, "bad_reason");
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null && b.note !== "") {
    if (typeof b.note !== "string") throw new HttpError(400, "bad_note");
    const flat = b.note.replace(/\s*\r?\n\s*/g, " ").trim();          // one line per report, so the owner's queue can't be padded
    if (UNSAFE_RE.test(flat)) throw new HttpError(400, "bad_note");
    note = Array.from(flat).slice(0, 280).join("") || null;
  }
  if (b.block !== undefined && typeof b.block !== "boolean") throw new HttpError(400, "bad_block");
  // The cap is checked before looking anything up, so it can't tell a real handle from an unknown one.
  const today = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND created_at > datetime('now', '-1 day')", v.id);
  if ((today?.n ?? 0) >= REPORTS_PER_DAY) throw new HttpError(429, "too_many_reports");
  const t = await resolveTarget(env, v, kind, b.target);
  if (!t) return;
  // One report per person per target (a second one updates an open one); the cap is checked again inside the insert.
  await env.DB.prepare(
    `INSERT INTO reports (id, reporter, kind, target_id, note) SELECT ?1, ?2, ?3, ?4, ?5
      WHERE (SELECT COUNT(*) FROM reports WHERE reporter = ?2 AND created_at > datetime('now', '-1 day')) < ?6
     ON CONFLICT (reporter, kind, target_id) DO UPDATE SET note = excluded.note, created_at = datetime('now') WHERE status = 'open'`,
  ).bind(crypto.randomUUID(), v.id, kind, t.id, `[${reason}]${note ? " " + note : ""}`, REPORTS_PER_DAY).run();
  if (kind === "highlight") {
    await env.DB.prepare(`UPDATE highlights SET status = 'hidden' WHERE id = ?1 AND ${reportedSql("highlight", "?1")}`).bind(t.id).run();
  }
  if (b.block === true && t.person && t.person !== v.id) await doBlock(env, v.id, t.person);
}

// ---- the owner's queue ---------------------------------------------------------------------------
/** Open reports by target: what it is, who reported it (and who invited them, to spot one person's spare accounts), what they said. */
export async function moderationQueue(env: Env, v: Viewer) {
  if (!isModerator(env, v)) throw new HttpError(404, "not_found");
  const rows = await all<{ kind: ReportKind; target_id: string; reporters: number; latest: string; notes: string; who: string; hidden: number }>(env,
    `SELECT r.kind, r.target_id, COUNT(*) AS reporters, MAX(r.created_at) AS latest,
            json_group_array(COALESCE(r.note, '')) AS notes,
            json_group_array('@' || COALESCE(u.handle, '?') || COALESCE(' (invited by @' || iu.handle || ')', '')) AS who,
            CASE r.kind ${REPORT_KINDS.map((k) => `WHEN '${k}' THEN ${HIDES[k] ? `(${HIDES[k]}) AND ${reportedSql(k, "r.target_id")}` : "0"}`).join(" ")} END AS hidden
       FROM reports r LEFT JOIN users u ON u.id = r.reporter LEFT JOIN members m ON m.user_id = r.reporter LEFT JOIN users iu ON iu.id = m.invited_by
      WHERE r.status = 'open' GROUP BY r.kind, r.target_id ORDER BY reporters DESC, latest DESC LIMIT 100`);
  // labels: one query per kind
  const labels = new Map<string, string>();
  const each = async (k: ReportKind, sql: (marks: string) => string, label: (r: Record<string, any>) => string) => {
    const list = rows.filter((r) => r.kind === k).map((r) => r.target_id);
    if (!list.length) return;
    for (const r of await all<Record<string, any>>(env, sql(list.map(() => "?").join(",")), ...list)) labels.set(`${k}:${r.id}`, label(r));
  };
  await each("user", (q) => `SELECT id, handle FROM users WHERE id IN (${q})`, (r) => "@" + (r.handle ?? "?"));
  await each("crew", (q) => `SELECT id, name, visibility FROM crews WHERE id IN (${q})`, (r) => `${r.name} (${r.visibility})`);
  await each("car", (q) => `SELECT c.id, c.make, c.model, c.nickname, u.handle FROM cars c JOIN users u ON u.id = c.owner WHERE c.id IN (${q})`,
    (r) => `${r.make} ${r.model}${r.nickname ? ` "${r.nickname}"` : ""} · @${r.handle ?? "?"}`);
  await each("highlight", (q) => `SELECT id, name FROM highlights WHERE id IN (${q})`, (r) => r.name);
  return rows.map((r) => {
    const label = labels.get(`${r.kind}:${r.target_id}`) ?? null;
    return { kind: r.kind, target: r.target_id, label, gone: label === null, reporters: r.reporters, latest: r.latest,
             notes: (JSON.parse(r.notes) as string[]).slice(0, 10), who: (JSON.parse(r.who) as string[]).slice(0, 10), hidden: !!r.hidden };
  });
}

/** dismiss: the open reports close (those people can't re-trigger it) and a spot they hid comes back.
 *  remove: it stays down (its owner can't switch it back): a crew stops being public, a car stops being shown, a spot is hidden;
 *  a person is banned: membership ended, signed out everywhere, out of live convoys, their invites voided, their crews private and
 *  cars unshown. They keep the account and can still sign in to download or delete it. */
export async function moderationResolve(env: Env, v: Viewer, req: Request): Promise<void> {
  if (!isModerator(env, v)) throw new HttpError(404, "not_found");
  const b = object<{ kind?: unknown; target?: unknown; action?: unknown }>(await body(req));
  const kind = REPORT_KINDS.find((k) => k === b.kind);
  if (!kind) throw new HttpError(400, "bad_kind");
  const id = str(b.target, "target", 1, 64);
  if (b.action !== "dismiss" && b.action !== "remove") throw new HttpError(400, "bad_action");
  if (b.action === "dismiss") {
    await env.DB.batch([
      env.DB.prepare("UPDATE reports SET status = 'dismissed' WHERE kind = ? AND target_id = ? AND status = 'open'").bind(kind, id),
      ...(kind === "highlight" ? [env.DB.prepare(`UPDATE highlights SET status = 'active' WHERE id = ?1 AND status = 'hidden' AND NOT ${reportedSql("highlight", "?1")}`).bind(id)] : []),
    ]);
    return;
  }
  if (kind === "user" && id === v.id) throw new HttpError(400, "bad_target");
  const mark = env.DB.prepare("UPDATE reports SET status = 'removed' WHERE kind = ? AND target_id = ? AND status = 'open'").bind(kind, id);
  const act = {
    user: [
      env.DB.prepare("INSERT OR IGNORE INTO bans (user_id) SELECT id FROM users WHERE id = ?").bind(id),
      env.DB.prepare("DELETE FROM members WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM app_auth_codes WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM invites WHERE created_by = ? AND used_at IS NULL").bind(id),
      env.DB.prepare("DELETE FROM crew_invites WHERE created_by = ?").bind(id),
      env.DB.prepare("UPDATE crews SET visibility = 'private' WHERE owner = ?").bind(id),
      env.DB.prepare("UPDATE cars SET shared = 0 WHERE owner = ?").bind(id),
    ],
    crew: [env.DB.prepare("UPDATE crews SET visibility = 'private' WHERE id = ?").bind(id)],
    car: [env.DB.prepare("UPDATE cars SET shared = 0 WHERE id = ?").bind(id)],
    highlight: [env.DB.prepare("UPDATE highlights SET status = 'hidden' WHERE id = ?").bind(id)],
  }[kind];
  await env.DB.batch([mark, ...act]);
  if (kind === "user") await convoysLeaveAll(env, id);
}
