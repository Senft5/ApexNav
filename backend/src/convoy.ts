// Convoy: a live, private group drive. One Durable Object per convoy relays live positions, the leader's planned route,
// regroup calls and the leader's hazard calls to the members who joined it (docs/CONVOY_TRANSPORT.md).
// Persisted (DO storage): only control data, the room (leader, expiry, epoch, hashed invite) and the member list.
// Never persisted: positions, speeds, hazards, routes, socket tickets. Those live in memory and die with the room.
import { DurableObject } from "cloudflare:workers";
import { Env, randomToken, sha256hex } from "./util";

export const LIMITS = {
  members: 16, roomMs: 2 * 3600_000, inviteMs: 30 * 60_000, ticketMs: 30_000, authMs: 5_000,
  frameBytes: 32 * 1024, smallFrameBytes: 2048, framesPerS: 20, positionMinMs: 400, positionKeepMs: 120_000,
  hazards: 256, hazardDefaultMs: 3 * 60_000, hazardMaxMs: 5 * 60_000, sessionCheckMs: 60_000,
};
/** What a leader can call out. bump and hard_braking can come from the phone's sensors; the rest are taps. */
export const HAZARD_KINDS = ["bump", "hard_braking", "gravel", "debris", "animal", "police", "camera", "stopped"] as const;

export interface Who { id: string; handle: string | null; name: string | null }
interface Room { id: string; name: string; leaderId: string; epoch: number; createdAt: number; expiresAt: number; invite: { hash: string; issuedAt: number; expiresAt: number } }
interface Member { key: string; role: "leader" | "member"; handle: string | null; name: string | null; joinedAt: number }
interface Ticket { userId: string; epoch: number; sessionHash: string; expiresAt: number }
interface Conn { ws: WebSocket; userId: string | null; key: string | null; sessionHash: string | null; state: "new" | "auth" | "open"; frames: number; windowAt: number; lastPosAt: number; timer: ReturnType<typeof setTimeout> | null }
interface Anchor { lat: number; lon: number; pathId: string | null; routeVersion: number | null; direction: 1 | -1 | null; progressM: number | null }
interface LiveEvent {
  version: 1; eventId: string; sessionId: string; leaderEpoch: number; leaderKey: string; seq: number; action: "hazard" | "retract";
  type: string; observedAtMs: number; receivedAtMs: number; expiresAtMs: number; anchor: Anchor | null; source: "sensor" | "manual" | null; quality: number | null;
}
interface Position { key: string; lat: number; lon: number; heading: number | null; speedMps: number | null; progressM: number | null; at: number }

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const okR = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (status: number, error: string): Result<never> => ({ ok: false, status, error });

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const optNum = (v: unknown, lo: number, hi: number) => v === undefined || v === null ? null : isNum(v, lo, hi) ? v : undefined;
const onlyKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export class ConvoyRoom extends DurableObject<Env> {
  private room: Room | null = null;
  private members: Record<string, Member> = {};
  private revoked: Record<string, number> = {};      // user id -> when they left or were removed; an older invite cannot bring them back
  private tickets = new Map<string, Ticket>();       // sha256(ticket) -> ticket, memory only
  private conns = new Set<Conn>();
  private events = new Map<string, LiveEvent>();     // eventId -> live hazard or retraction tombstone
  private positions = new Map<string, Position>();   // member key -> latest fix
  private route: { name: string; polyline: string; version: number } | null = null;
  private regroup: { lat: number; lon: number; note: string | null; at: number } | null = null;
  private seq = 0;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

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
      await ctx.storage.put("room", room);
    });
  }

  // ---- HTTP side (called by the Worker over RPC, after it checked the account) --------------------
  async create(id: string, who: Who, name: string): Promise<Result<{ invite: string; context: ReturnType<ConvoyRoom["context"]> }>> {
    if (this.room) return fail(409, "convoy_exists");
    const now = Date.now(), secret = randomToken(24);
    this.room = { id, name, leaderId: who.id, epoch: 1, createdAt: now, expiresAt: now + LIMITS.roomMs,
                  invite: { hash: await sha256hex(secret), issuedAt: now, expiresAt: now + LIMITS.inviteMs } };
    this.members = { [who.id]: { key: randomToken(6), role: "leader", handle: who.handle, name: who.name, joinedAt: now } };
    await this.save();
    await this.ctx.storage.setAlarm(this.room.expiresAt);
    return okR({ invite: `${id}.${secret}`, context: this.context(who.id) });
  }

  async join(who: Who, secret: string): Promise<Result<ReturnType<ConvoyRoom["context"]>>> {
    const room = await this.live();
    if (!room) return fail(404, "no_convoy");
    if (this.members[who.id]) return okR(this.context(who.id));
    const now = Date.now();
    if (room.invite.expiresAt <= now || (await sha256hex(secret)) !== room.invite.hash) return fail(400, "invalid_invite");
    if ((this.revoked[who.id] ?? -1) >= room.invite.issuedAt) return fail(403, "invite_revoked");
    if (Object.keys(this.members).length >= LIMITS.members) return fail(409, "convoy_full");
    // Someone who blocked a member, or was blocked by one, never sees that member's live position: no join.
    const ids = Object.keys(this.members), marks = ids.map(() => "?").join(",");
    const blocked = await this.env.DB.prepare(
      `SELECT 1 FROM blocks WHERE (blocker = ? AND blocked IN (${marks})) OR (blocked = ? AND blocker IN (${marks})) LIMIT 1`,
    ).bind(who.id, ...ids, who.id, ...ids).first();
    if (blocked) return fail(403, "cannot_join");
    const m: Member = { key: randomToken(6), role: "member", handle: who.handle, name: who.name, joinedAt: now };
    this.members[who.id] = m;
    delete this.revoked[who.id];
    await this.save();
    this.broadcast({ type: "member", action: "joined", member: this.pub(who.id) });
    return okR(this.context(who.id));
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
    const now = Date.now();
    for (const [h, t] of this.tickets) if (t.expiresAt <= now) this.tickets.delete(h);
    if ([...this.tickets.values()].filter((t) => t.userId === userId).length >= 5) return fail(429, "too_many_tickets");
    const ticket = randomToken(24), expiresAt = now + LIMITS.ticketMs;
    this.tickets.set(await sha256hex(ticket), { userId, epoch: room.epoch, sessionHash, expiresAt });
    return okR({ ticket, expiresAtMs: expiresAt });
  }

  async status(userId: string): Promise<Result<ReturnType<ConvoyRoom["context"]>>> {
    const room = await this.live();
    return room && this.members[userId] ? okR(this.context(userId)) : fail(404, "no_convoy");
  }

  /** Idempotent. The leader leaving ends the convoy for everyone. */
  async leave(userId: string): Promise<Result<{ ended: boolean }>> {
    const room = await this.live();
    if (!room || !this.members[userId]) return okR({ ended: !room });
    if (this.members[userId].role === "leader") { await this.end("leader_left"); return okR({ ended: true }); }
    await this.drop(userId, "left");
    return okR({ ended: false });
  }

  /** Leader only: take a member out (they need a new invite to come back). */
  async remove(leaderId: string, key: string): Promise<Result<null>> {
    const room = await this.live();
    if (!room || this.members[leaderId]?.role !== "leader") return fail(404, "no_convoy");
    const userId = Object.keys(this.members).find((id) => this.members[id].key === key);
    if (!userId || userId === leaderId) return fail(404, "no_member");
    await this.drop(userId, "removed");
    return okR(null);
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
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const conn: Conn = { ws: server, userId: null, key: null, sessionHash: null, state: "new", frames: 0, windowAt: Date.now(), lastPosAt: 0, timer: null };
    conn.timer = setTimeout(() => { if (conn.state !== "open") this.close(conn, 4401, "auth_timeout"); }, LIMITS.authMs);
    this.conns.add(conn);
    server.addEventListener("message", (e) => { this.onFrame(conn, e.data).catch(() => this.close(conn, 1011, "server_error")); });
    const gone = () => { this.conns.delete(conn); if (conn.timer) clearTimeout(conn.timer); this.idleCheck(); };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async onFrame(conn: Conn, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== "string") return this.close(conn, 4400, "text_only");
    if (data.length > LIMITS.frameBytes) return this.close(conn, 4413, "frame_too_large");
    const now = Date.now();
    if (now - conn.windowAt >= 1000) { conn.windowAt = now; conn.frames = 0; }
    if (++conn.frames > LIMITS.framesPerS) return this.close(conn, 4429, "too_many_frames");
    let msg: unknown;
    try { msg = JSON.parse(data); } catch { return this.close(conn, 4400, "bad_json"); }
    if (!isObj(msg) || typeof msg.type !== "string") return this.close(conn, 4400, "bad_frame");

    if (conn.state === "new") return msg.type === "authenticate" ? this.authenticate(conn, msg) : this.close(conn, 4401, "authenticate_first");
    if (conn.state !== "open") return this.close(conn, 4401, "authenticate_first");   // a frame raced the handshake
    if (msg.type !== "route" && data.length > LIMITS.smallFrameBytes) return this.send(conn, { type: "error", error: "frame_too_large" });
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
    if (!t || !room || t.expiresAt <= Date.now() || t.epoch !== room.epoch || !this.members[t.userId]) return this.close(conn, 4401, "bad_ticket");
    if (!(await this.sessionAlive(t.sessionHash))) return this.close(conn, 4401, "signed_out");
    if (!this.members[t.userId]) return this.close(conn, 4401, "bad_ticket");   // left while we checked
    if (conn.timer) clearTimeout(conn.timer);
    conn.timer = null;
    Object.assign(conn, { userId: t.userId, key: this.members[t.userId].key, sessionHash: t.sessionHash, state: "open" });
    // Bounded replay: only live (unexpired) events, and only newer than what this client already saw in the same epoch.
    const after = msg.epoch === room.epoch && isNum(msg.afterSeq, 0, Number.MAX_SAFE_INTEGER) ? msg.afterSeq : 0;
    this.prune();
    this.send(conn, {
      type: "ready", context: this.context(t.userId),
      events: [...this.events.values()].filter((e) => e.seq > after).sort((a, b) => a.seq - b.seq),
      positions: [...this.positions.values()], route: this.route, regroup: this.regroup,
    });
    this.broadcast({ type: "presence", key: conn.key, online: true }, conn);
    if (!this.sweepTimer) this.sweepTimer = setInterval(() => { this.sweep().catch(() => {}); }, LIMITS.sessionCheckMs);
  }

  private position(conn: Conn, msg: Record<string, unknown>, now: number): void {
    if (!onlyKeys(msg, ["type", "lat", "lon", "heading", "speedMps", "progressM"]) || !isNum(msg.lat, -90, 90) || !isNum(msg.lon, -180, 180)) {
      return this.send(conn, { type: "error", error: "bad_position" });
    }
    const heading = optNum(msg.heading, 0, 360), speedMps = optNum(msg.speedMps, 0, 120), progressM = optNum(msg.progressM, 0, 2_000_000);
    if (heading === undefined || speedMps === undefined || progressM === undefined) return this.send(conn, { type: "error", error: "bad_position" });
    if (now - conn.lastPosAt < LIMITS.positionMinMs) return;   // too fast: dropped quietly
    conn.lastPosAt = now;
    const p: Position = { key: conn.key!, lat: msg.lat, lon: msg.lon, heading, speedMps, progressM, at: now };
    this.positions.set(p.key, p);
    this.broadcast({ type: "position", ...p }, conn);
  }

  private async publish(conn: Conn, msg: Record<string, unknown>, now: number): Promise<void> {
    const room = this.room!;
    // Every hazard re-checks the account session: a signed-out leader cannot keep broadcasting.
    if (!(await this.sessionAlive(conn.sessionHash!))) return this.close(conn, 4401, "signed_out");
    if (!this.members[conn.userId!] || this.members[conn.userId!].role !== "leader") return this.close(conn, 4403, "not_a_member");
    const e = isObj(msg.event) && onlyKeys(msg, ["type", "event"]) ? parseEvent(msg.event) : null;
    if (!e) return this.send(conn, { type: "error", error: "bad_event" });
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
    if (!isObj(r) || !onlyKeys(r, ["name", "polyline", "version"]) || typeof r.name !== "string" || r.name.length > 60
        || typeof r.polyline !== "string" || r.polyline.length < 2 || r.polyline.length > 30_000 || !/^[\x3f-\x7e]+$/.test(r.polyline)
        || !Number.isInteger(r.version) || (r.version as number) < 0) {
      return this.send(conn, { type: "error", error: "bad_route" });
    }
    this.route = { name: r.name, polyline: r.polyline, version: r.version as number };
    this.broadcast({ type: "route", route: this.route });
  }

  private setRegroup(conn: Conn, msg: Record<string, unknown>, now: number): void {
    if (msg.at === null) { this.regroup = null; return this.broadcast({ type: "regroup", regroup: null }); }
    const at = msg.at;
    if (!isObj(at) || !onlyKeys(at, ["lat", "lon", "note"]) || !isNum(at.lat, -90, 90) || !isNum(at.lon, -180, 180)
        || !(at.note === undefined || at.note === null || (typeof at.note === "string" && at.note.length <= 80))) {
      return this.send(conn, { type: "error", error: "bad_regroup" });
    }
    this.regroup = { lat: at.lat, lon: at.lon, note: (at.note as string | undefined) ?? null, at: now };
    this.broadcast({ type: "regroup", regroup: this.regroup });
  }

  // ---- helpers ----------------------------------------------------------------------------------
  private context(userId: string) {
    const room = this.room!, me = this.members[userId];
    const online = new Set([...this.conns].filter((c) => c.state === "open").map((c) => c.key));
    return {
      sessionId: room.id, name: room.name, leaderEpoch: room.epoch, role: me.role, you: me.key, expiresAtMs: room.expiresAt, seq: this.seq,
      leaderKey: this.members[room.leaderId].key,
      members: Object.keys(this.members).map((id) => ({ ...this.pub(id), online: online.has(this.members[id].key) })),
    };
  }
  private pub(userId: string) { const m = this.members[userId]; return { key: m.key, handle: m.handle, name: m.name, role: m.role }; }

  /** The room, or null if there is none or it has run out (then it is ended now). */
  private async live(): Promise<Room | null> {
    if (this.room && this.room.expiresAt <= Date.now()) await this.end("expired");
    return this.room;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put({ room: this.room, members: this.members, revoked: this.revoked });
  }

  private async drop(userId: string, reason: "left" | "removed"): Promise<void> {
    const key = this.members[userId].key;
    delete this.members[userId];
    this.revoked[userId] = Date.now();
    await this.save();
    for (const [h, t] of this.tickets) if (t.userId === userId) this.tickets.delete(h);
    this.positions.delete(key);
    for (const c of this.conns) if (c.userId === userId) this.close(c, 4403, reason);
    this.broadcast({ type: "member", action: reason, member: { key } });
  }

  /** Ends the convoy: everyone is told, every socket closes, and nothing about it is kept. */
  private async end(reason: string): Promise<void> {
    this.broadcast({ type: "ended", reason });
    for (const c of this.conns) this.close(c, 4000, reason);
    this.room = null;
    this.members = {}; this.revoked = {};
    this.tickets.clear(); this.events.clear(); this.positions.clear();
    this.route = null; this.regroup = null;
    this.idleCheck();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private async sessionAlive(hash: string): Promise<boolean> {
    return !!(await this.env.DB.prepare("SELECT 1 FROM sessions WHERE id_hash = ? AND expires_at > datetime('now')").bind(hash).first());
  }

  /** Every minute while anyone is connected: drop sockets whose account signed out, forget stale fixes and events. */
  private async sweep(): Promise<void> {
    if (!(await this.live())) return;
    this.prune();
    for (const c of [...this.conns]) {
      if (c.state === "open" && !(await this.sessionAlive(c.sessionHash!))) this.close(c, 4401, "signed_out");
    }
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
    if (conn.timer) clearTimeout(conn.timer);
    const wasOpen = conn.state === "open";
    conn.state = "auth";                                         // no more frames are handled for it
    this.conns.delete(conn);
    try { conn.ws.close(code, reason); } catch { /* already closed */ }
    if (wasOpen && conn.key && this.members[conn.userId!] && ![...this.conns].some((c) => c.key === conn.key && c.state === "open")) {
      this.broadcast({ type: "presence", key: conn.key, online: false });
    }
    this.idleCheck();
  }
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
    const pathId = a.pathId === undefined || a.pathId === null ? null : typeof a.pathId === "string" && a.pathId.length <= 64 ? a.pathId : undefined;
    const direction = a.direction === undefined || a.direction === null ? null : a.direction === 1 || a.direction === -1 ? a.direction : undefined;
    if (progressM === undefined || routeVersion === undefined || pathId === undefined || direction === undefined) return null;
    if (routeVersion !== null && !Number.isInteger(routeVersion)) return null;
    anchor = { lat: a.lat, lon: a.lon, pathId, routeVersion, direction, progressM };
  } else if (o.anchor !== undefined && o.anchor !== null) return null;
  return { eventId: o.eventId, type: o.type as string, action: o.action, observedAtMs: o.observedAtMs, expiresAtMs, anchor, source, quality } as const;
}
