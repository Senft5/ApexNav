import { env, exports } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, api, freshDb, makeBanned, makeUser, ok, type TestUser } from "./helpers";
import { LIMITS, parseEvent } from "../src/convoy";

beforeEach(freshDb);

type Msg = Record<string, any>;
interface Client { ws: WebSocket; inbox: Msg[]; closed: { code: number; reason: string } | null; next(type: string, ms?: number): Promise<Msg>; none(type: string, ms?: number): Promise<void>; send(m: unknown): void }

const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const create = (u: TestUser, name = "Sunday run") => json(api(u, "POST", "/api/convoy", { consent: true, name }));
const join = (u: TestUser, invite: string) => api(u, "POST", "/api/convoy/join", { consent: true, invite });
const ticket = async (u: TestUser, id: string) => (await json(api(u, "POST", `/api/convoy/${id}/ticket`))).ticket as string;

let ipSeq = 0;
async function open(id: string, origin = ORIGIN, ip = `10.0.0.${++ipSeq % 250}`): Promise<Client> {
  const res = await exports.default.fetch(new Request(`${ORIGIN}/api/convoy/${id}/connect`, { headers: { upgrade: "websocket", origin, "cf-connecting-ip": ip } }));
  if (!res.webSocket) throw new Error(`no socket: HTTP ${res.status}`);
  const ws = res.webSocket;
  ws.accept();
  const c: Client = {
    ws, inbox: [], closed: null,
    send: (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m)),
    async next(type, ms = 1000) {
      const end = Date.now() + ms;
      for (;;) {
        const i = c.inbox.findIndex((m) => m.type === type);
        if (i >= 0) return c.inbox.splice(i, 1)[0];
        if (Date.now() > end) throw new Error(`no ${type}; have ${JSON.stringify(c.inbox)} closed=${JSON.stringify(c.closed)}`);
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    async none(type, ms = 100) {
      await new Promise((r) => setTimeout(r, ms));
      expect(c.inbox.filter((m) => m.type === type)).toEqual([]);
    },
  };
  ws.addEventListener("message", (e) => { c.inbox.push(JSON.parse(e.data as string)); });
  ws.addEventListener("close", (e) => { c.closed = { code: e.code, reason: e.reason }; });
  return c;
}
async function connect(u: TestUser, id: string, extra: Msg = {}): Promise<Client> {
  const t = await ticket(u, id), c = await open(id);
  c.send({ type: "authenticate", ticket: t, ...extra });
  await c.next("ready");
  return c;
}
const closedWith = async (c: Client, ms = 1000) => {
  const end = Date.now() + ms;
  while (!c.closed && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
  return c.closed;
};
const hazard = (eventId: string, over: Msg = {}) => ({
  type: "publish", event: { eventId, type: "bump", action: "hazard", observedAtMs: Date.now(), anchor: { lat: 35.3, lon: -83.8, progressM: 1200 }, source: "manual", ...over },
});

const stub = (id: string) => env.CONVOY.get(env.CONVOY.idFromName(id));

/** A leader with a live convoy and two followers who joined it. */
async function convoyOfThree() {
  const [lead, f1, f2] = [await makeUser("lead"), await makeUser("fone"), await makeUser("ftwo")];
  const made = await create(lead);
  const id = made.context.sessionId as string;
  await ok(join(f1, made.invite));
  await ok(join(f2, made.invite));
  return { lead, f1, f2, id, invite: made.invite as string };
}

describe("convoy: create, join, leave", () => {
  it("needs explicit consent, a member account and a valid invite", async () => {
    const [a, b, outsider] = [await makeUser("alice"), await makeUser("bob"), await makeBanned("nomem")];
    expect((await api(a, "POST", "/api/convoy", { name: "x" })).status).toBe(400);
    expect((await api(outsider, "POST", "/api/convoy", { consent: true })).status).toBe(403);
    expect((await api(null, "POST", "/api/convoy", { consent: true })).status).toBe(401);
    const made = await create(a);
    expect(made.context).toMatchObject({ role: "leader", name: "Sunday run", members: [{ handle: "alice", role: "leader" }] });
    expect(made.invite).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{32}$/);
    expect((await api(b, "POST", "/api/convoy/join", { invite: made.invite })).status).toBe(400);           // no consent
    expect((await join(b, made.invite.replace(/.$/, (c: string) => (c === "x" ? "y" : "x")))).status).toBe(400); // wrong secret (never the same last char)
    const ctx = await json(join(b, made.invite));
    expect(ctx).toMatchObject({ role: "member", sessionId: made.context.sessionId });
    expect(ctx.members.map((m: Msg) => m.handle)).toEqual(["alice", "bob"]);
    expect(Object.keys(ctx.members[0]).sort()).toEqual(["handle", "key", "online", "role"]);       // no account ids, no real names
    expect((await json(api(b, "GET", `/api/convoy/${made.context.sessionId}`))).role).toBe("member");
    expect((await api(outsider, "GET", `/api/convoy/${made.context.sessionId}`)).status).toBe(403);
    expect((await api(b, "GET", "/api/convoy/not-a-room")).status).toBe(404);
  });

  it("a member who left needs a new invite; the leader can remove a member", async () => {
    const { lead, f1, f2, id, invite } = await convoyOfThree();
    await ok(api(f1, "POST", `/api/convoy/${id}/leave`));
    await ok(api(f1, "POST", `/api/convoy/${id}/leave`));                                                  // idempotent
    expect((await api(f1, "GET", `/api/convoy/${id}`)).status).toBe(404);
    expect((await join(f1, invite)).status).toBe(403);                                                     // old invite: revoked
    const fresh = (await json(api(lead, "POST", `/api/convoy/${id}/invite`))).invite as string;
    expect((await join(f2, invite)).status).toBe(200);                                                     // already in: fine either way
    expect((await join(await makeUser("late"), invite)).status).toBe(400);                                 // the old link stopped working
    await ok(join(f1, fresh));
    expect((await api(f1, "POST", `/api/convoy/${id}/invite`)).status).toBe(404);                         // leader only
    const key = (await json(api(f2, "GET", `/api/convoy/${id}`))).you as string;
    expect((await api(f1, "POST", `/api/convoy/${id}/remove`, { member: key })).status).toBe(404);
    await ok(api(lead, "POST", `/api/convoy/${id}/remove`, { member: key }));
    expect((await api(f2, "GET", `/api/convoy/${id}`)).status).toBe(404);
    expect((await join(f2, fresh)).status).toBe(403);
    const later = (await json(api(lead, "POST", `/api/convoy/${id}/invite`))).invite as string;
    expect((await join(f2, later)).status).toBe(403);                                                     // removed: out for good
  });

  it("a block made mid-drive drops the blocked member at once", async () => {
    const { lead, f1, f2, id } = await convoyOfThree();
    const l = await connect(lead, id), a = await connect(f1, id), b = await connect(f2, id);
    await ok(api(f1, "POST", "/api/blocks", { user_id: f2.id }));
    expect(await closedWith(b)).toEqual({ code: 4403, reason: "removed" });                              // never "blocked"
    expect((await api(f2, "GET", `/api/convoy/${id}`)).status).toBe(404);
    a.send({ type: "position", lat: 35.31, lon: -83.81 });
    await l.next("position");
    // blocking the leader takes the blocker out instead (they cannot follow someone they blocked)
    await ok(api(f1, "POST", "/api/blocks", { user_id: lead.id }));
    expect((await closedWith(a))?.code).toBe(4403);
    expect((await api(lead, "GET", `/api/convoy/${id}`)).status).toBe(200);
  });

  it("deleting an account takes it out of live convoys first", async () => {
    const { lead, f1, id } = await convoyOfThree();
    const l = await connect(lead, id);
    await ok(api(f1, "DELETE", "/api/me", { confirm: "DELETE" }));
    expect((await l.next("member")).action).toBe("left");
    expect((await json(api(lead, "GET", `/api/convoy/${id}`))).members.length).toBe(2);
  });

  it("one person leads at most two convoys at once", async () => {
    const a = await makeUser("alice");
    await create(a); await create(a);
    expect((await api(a, "POST", "/api/convoy", { consent: true })).status).toBe(429);
  });

  it("members are shown by handle only, never their Google name; route names with control characters are refused", async () => {
    const { lead, f1, id } = await convoyOfThree();
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind("Real Name", f1.id).run();
    expect((await api(lead, "POST", "/api/convoy", { consent: true, name: "bad\u0007" })).status).toBe(400);
    const l = await connect(lead, id);
    await runInDurableObject(stub(id), (inst) => (inst as unknown as { sweep(): Promise<void> }).sweep());   // names refresh from the accounts
    const shown = (await json(api(lead, "GET", `/api/convoy/${id}`))).members.find((m: Msg) => m.handle === "fone");
    expect(shown).toEqual({ key: expect.any(String), handle: "fone", role: "member", online: false });
    expect(JSON.stringify(await json(api(lead, "GET", `/api/convoy/${id}`)))).not.toContain("Real Name");
    l.send({ type: "route", route: { name: "x\u202ey", polyline: "_p~iF~ps|U", version: 1 } });
    expect((await l.next("error")).error).toBe("bad_route");
  });

  it("a blocked person cannot join a convoy with someone they blocked or who blocked them", async () => {
    const { f1, invite } = await convoyOfThree();
    const stranger = await makeUser("stranger");
    await ok(api(stranger, "POST", "/api/blocks", { user_id: f1.id }));
    expect((await join(stranger, invite)).status).toBe(403);
  });

  it("concurrent joins never pass the cap", async () => {
    const lead = await makeUser("lead");
    const made = await create(lead);
    const people = await Promise.all(Array.from({ length: 24 }, (_, i) => makeUser(`c${i}`)));
    const codes = await Promise.all(people.map((p) => join(p, made.invite).then((r) => r.status)));
    expect(codes.filter((c) => c === 200).length).toBe(LIMITS.members - 1);
    expect((await json(api(lead, "GET", `/api/convoy/${made.context.sessionId}`))).members.length).toBe(LIMITS.members);
  });

  it("caps convoys at 16 members", async () => {
    const lead = await makeUser("lead");
    const made = await create(lead);
    for (let i = 1; i < LIMITS.members; i++) await ok(join(await makeUser(`m${i}`), made.invite));
    expect((await join(await makeUser("toomany"), made.invite)).status).toBe(409);
  });

  it("the leader leaving ends it for everyone and nothing is kept", async () => {
    const { lead, f1, id } = await convoyOfThree();
    const c = await connect(f1, id);
    await ok(api(lead, "POST", `/api/convoy/${id}/leave`));
    expect((await c.next("ended")).reason).toBe("leader_left");
    expect((await closedWith(c))?.code).toBe(4000);
    expect((await api(f1, "GET", `/api/convoy/${id}`)).status).toBe(404);
    const stub = env.CONVOY.get(env.CONVOY.idFromName(id));
    expect(await runInDurableObject(stub, async (_i, state) => (await state.storage.list()).size)).toBe(0);
  });

  it("expires after two hours (the alarm ends it)", async () => {
    const { f1, id } = await convoyOfThree();
    const c = await connect(f1, id);
    const stub = env.CONVOY.get(env.CONVOY.idFromName(id));
    await runInDurableObject(stub, async (_i, state) => {
      const room = (await state.storage.get<Msg>("room"))!;
      room.expiresAt = Date.now() - 1;
      await state.storage.put("room", room);
      (_i as unknown as { room: Msg }).room.expiresAt = Date.now() - 1;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await c.next("ended")).reason).toBe("expired");
    expect((await closedWith(c))?.code).toBe(4000);
    expect((await api(f1, "GET", `/api/convoy/${id}`)).status).toBe(404);
    expect(await runInDurableObject(stub, async (_i, state) => (await state.storage.list()).size)).toBe(0);
  });
});

describe("convoy: socket authentication", () => {
  it("the first frame must carry a fresh single-use ticket", async () => {
    const { f1, id } = await convoyOfThree();
    const t = await ticket(f1, id);
    const a = await open(id);
    a.send({ type: "authenticate", ticket: t });
    expect((await a.next("ready")).context.role).toBe("member");
    const b = await open(id);
    b.send({ type: "authenticate", ticket: t });                                                           // reused
    expect((await closedWith(b))?.code).toBe(4401);
    const c = await open(id);
    c.send({ type: "position", lat: 35, lon: -83 });                                                       // not authenticated first
    expect((await closedWith(c))?.reason).toBe("authenticate_first");
    const d = await open(id);
    d.send({ type: "authenticate", ticket: "made-up-ticket-value" });
    expect((await closedWith(d))?.code).toBe(4401);
  });

  it("refuses other origins, non-members and tickets from outsiders", async () => {
    const { id } = await convoyOfThree();
    const res = await exports.default.fetch(new Request(`${ORIGIN}/api/convoy/${id}/connect`, { headers: { upgrade: "websocket", origin: "https://evil.test" } }));
    expect(res.status).toBe(403);
    expect((await api(await makeUser("other"), "POST", `/api/convoy/${id}/ticket`)).status).toBe(404);
  });

  it("one address cannot fill the handshake queue and lock members out", async () => {
    const { f1, id } = await convoyOfThree();
    for (let i = 0; i < LIMITS.pendingPerIp; i++) await open(id, ORIGIN, "203.0.113.9");
    const res = await exports.default.fetch(new Request(`${ORIGIN}/api/convoy/${id}/connect`, { headers: { upgrade: "websocket", origin: ORIGIN, "cf-connecting-ip": "203.0.113.9" } }));
    expect(res.status).toBe(429);
    const c = await connect(f1, id);
    expect(c.closed).toBeNull();
  });

  it("an expired ticket is refused", async () => {
    const { f1, id } = await convoyOfThree();
    const t = await ticket(f1, id);
    const stub = env.CONVOY.get(env.CONVOY.idFromName(id));
    await runInDurableObject(stub, (inst) => { for (const x of (inst as unknown as { tickets: Map<string, Msg> }).tickets.values()) x.expiresAt = Date.now() - 1; });
    const c = await open(id);
    c.send({ type: "authenticate", ticket: t });
    expect((await closedWith(c))?.reason).toBe("bad_ticket");
  });

  it("signing out closes that person's convoy sockets at once, and a hazard never goes out after it", async () => {
    const { lead, f1, id } = await convoyOfThree();
    const l = await connect(lead, id), f = await connect(f1, id);
    await ok(api(lead, "POST", "/api/auth/logout"));
    expect((await closedWith(l))?.reason).toBe("signed_out");
    expect((await api(lead, "POST", `/api/convoy/${id}/ticket`)).status).toBe(401);                       // and cannot get back in
    await f.none("event");
    expect(f.closed).toBeNull();
  });

  it("the sweep closes sockets whose session ended some other way (expiry)", async () => {
    const { f1, id } = await convoyOfThree();
    const f = await connect(f1, id);
    await env.DB.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 minute') WHERE user_id = ?").bind(f1.id).run();
    await runInDurableObject(stub(id), (inst) => (inst as unknown as { sweep(): Promise<void> }).sweep());
    expect((await closedWith(f))?.reason).toBe("signed_out");
  });

  it("the iOS shell's origin can open a socket", async () => {
    const { f1, id } = await convoyOfThree();
    const t = await ticket(f1, id), c = await open(id, "apexnav://app");
    c.send({ type: "authenticate", ticket: t });
    expect((await c.next("ready")).context.role).toBe("member");
  });

  it("a client that hangs up mid-handshake leaves nothing behind", async () => {
    const { f1, id } = await convoyOfThree();
    const t = await ticket(f1, id), c = await open(id);
    c.send({ type: "authenticate", ticket: t });
    c.ws.close(1000, "bye");
    await new Promise((r) => setTimeout(r, 100));
    const left = await runInDurableObject(stub(id), (inst) => { const i = inst as unknown as { conns: Set<unknown>; sweepTimer: unknown }; return { conns: i.conns.size, timer: !!i.sweepTimer }; });
    expect(left).toEqual({ conns: 0, timer: false });
  });

  it("frames sent right behind authenticate are dropped, not fatal", async () => {
    const { f1, id } = await convoyOfThree();
    const t = await ticket(f1, id), c = await open(id);
    c.send({ type: "authenticate", ticket: t });
    c.send({ type: "ping" });
    await c.next("ready");
    expect(c.closed).toBeNull();
  });

  it("at most two sockets per member: a third replaces the oldest", async () => {
    const { f1, id } = await convoyOfThree();
    const a = await connect(f1, id), b = await connect(f1, id), c = await connect(f1, id);
    expect((await closedWith(a))?.code).toBe(4409);
    expect(b.closed).toBeNull();
    expect(c.closed).toBeNull();
  });

  it("presence: a member who hangs up shows offline to the others", async () => {
    const { lead, f1, id } = await convoyOfThree();
    const l = await connect(lead, id), f = await connect(f1, id);
    const on = await l.next("presence");
    expect(on.online).toBe(true);
    f.ws.close(1000, "bye");
    expect(await l.next("presence")).toMatchObject({ key: on.key, online: false });
  });

  it("leaving closes that member's sockets right away", async () => {
    const { lead, f1, id } = await convoyOfThree();
    const l = await connect(lead, id), f = await connect(f1, id);
    await ok(api(f1, "POST", `/api/convoy/${id}/leave`));
    expect((await closedWith(f))?.code).toBe(4403);
    expect((await l.next("member")).action).toBe("left");
  });
});

describe("convoy: live relay", () => {
  it("the leader's hazard reaches both followers at once; followers cannot publish", async () => {
    const { lead, f1, f2, id } = await convoyOfThree();
    const [l, a, b] = [await connect(lead, id), await connect(f1, id), await connect(f2, id)];
    l.send(hazard("evt-0001"));
    const [ea, eb, ack] = [await a.next("event"), await b.next("event"), await l.next("ack")];
    expect(ea.event).toMatchObject({ eventId: "evt-0001", action: "hazard", type: "bump", seq: 1, leaderEpoch: 1, sessionId: id, anchor: { lat: 35.3, lon: -83.8, progressM: 1200, pathId: null } });
    expect(eb.event.eventId).toBe("evt-0001");
    expect(ack).toMatchObject({ eventId: "evt-0001", status: "sent", seq: 1 });
    expect(ea.event.expiresAtMs - ea.event.receivedAtMs).toBe(LIMITS.hazardDefaultMs);
    a.send(hazard("evt-0002"));
    expect((await a.next("error")).error).toBe("leader_only");
    await b.none("event");
  });

  it("retract goes out immediately, and a retracted id is never resurrected", async () => {
    const { lead, f1, id } = await convoyOfThree();
    const [l, f] = [await connect(lead, id), await connect(f1, id)];
    l.send(hazard("evt-0001"));
    await f.next("event");
    l.send({ type: "publish", event: { eventId: "evt-0001", type: "bump", action: "retract", observedAtMs: Date.now() } });
    expect((await f.next("event")).event).toMatchObject({ eventId: "evt-0001", action: "retract", anchor: null, seq: 2 });
    l.send(hazard("evt-0001"));                                                                            // reordered / duplicate
    expect((await l.next("ack")).status).toBe("sent");
    expect((await l.next("ack")).status).toBe("retracted");
    expect((await l.next("ack")).status).toBe("duplicate");
    await f.none("event");
    // a retraction that arrives before its hazard leaves a tombstone, so the late hazard is dropped
    l.send({ type: "publish", event: { eventId: "evt-0009", type: "gravel", action: "retract", observedAtMs: Date.now() } });
    await f.next("event");
    l.send(hazard("evt-0009", { type: "gravel" }));
    expect((await l.next("ack")).status).toBe("retracted");
    expect((await l.next("ack")).status).toBe("duplicate");
  });

  it("rejects malformed events: unknown fields, bad numbers, unknown kinds, missing anchors", async () => {
    const base = { eventId: "evt-0001", type: "bump", action: "hazard", observedAtMs: 1, anchor: { lat: 1, lon: 2 } };
    expect(parseEvent(base)).not.toBeNull();
    expect(parseEvent({ ...base, leaderId: "me" })).toBeNull();
    expect(parseEvent({ ...base, type: "pothole_confirmed" })).toBeNull();
    expect(parseEvent({ ...base, anchor: { lat: Number.NaN, lon: 2 } })).toBeNull();
    expect(parseEvent({ ...base, anchor: { lat: 1, lon: 2, speed: 30 } })).toBeNull();
    expect(parseEvent({ ...base, anchor: undefined })).toBeNull();
    expect(parseEvent({ ...base, anchor: { lat: 1, lon: 2, direction: 2 } })).toBeNull();
    expect(parseEvent({ ...base, eventId: "x" })).toBeNull();
    expect(parseEvent({ ...base, quality: 2 })).toBeNull();
    expect(parseEvent({ ...base, action: "retract" })).toBeNull();                                         // retract carries no anchor
    expect(parseEvent({ ...base, action: "retract", anchor: null })).not.toBeNull();
  });

  it("hazard lifetime is capped at five minutes", async () => {
    const { lead, f1, id } = await convoyOfThree();
    const [l, f] = [await connect(lead, id), await connect(f1, id)];
    l.send(hazard("evt-0001", { expiresAtMs: Date.now() + 3600_000 }));
    const e = (await f.next("event")).event;
    expect(e.expiresAtMs - e.receivedAtMs).toBe(LIMITS.hazardMaxMs);
  });

  it("a reconnecting follower gets only live events newer than what it saw", async () => {
    const { lead, f1, f2, id } = await convoyOfThree();
    const l = await connect(lead, id);
    l.send(hazard("evt-0001")); await l.next("ack");
    l.send(hazard("evt-0002")); await l.next("ack");
    const late = await ticket(f2, id), c = await open(id);
    c.send({ type: "authenticate", ticket: late });
    expect((await c.next("ready")).events.map((e: Msg) => e.eventId)).toEqual(["evt-0001", "evt-0002"]);
    const again = await ticket(f1, id), d = await open(id);
    d.send({ type: "authenticate", ticket: again, epoch: 1, afterSeq: 1 });
    expect((await d.next("ready")).events.map((e: Msg) => e.eventId)).toEqual(["evt-0002"]);
  });

  it("positions go to the other members only, never into storage", async () => {
    const { lead, f1, f2, id } = await convoyOfThree();
    const [l, a, b] = [await connect(lead, id), await connect(f1, id), await connect(f2, id)];
    a.send({ type: "position", lat: 35.31, lon: -83.81, heading: 90, speedMps: 22.5, progressM: 400 });
    const [pl, pb] = [await l.next("position"), await b.next("position")];
    expect(pl).toMatchObject({ lat: 35.31, lon: -83.81, heading: 90, speedMps: 22.5, progressM: 400 });
    expect(pb.key).toBe(pl.key);
    await a.none("position");
    a.send({ type: "position", lat: 35.32, lon: -83.82 });                                                 // too soon after the last: dropped
    await l.none("position");
    a.send({ type: "position", lat: 200, lon: 0 });
    expect((await a.next("error")).error).toBe("bad_position");
    const t = await ticket(lead, id), late = await open(id);                                               // snapshot for a fresh socket
    late.send({ type: "authenticate", ticket: t });
    expect((await late.next("ready")).positions).toMatchObject([{ lat: 35.31, lon: -83.81, speedMps: 22.5 }]);
    const stub = env.CONVOY.get(env.CONVOY.idFromName(id));
    const stored = await runInDurableObject(stub, async (_i, state) => JSON.stringify([...(await state.storage.list()).entries()]));
    expect(stored).not.toContain("35.31");
    expect(stored).not.toContain("evt-");
    expect(stored).not.toContain(lead.token);
  });

  it("the leader shares a route and a regroup point; both reach late joiners", async () => {
    const { lead, f1, id } = await convoyOfThree();
    const l = await connect(lead, id), f = await connect(f1, id);
    l.send({ type: "route", route: { name: "Tail of the Dragon", polyline: "_p~iF~ps|U_ulLnnqC", version: 3 } });
    expect((await f.next("route")).route).toMatchObject({ name: "Tail of the Dragon", version: 3 });
    l.send({ type: "regroup", at: { lat: 35.46, lon: -83.92, note: "Deals Gap" } });
    expect((await f.next("regroup")).regroup).toMatchObject({ note: "Deals Gap" });
    f.send({ type: "route", route: null });
    expect((await f.next("error")).error).toBe("leader_only");
    const t = await ticket(f1, id), g = await open(id);
    g.send({ type: "authenticate", ticket: t });
    const ready = await g.next("ready");
    expect(ready.route.name).toBe("Tail of the Dragon");
    expect(ready.regroup.note).toBe("Deals Gap");
    l.send({ type: "route", route: { name: "x", polyline: "has spaces", version: 1 } });
    expect((await l.next("error")).error).toBe("bad_route");
  });

  it("bounds: oversized and binary frames close, floods close", async () => {
    const { f1, id } = await convoyOfThree();
    const big = await connect(f1, id);
    big.send("x".repeat(LIMITS.frameBytes + 1));
    expect((await closedWith(big))?.code).toBe(4413);
    const flood = await connect(f1, id);
    for (let i = 0; i <= LIMITS.framesPerS; i++) flood.send({ type: "ping" });
    expect((await closedWith(flood))?.code).toBe(4429);
  });

  it("an actor restart starts a new epoch: old sockets and tickets are gone, events are not rebuilt", async () => {
    const { lead, f1, id } = await convoyOfThree();
    const l = await connect(lead, id);
    l.send(hazard("evt-0001")); await l.next("ack");
    const stale = await ticket(f1, id);
    l.ws.close(1000, "bye");
    await evictDurableObject(stub(id));
    const c = await open(id);
    c.send({ type: "authenticate", ticket: stale });
    expect((await closedWith(c))?.reason).toBe("bad_ticket");
    const f = await open(id);
    f.send({ type: "authenticate", ticket: await ticket(f1, id), epoch: 1, afterSeq: 0 });
    const ready = await f.next("ready");
    expect(ready.context.leaderEpoch).toBe(2);
    expect(ready.events).toEqual([]);
    expect(ready.context.members.length).toBe(3);
  });
});
