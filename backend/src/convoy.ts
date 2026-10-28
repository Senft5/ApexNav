// Convoy: a live, private group drive. One Durable Object per convoy relays live positions, the leader's planned route,
// regroup calls and the leader's hazard calls to the members who joined it (docs/CONVOY_TRANSPORT.md).
// Persisted (DO storage): only control data, the room (leader, expiry, epoch, hashed invite) and member keys and roles.
// Never persisted: positions, speeds, hazards, routes, socket tickets, names. Those live in memory and die with the room.
// A second, tiny object per user (ConvoyIndex) lists the convoys they are in, so a block, sign-out or account deletion
// reaches those convoys at once, and so one person cannot open convoys without limit.
import { DurableObject } from "cloudflare:workers";
import { Env, randomToken, sha256hex } from "./util";

export const LIMITS = {
  members: 16, roomMs: 2 * 3600_000, inviteMs: 30 * 60_000, ticketMs: 30_000, authMs: 2_000,
  frameBytes: 32 * 1024, smallFrameBytes: 2048, framesPerS: 20, positionMinMs: 400, positionKeepMs: 120_000,
  socketsPerMember: 2, pendingSockets: 32, pendingPerIp: 4, hazards: 256, hazardDefaultMs: 3 * 60_000, hazardMaxMs: 5 * 60_000, checkMs: 15_000,
  ledAtOnce: 2, createdPerHour: 10,
};
/** What a leader can call out. bump and hard_braking can come from the phone's sensors; the rest are taps. */
export const HAZARD_KINDS = ["bump", "hard_braking", "gravel", "debris", "animal", "police", "camera", "stopped"] as const;

export interface Who { id: string; handle: string | null; name: string | null }
interface Room { id: string; name: string; leaderId: string; epoch: number; createdAt: number; expiresAt: number; invite: { hash: string; issuedAt: number; expiresAt: number } }
interface Member { key: string; role: "leader" | "member"; joinedAt: number }
interface Ticket { userId: string; sessionHash: string; expiresAt: number }
interface Conn { ws: WebSocket; ip: string; userId: string | null; key: string | null; sessionHash: string | null; state: "new" | "auth" | "open" | "closed"; frames: number; windowAt: number; openedAt: number; checkedAt: number; timer: ReturnType<typeof setTimeout> | null }
interface Anchor { lat: number; lon: number; pathId: string | null; routeVersion: number | null; direction: 1 | -1 | null; progressM: number | null }
interface LiveEvent {
  version: 1; eventId: string; sessionId: string; leaderEpoch: number; leaderKey: string; seq: number; action: "hazard" | "retract";
  type: string; observedAtMs: number; receivedAtMs: number; expiresAtMs: number; anchor: Anchor | null; source: "sensor" | "manual" | null; quality: number | null;
}
interface Position { key: string; lat: number; lon: number; heading: number | null; speedMps: number | null; progressM: number | null; at: number }
type Context = Awaited<ReturnType<ConvoyRoom["context"]>>;

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const okR = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error });

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
// Control characters and bidi overrides never travel: they can disguise a name or a note on someone else's screen.
const UNSAFE_RE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const UNSAFE_G = new RegExp(UNSAFE_RE.source, "g");
export const cleanText = (v: unknown, max: number): string | null => typeof v === "string" && v.length <= max && !UNSAFE_RE.test(v) ? v : null;
const scrub = (s: string | null) => (s === null ? null : s.replace(UNSAFE_G, "").slice(0, 60));
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const optNum = (v: unknown, lo: number, hi: number) => v === undefined || v === null ? null : isNum(v, lo, hi) ? v : undefined;
const onlyKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bytes = (s: string) => new TextEncoder().encode(s).length;

export const userIndex = (env: Env, userId: string) => env.CONVOY_INDEX.get(env.CONVOY_INDEX.idFromName(userId));
export const roomStub = (env: Env, id: string) => env.CONVOY.get(env.CONVOY.idFromName(id));

export class ConvoyRoom extends DurableObject<Env> {
  private room: Room | null = null;
  private members: Record<string, Member> = {};
  private revoked: Record<string, number> = {};      // user id -> when they left; an invite older than that cannot bring them back
  private banned: Record<string, true> = {};         // removed by the leader: out for the life of the convoy
  private names = new Map<string, { handle: string | null; name: string | null }>();   // memory only, from D1
  private tickets = new Map<string, Ticket>();       // sha256(ticket) -> ticket, memory only
  private conns = new Set<Conn>();
  private events = new Map<string, LiveEvent>();     // eventId -> live hazard or retraction tombstone
  private positions = new Map<string, Position>();   // member key -> latest fix
  private lastPosAt = new Map<string, number>();     // member key -> when their last fix was taken (per member, not per socket)
  private route: { name: string; polyline: string; version: number } | null = null;
  private regroup: { lat: number; lon: number; note: string | null; at: number } | null = null;
  private seq = 0;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const room = (await ctx.storage.get<Room>("room")) ?? null;
      if (!room) return;
      // A restart (eviction, deploy) lost every socket and every live event: a new epoch tells clients to reconnect and discard.
      room.epoch += 1;
      this.room = room;
      this.members = (await ctx.storage.get<Record<string, Member>>("members")) ?? {};
      this.revoked = (await ctx.storage.get<Record<string, number>>("revoked")) ?? {};
      this.banned = (await ctx.storage.get<Record<string, true>>("banned")) ?? {};
      await ctx.storage.put("room", room);
    });
  }

  /** Membership changes run one at a time: every check after an await still holds when the change is written. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.lock.then(fn, fn);
    this.lock = p.catch(() => {});
    return p;
  }

  // ---- HTTP side (called by the Worker over RPC, after it checked the account) --------------------
  create(id: string, who: Who, name: string): Promise<Result<{ invite: string; context: Context }>> {
    return this.serial(async () => {
      if (this.room) return fail(409, "convoy_exists");
      const now = Date.now(), secret = randomToken(24);
      this.room = { id, name, leaderId: who.id, epoch: 1, createdAt: now, expiresAt: now + LIMITS.roomMs,
                    invite: { hash: await sha256hex(secret), issuedAt: now, expiresAt: now + LIMITS.inviteMs } };
      this.members = { [who.id]: { key: randomToken(6), role: "leader", joinedAt: now } };
      this.names.set(who.id, { handle: who.handle, name: who.name });
      await this.save();
      await this.ctx.storage.setAlarm(this.room.expiresAt);
      return okR({ invite: `${id}.${secret}`, context: await this.context(who.id) });
    });
  }

  join(who: Who, secret: string): Promise<Result<Context>> {
    return this.serial(async () => {
      const room = await this.live();
      if (!room) return fail(404, "no_convoy");
      if (this.members[who.id]) return okR(await this.context(who.id));
      const now = Date.now();
      if (room.invite.expiresAt <= now || (await sha256hex(secret)) !== room.invite.hash) return fail(400, "invalid_invite");
      if (this.banned[who.id] || (this.revoked[who.id] ?? -1) >= room.invite.issuedAt) return fail(403, "invite_revoked");
      if (Object.keys(this.members).length >= LIMITS.members) return fail(409, "convoy_full");
      // Someone who blocked a member, or was blocked by one, never sees that member's live position: no join.
      if ((await this.blockedPairs([who.id], Object.keys(this.members))).length) return fail(403, "cannot_join");
      if (!(await this.index(who.id, (ix) => ix.add(room.id, room.expiresAt)))) return fail(429, "too_many_convoys");
      this.members[who.id] = { key: randomToken(6), role: "member", joinedAt: now };
      this.names.set(who.id, { handle: who.handle, name: who.name });
      delete this.revoked[who.id];
      await this.save();
      this.broadcast({ type: "member", action: "joined", member: this.pub(who.id) });
      return okR(await this.context(who.id));
    });
  }

  /** A join's checks without the join: who leads, what it's called, how many are in. A blocked pair learns nothing more
   *  than a join would tell them (cannot_join), and member names other than the leader's are never shown. */
  async preview(userId: string, secret: string): Promise<Result<{ name: string; leader: { handle: string | null; name: string | null }; members: number; max: number; full: boolean; expiresAtMs: number; member: boolean }>> {
    const room = await this.live();
    if (!room) return fail(404, "no_convoy");
    const already = !!this.members[userId];
    if (!already) {
      if (room.invite.expiresAt <= Date.now() || (await sha256hex(secret)) !== room.invite.hash) return fail(400, "invalid_invite");
      if (this.banned[userId] || (this.revoked[userId] ?? -1) >= room.invite.issuedAt) return fail(403, "invite_revoked");
      if ((await this.blockedPairs([userId], Object.keys(this.members))).length) return fail(403, "cannot_join");
    }
    await this.loadNames();
    const n = this.names.get(room.leaderId), count = Object.keys(this.members).length;
    return okR({ name: room.name, leader: { handle: n?.handle ?? null, name: scrub(n?.name ?? null) }, members: count, max: LIMITS.members,
                 full: count >= LIMITS.members, expiresAtMs: room.expiresAt, member: already });
  }

  /** Leader only: a fresh invite link. The old one stops working. */
  async newInvite(userId: string): Promise<Result<{ invite: string; expiresAtMs: number }>> {
    const room = await this.live();
    if (!room || this.members[userId]?.role !== "leader") return fail(404, "no_convoy");
    const now = Date.now(), secret = randomToken(24);
    room.invite = { hash: await sha256hex(secret), issuedAt: now, expiresAt: Math.min(now + LIMITS.inviteMs, room.expiresAt) };
    await this.save();
    return okR({ invite: `${room.id}.${secret}`, expiresAtMs: room.invite.expiresAt });
  }

  async ticket(userId: string, sessionHash: string): Promise<Result<{ ticket: string; expiresAtMs: number }>> {
    const room = await this.live();
    if (!room || !this.members[userId]) return fail(404, "no_convoy");
    await this.enforceBlocks();
    if (!this.members[userId]) return fail(404, "no_convoy");
    const now = Date.now();
    for (const [h, t] of this.tickets) if (t.expiresAt <= now) this.tickets.delete(h);
    if ([...this.tickets.values()].filter((t) => t.userId === userId).length >= 5) return fail(429, "too_many_tickets");
    const ticket = randomToken(24), expiresAt = now + LIMITS.ticketMs;
    this.tickets.set(await sha256hex(ticket), { userId, sessionHash, expiresAt });
    return okR({ ticket, expiresAtMs: expiresAt });
  }

  async status(userId: string): Promise<Result<Context>> {
    const room = await this.live();
    return room && this.members[userId] ? okR(await this.context(userId)) : fail(404, "no_convoy");
  }

  /** Idempotent. The leader leaving ends the convoy for everyone. */
  leave(userId: string): Promise<Result<{ ended: boolean }>> {
    return this.serial(async () => {
      const room = await this.live();
      if (!room || !this.members[userId]) return okR({ ended: !room });
      if (this.members[userId].role === "leader") { await this.end("leader_left"); return okR({ ended: true }); }
      await this.drop(userId, "left");
      return okR({ ended: false });
    });
  }

  /** Leader only: take a member out. They cannot come back into this convoy, whatever link they get. */
  remove(leaderId: string, key: string): Promise<Result<null>> {
    return this.serial(async () => {
      const room = await this.live();
      if (!room || this.members[leaderId]?.role !== "leader") return fail(404, "no_convoy");
      const userId = Object.keys(this.members).find((id) => this.members[id].key === key);
      if (!userId || userId === leaderId) return fail(404, "no_member");
      await this.drop(userId, "removed");
      return okR(null);
    });
  }

  /** Called when someone blocks someone, signs out or deletes their account: re-check now instead of at the next sweep. */
  async recheck(): Promise<void> {
    if (!(await this.live())) return;
    await this.enforceBlocks();
    await this.checkSessions();
  }

  async alarm(): Promise<void> {
    if (this.room && this.room.expiresAt <= Date.now()) await this.end("expired");
    else if (this.room) await this.ctx.storage.setAlarm(this.room.expiresAt);
  }

  // ---- WebSocket side ---------------------------------------------------------------------------
  /** The URL carries no credential. The first frame must be `{type:"authenticate", ticket}` within 5 s. */
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
    if (!(await this.live())) return new Response(null, { status: 404 });
    // Unauthenticated sockets are few and short-lived, and one address cannot hold many: someone with only the link
    // (a removed member, say) cannot fill the queue and keep the convoy's members from reconnecting.
    const ip = req.headers.get("cf-connecting-ip") ?? "", pending = [...this.conns].filter((c) => c.state === "new" || c.state === "auth");
    if (pending.filter((c) => c.ip === ip).length >= LIMITS.pendingPerIp) return new Response(null, { status: 429 });
    if (pending.length >= LIMITS.pendingSockets) return new Response(null, { status: 503 });
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const conn: Conn = { ws: server, ip, userId: null, key: null, sessionHash: null, state: "new", frames: 0, windowAt: Date.now(), openedAt: 0, checkedAt: 0, timer: null };
    conn.timer = setTimeout(() => { if (conn.state !== "open") this.close(conn, 4401, "auth_timeout"); }, LIMITS.authMs);
    this.conns.add(conn);
    server.addEventListener("message", (e) => { this.onFrame(conn, e.data).catch(() => this.close(conn, 1011, "server_error")); });
    const gone = () => this.close(conn, 1000, "gone");
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async onFrame(conn: Conn, data: string | ArrayBuffer): Promise<void> {
    if (conn.state === "closed") return;
    if (typeof data !== "string") return this.close(conn, 4400, "text_only");
    const size = data.length > LIMITS.frameBytes ? Infinity : bytes(data);
    if (size > LIMITS.frameBytes) return this.close(conn, 4413, "frame_too_large");
    const now = Date.now();
    if (now - conn.windowAt >= 1000) { conn.windowAt = now; conn.frames = 0; }
    if (++conn.frames > LIMITS.framesPerS) return this.close(conn, 4429, "too_many_frames");
    let msg: unknown;
    try { msg = JSON.parse(data); } catch { return this.close(conn, 4400, "bad_json"); }
    if (!isObj(msg) || typeof msg.type !== "string") return this.close(conn, 4400, "bad_frame");

    if (conn.state === "new") return msg.type === "authenticate" ? this.authenticate(conn, msg) : this.close(conn, 4401, "authenticate_first");
    if (conn.state !== "open") return;                           // sent right behind authenticate: dropped until ready
    if (msg.type !== "route" && size > LIMITS.smallFrameBytes) return this.send(conn, { type: "error", error: "frame_too_large" });
    if (!this.room || !conn.userId || !this.members[conn.userId]) return this.close(conn, 4403, "not_a_member");
    const leader = this.members[conn.userId].role === "leader";
    switch (msg.type) {
      case "ping": return this.send(conn, { type: "pong", at: now });
      case "position": return this.position(conn, msg, now);
      case "publish": return leader ? this.publish(conn, msg, now) : this.send(conn, { type: "error", error: "leader_only" });
      case "route": return leader ? this.setRoute(conn, msg) : this.send(conn, { type: "error", error: "leader_only" });
      case "regroup": return leader ? this.setRegroup(conn, msg, now) : this.send(conn, { type: "error", error: "leader_only" });
      default: return this.send(conn, { type: "error", error: "unknown_type" });
    }
  }

  private async authenticate(conn: Conn, msg: Record<string, unknown>): Promise<void> {
    if (typeof msg.ticket !== "string" || msg.ticket.length > 100) return this.close(conn, 4401, "bad_ticket");
    conn.state = "auth";
    const hash = await sha256hex(msg.ticket);
    const t = this.tickets.get(hash);
    this.tickets.delete(hash);                                   // single use, consumed before anything else happens
    const room = await this.live();
    // Tickets live in memory only, so an actor restart (new epoch) has none: old tickets cannot cross it.
    if (!t || !room || t.expiresAt <= Date.now() || !this.members[t.userId]) return this.close(conn, 4401, "bad_ticket");
    if (!(await this.sessionAlive(t.sessionHash))) return this.close(conn, 4401, "signed_out");
    if ((conn.state as Conn["state"]) !== "auth") return;        // the client went away while we checked
    await this.enforceBlocks();
    if (!this.members[t.userId] || (conn.state as Conn["state"]) !== "auth") return this.close(conn, 4401, "bad_ticket");   // left or blocked while we checked
    if (conn.timer) clearTimeout(conn.timer);
    conn.timer = null;
    const key = this.members[t.userId].key, wasOnline = this.online(key);
    Object.assign(conn, { userId: t.userId, key, sessionHash: t.sessionHash, state: "open", openedAt: Date.now(), checkedAt: Date.now() });
    // At most two sockets per member (a phone and a spare): the oldest one goes.
    const mine = [...this.conns].filter((c) => c.state === "open" && c.userId === t.userId).sort((a, b) => a.openedAt - b.openedAt);
    for (const c of mine.slice(0, Math.max(0, mine.length - LIMITS.socketsPerMember))) this.close(c, 4409, "replaced");
    // Bounded replay: only live (unexpired) events, and only newer than what this client already saw in the same epoch.
    const after = msg.epoch === room.epoch && isNum(msg.afterSeq, 0, Number.MAX_SAFE_INTEGER) ? msg.afterSeq : 0;
    this.prune();
    const context = await this.context(t.userId);
    if ((conn.state as Conn["state"]) !== "open") return;
    this.send(conn, {
      type: "ready", context,
      events: [...this.events.values()].filter((e) => e.seq > after).sort((a, b) => a.seq - b.seq),
      positions: [...this.positions.values()], route: this.route, regroup: this.regroup,
    });
    if (!wasOnline) this.broadcast({ type: "presence", key, online: true }, conn);
    if (!this.sweepTimer) this.sweepTimer = setInterval(() => { this.sweep().catch(() => {}); }, LIMITS.checkMs);
  }

  private position(conn: Conn, msg: Record<string, unknown>, now: number): void {
    if (!onlyKeys(msg, ["type", "lat", "lon", "heading", "speedMps", "progressM"]) || !isNum(msg.lat, -90, 90) || !isNum(msg.lon, -180, 180)) {
      return this.send(conn, { type: "error", error: "bad_position" });
    }
    const heading = optNum(msg.heading, 0, 360), speedMps = optNum(msg.speedMps, 0, 120), progressM = optNum(msg.progressM, 0, 2_000_000);
    if (heading === undefined || speedMps === undefined || progressM === undefined) return this.send(conn, { type: "error", error: "bad_position" });
    const key = conn.key!;
    if (now - (this.lastPosAt.get(key) ?? 0) < LIMITS.positionMinMs) return;   // too fast: dropped quietly
    this.lastPosAt.set(key, now);
    const p: Position = { key, lat: msg.lat, lon: msg.lon, heading, speedMps, progressM, at: now };
    this.positions.set(key, p);
    this.broadcast({ type: "position", ...p }, conn);
  }

  private async publish(conn: Conn, msg: Record<string, unknown>, now: number): Promise<void> {
    const room = this.room!;
    // Hazards re-check the account session (at most 5 s old): a signed-out leader cannot keep broadcasting.
    if (now - conn.checkedAt > 5000) {
      if (!(await this.sessionAlive(conn.sessionHash!))) return this.close(conn, 4401, "signed_out");
      conn.checkedAt = Date.now();
    }
    if ((conn.state as Conn["state"]) !== "open" || !this.members[conn.userId!] || this.members[conn.userId!].role !== "leader") return this.close(conn, 4403, "not_a_member");
    const e = isObj(msg.event) && onlyKeys(msg, ["type", "event"]) ? parseEvent(msg.event) : null;
    if (!e || (e.action === "hazard" && e.expiresAtMs !== null && e.expiresAtMs <= now)) return this.send(conn, { type: "error", error: "bad_event" });
    this.prune();
    const prev = this.events.get(e.eventId);
    if (prev && (prev.action === "retract" || e.action === "hazard")) {   // a retracted id never comes back; a repeat is ignored
      return this.send(conn, { type: "ack", eventId: e.eventId, seq: prev.seq, status: "duplicate" });
    }
    if (!prev && this.events.size >= LIMITS.hazards) return this.send(conn, { type: "error", error: "capacity", eventId: e.eventId });
    const life = e.expiresAtMs === null ? LIMITS.hazardDefaultMs : Math.max(0, Math.min(e.expiresAtMs - now, LIMITS.hazardMaxMs));
    const ev: LiveEvent = {
      version: 1, eventId: e.eventId, sessionId: room.id, leaderEpoch: room.epoch, leaderKey: conn.key!, seq: ++this.seq, action: e.action,
      type: e.action === "retract" ? prev?.type ?? e.type : e.type, observedAtMs: e.observedAtMs, receivedAtMs: now,
      expiresAtMs: e.action === "retract" ? Math.max(prev?.expiresAtMs ?? 0, now + LIMITS.hazardDefaultMs) : now + life,
      anchor: e.action === "retract" ? null : e.anchor, source: e.source, quality: e.quality,
    };
    this.events.set(ev.eventId, ev);
    this.broadcast({ type: "event", event: ev }, conn);
    this.send(conn, { type: "ack", eventId: ev.eventId, seq: ev.seq, status: e.action === "retract" ? "retracted" : "sent" });
  }

  private setRoute(conn: Conn, msg: Record<string, unknown>): void {
    const r = msg.route;
    if (r === null) { this.route = null; return this.broadcast({ type: "route", route: null }); }
    if (!isObj(r) || !onlyKeys(r, ["name", "polyline", "version"]) || cleanText(r.name, 60) === null
        || typeof r.polyline !== "string" || r.polyline.length < 2 || r.polyline.length > 30_000 || !/^[\x3f-\x7e]+$/.test(r.polyline)
        || !Number.isInteger(r.version) || (r.version as number) < 0) {
      return this.send(conn, { type: "error", error: "bad_route" });
    }
    this.route = { name: r.name as string, polyline: r.polyline, version: r.version as number };
    this.broadcast({ type: "route", route: this.route });
  }

  private setRegroup(conn: Conn, msg: Record<string, unknown>, now: number): void {
    if (msg.at === null) { this.regroup = null; return this.broadcast({ type: "regroup", regroup: null }); }
    const at = msg.at;
    if (!isObj(at) || !onlyKeys(at, ["lat", "lon", "note"]) || !isNum(at.lat, -90, 90) || !isNum(at.lon, -180, 180)
        || !(at.note === undefined || at.note === null || cleanText(at.note, 80) !== null)) {
      return this.send(conn, { type: "error", error: "bad_regroup" });
    }
    this.regroup = { lat: at.lat, lon: at.lon, note: (at.note as string | undefined) ?? null, at: now };
    this.broadcast({ type: "regroup", regroup: this.regroup });
  }

  // ---- helpers ----------------------------------------------------------------------------------
  private async context(userId: string) {
    await this.loadNames();
    const room = this.room!, me = this.members[userId];
    return {
      sessionId: room.id, name: room.name, leaderEpoch: room.epoch, role: me.role, you: me.key, expiresAtMs: room.expiresAt, seq: this.seq,
      leaderKey: this.members[room.leaderId].key,
      members: Object.keys(this.members).map((id) => ({ ...this.pub(id), online: this.online(this.members[id].key) })),
    };
  }
  private pub(userId: string) {
    const m = this.members[userId], n = this.names.get(userId);
    return { key: m.key, handle: n?.handle ?? null, name: scrub(n?.name ?? null), role: m.role };
  }
  private online(key: string) { return [...this.conns].some((c) => c.state === "open" && c.key === key); }

  /** Names are read from the accounts, never stored with the convoy. A deleted account leaves the convoy. */
  private async loadNames(force = false): Promise<string[]> {
    const ids = Object.keys(this.members).filter((id) => force || !this.names.has(id));
    if (!ids.length) return [];
    const rows = (await this.env.DB.prepare(`SELECT id, handle, display_name AS name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids).all<{ id: string; handle: string | null; name: string | null }>()).results;
    for (const r of rows) this.names.set(r.id, { handle: r.handle, name: r.name });
    const gone = ids.filter((id) => !rows.some((r) => r.id === id));
    for (const id of gone) this.names.set(id, { handle: null, name: null });
    return gone;
  }

  /** The room, or null if there is none or it has run out (then it is ended now). */
  private async live(): Promise<Room | null> {
    if (this.room && this.room.expiresAt <= Date.now()) await this.end("expired");
    return this.room;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put({ room: this.room, members: this.members, revoked: this.revoked, banned: this.banned });
  }

  /** Runs `fn` against a user's convoy index; false when it refused (or could not be reached for an add). */
  private async index(userId: string, fn: (ix: DurableObjectStub<ConvoyIndex>) => Promise<boolean | void>): Promise<boolean> {
    try { return (await fn(userIndex(this.env, userId))) !== false; } catch { return false; }
  }

  private async drop(userId: string, reason: "left" | "removed" | "blocked"): Promise<void> {
    const key = this.members[userId].key;
    delete this.members[userId];
    this.names.delete(userId);
    this.revoked[userId] = Date.now();
    if (reason === "removed") this.banned[userId] = true;
    await this.save();
    await this.index(userId, (ix) => ix.remove(this.room!.id));
    for (const [h, t] of this.tickets) if (t.userId === userId) this.tickets.delete(h);
    this.positions.delete(key);
    this.lastPosAt.delete(key);
    for (const c of [...this.conns]) if (c.userId === userId) this.close(c, 4403, reason === "blocked" ? "removed" : reason);   // never tell anyone they were blocked
    this.broadcast({ type: "member", action: reason === "blocked" ? "removed" : reason, member: { key } });
  }

  /** Ends the convoy: everyone is told, every socket closes, and nothing about it is kept. */
  private async end(reason: string): Promise<void> {
    if (!this.room) return;
    const id = this.room.id, who = Object.keys(this.members);
    this.broadcast({ type: "ended", reason });
    this.room = null;
    for (const c of [...this.conns]) this.close(c, 4000, reason);
    this.members = {}; this.revoked = {}; this.banned = {}; this.names.clear();
    this.tickets.clear(); this.events.clear(); this.positions.clear(); this.lastPosAt.clear();
    this.route = null; this.regroup = null;
    this.idleCheck();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    await Promise.all(who.map((u) => this.index(u, (ix) => ix.remove(id))));
  }

  private async sessionAlive(hash: string): Promise<boolean> {
    return !!(await this.env.DB.prepare("SELECT 1 FROM sessions WHERE id_hash = ? AND expires_at > datetime('now')").bind(hash).first());
  }

  private async blockedPairs(a: string[], b: string[]) {
    if (!a.length || !b.length) return [];
    const ma = a.map(() => "?").join(","), mb = b.map(() => "?").join(",");
    return (await this.env.DB.prepare(
      `SELECT blocker, blocked FROM blocks WHERE (blocker IN (${ma}) AND blocked IN (${mb})) OR (blocker IN (${mb}) AND blocked IN (${ma}))`,
    ).bind(...a, ...b, ...a, ...b).all<{ blocker: string; blocked: string }>()).results;
  }

  /** Two people who block each other never share a convoy: the blocked one goes (or the blocker, if the blocked one leads). */
  private enforceBlocks(): Promise<void> {
    return this.serial(async () => {
      if (!this.room) return;
      const ids = Object.keys(this.members);
      for (const p of await this.blockedPairs(ids, ids)) {
        if (!this.members[p.blocker] || !this.members[p.blocked]) continue;
        await this.drop(this.members[p.blocked].role === "leader" ? p.blocker : p.blocked, "blocked");
      }
    });
  }

  private async checkSessions(): Promise<void> {
    for (const c of [...this.conns]) {
      if (c.state === "open" && !(await this.sessionAlive(c.sessionHash!))) this.close(c, 4401, "signed_out");
      else if (c.state === "open") c.checkedAt = Date.now();
    }
    for (const id of await this.loadNames(true)) {                // accounts deleted since they joined
      if (!this.room) return;
      if (this.members[id]?.role === "leader") return this.end("leader_left");
      if (this.members[id]) await this.serial(() => this.drop(id, "left"));
    }
  }

  /** Every 15 s while anyone is connected: blocks, signed-out sessions, deleted accounts, stale fixes and events. */
  private async sweep(): Promise<void> {
    if (!(await this.live())) return;
    this.prune();
    await this.enforceBlocks();
    await this.checkSessions();
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, e] of this.events) if (e.expiresAtMs <= now) this.events.delete(id);
    for (const [k, p] of this.positions) if (now - p.at > LIMITS.positionKeepMs) this.positions.delete(k);
    for (const [h, t] of this.tickets) if (t.expiresAt <= now) this.tickets.delete(h);
  }

  private idleCheck(): void {
    if (this.sweepTimer && ![...this.conns].some((c) => c.state === "open")) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
  }

  private send(conn: Conn, msg: unknown): void { try { conn.ws.send(JSON.stringify(msg)); } catch { /* closing */ } }
  private broadcast(msg: unknown, except?: Conn): void {
    const s = JSON.stringify(msg);
    for (const c of this.conns) if (c !== except && c.state === "open") { try { c.ws.send(s); } catch { /* closing */ } }
  }
  private close(conn: Conn, code: number, reason: string): void {
    if (conn.state === "closed") return;
    if (conn.timer) clearTimeout(conn.timer);
    const wasOpen = conn.state === "open";
    conn.state = "closed";                                       // no more frames are handled for it
    this.conns.delete(conn);
    try { conn.ws.close(code, reason); } catch { /* already closed */ }
    if (wasOpen && conn.key && this.room && this.members[conn.userId!] && !this.online(conn.key)) {
      this.broadcast({ type: "presence", key: conn.key, online: false });
    }
    this.idleCheck();
  }
}

/** Per user: the convoys they are in right now (ids and expiry only), and how many they started lately. */
export class ConvoyIndex extends DurableObject<Env> {
  private async load() {
    const now = Date.now();
    const convoys = Object.fromEntries(Object.entries((await this.ctx.storage.get<Record<string, number>>("convoys")) ?? {}).filter(([, exp]) => exp > now));
    const led = Object.fromEntries(Object.entries((await this.ctx.storage.get<Record<string, number>>("led")) ?? {}).filter(([id]) => id in convoys));
    const created = ((await this.ctx.storage.get<number[]>("created")) ?? []).filter((t) => now - t < 3600_000);
    return { convoys, led, created };
  }
  private async save(s: Awaited<ReturnType<ConvoyIndex["load"]>>) {
    if (!Object.keys(s.convoys).length && !s.created.length) { await this.ctx.storage.deleteAll(); return; }
    await this.ctx.storage.put({ convoys: s.convoys, led: s.led, created: s.created });
  }
  /** Before creating a convoy: at most two led at once and ten started in an hour. */
  async claim(id: string, expiresAt: number): Promise<boolean> {
    const s = await this.load();
    if (Object.keys(s.led).length >= LIMITS.ledAtOnce || s.created.length >= LIMITS.createdPerHour) return false;
    s.convoys[id] = expiresAt; s.led[id] = expiresAt; s.created.push(Date.now());
    await this.save(s);
    return true;
  }
  async add(id: string, expiresAt: number): Promise<boolean> {
    const s = await this.load();
    if (!(id in s.convoys) && Object.keys(s.convoys).length >= 10) return false;
    s.convoys[id] = expiresAt;
    await this.save(s);
    return true;
  }
  async remove(id: string): Promise<void> {
    const s = await this.load();
    delete s.convoys[id]; delete s.led[id];
    await this.save(s);
  }
  async list(): Promise<string[]> { return Object.keys((await this.load()).convoys); }
}

/** Server-side validation of a leader's event: exact fields, finite numbers, known kinds. Nothing about identity is taken from it. */
export function parseEvent(o: Record<string, unknown>) {
  const keys = ["eventId", "type", "action", "observedAtMs", "expiresAtMs", "anchor", "source", "quality"];
  if (!onlyKeys(o, keys) || typeof o.eventId !== "string" || !ID_RE.test(o.eventId)) return null;
  if (o.action !== "hazard" && o.action !== "retract") return null;
  if (!(HAZARD_KINDS as readonly unknown[]).includes(o.type)) return null;
  if (!isNum(o.observedAtMs, 0, 8.64e15)) return null;
  const expiresAtMs = optNum(o.expiresAtMs, 0, 8.64e15), quality = optNum(o.quality, 0, 1);
  if (expiresAtMs === undefined || quality === undefined) return null;
  const source = o.source === undefined || o.source === null ? null : o.source === "sensor" || o.source === "manual" ? o.source : undefined;
  if (source === undefined) return null;
  let anchor: Anchor | null = null;
  if (o.action === "hazard") {
    const a = o.anchor;
    if (!isObj(a) || !onlyKeys(a, ["lat", "lon", "pathId", "routeVersion", "direction", "progressM"]) || !isNum(a.lat, -90, 90) || !isNum(a.lon, -180, 180)) return null;
    const progressM = optNum(a.progressM, 0, 2_000_000), routeVersion = optNum(a.routeVersion, 0, Number.MAX_SAFE_INTEGER);
    const pathId = a.pathId === undefined || a.pathId === null ? null : typeof a.pathId === "string" && ID_RE.test(a.pathId) ? a.pathId : undefined;
    const direction = a.direction === undefined || a.direction === null ? null : a.direction === 1 || a.direction === -1 ? a.direction : undefined;
    if (progressM === undefined || routeVersion === undefined || pathId === undefined || direction === undefined) return null;
    if (routeVersion !== null && !Number.isInteger(routeVersion)) return null;
    anchor = { lat: a.lat, lon: a.lon, pathId, routeVersion, direction, progressM };
  } else if (o.anchor !== undefined && o.anchor !== null) return null;
  return { eventId: o.eventId, type: o.type as string, action: o.action, observedAtMs: o.observedAtMs, expiresAtMs, anchor, source, quality } as const;
}

/** For the account routes: tell every convoy this user is in to re-check blocks, sessions and accounts now. */
export async function convoysRecheck(env: Env, userId: string): Promise<void> {
  try {
    const ids = await userIndex(env, userId).list();
    await Promise.all(ids.map((id) => roomStub(env, id).recheck().catch(() => {})));
  } catch { /* the sweep catches up within 15 s */ }
}
/** Account deletion: leave (or end, as leader) every convoy first. */
export async function convoysLeaveAll(env: Env, userId: string): Promise<void> {
  try {
    const ids = await userIndex(env, userId).list();
    await Promise.all(ids.map((id) => roomStub(env, id).leave(userId).catch(() => {})));
  } catch { /* the sweep drops deleted accounts within 15 s */ }
}
