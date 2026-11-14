// Convoy voice (src/convoy_voice.ts): only members with the convoy open go on the channel, the Realtime token stays on
// the Worker, and everyone in the convoy hears who is on, off and muted.
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, api, freshDb, makeUser, ok, type TestUser } from "./helpers";

beforeEach(freshDb);
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

type Msg = Record<string, any>;
const json = async (r: Promise<Response>) => (await (await ok(r)).json()) as Msg;
const OFFER = { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n" };
const ANSWER = { type: "answer", sdp: "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n" };

interface Call { url: string; method: string; auth: string | null; body: any }
let calls: Call[] = [], nextSession = 0, sfuDown = false;
function fakeSfu() {
  calls = []; nextSession = 0; sfuDown = false;
  globalThis.fetch = (async (input: RequestInfo | URL, o?: RequestInit) => {
    const url = String(input), body = o?.body ? JSON.parse(String(o.body)) : null;
    calls.push({ url, method: o?.method || "GET", auth: new Headers(o?.headers).get("authorization"), body });
    if (!url.startsWith("https://rtc.live.cloudflare.com/v1/apps/test-app/")) return new Response("no", { status: 404 });
    if (sfuDown) return Response.json({ errorCode: "internal" }, { status: 500 });
    if (url.endsWith("/sessions/new")) return Response.json({ sessionId: `sess${++nextSession}` });
    if (url.endsWith("/tracks/new") && body.tracks[0].location === "local") return Response.json({ sessionDescription: { type: "answer", sdp: "v=0 sfu" }, tracks: [{ mid: body.tracks[0].mid, trackName: "mic" }] });
    if (url.endsWith("/tracks/new")) {
      return Response.json({ requiresImmediateRenegotiation: true, sessionDescription: { type: "offer", sdp: "v=0 pull" },
        tracks: body.tracks.map((t: any, i: number) => ({ mid: String(i + 1), trackName: t.trackName, sessionId: t.sessionId })) });
    }
    if (url.endsWith("/renegotiate")) return Response.json({});
    return new Response("?", { status: 404 });
  }) as typeof fetch;
}

let ipSeq = 0;
async function connect(u: TestUser, id: string) {
  const t = (await json(api(u, "POST", `/api/convoy/${id}/ticket`))).ticket as string;
  const res = await exports.default.fetch(new Request(`${ORIGIN}/api/convoy/${id}/connect`, { headers: { upgrade: "websocket", origin: ORIGIN, "cf-connecting-ip": `10.1.0.${++ipSeq % 250}` } }));
  const ws = res.webSocket!; ws.accept();
  const inbox: Msg[] = [];
  ws.addEventListener("message", (e) => { inbox.push(JSON.parse(e.data as string)); });
  const next = async (type: string, ms = 1000) => {
    const end = Date.now() + ms;
    for (;;) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0];
      if (Date.now() > end) throw new Error(`no ${type}; have ${JSON.stringify(inbox)}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  ws.send(JSON.stringify({ type: "authenticate", ticket: t }));
  const ready = await next("ready");
  return { ws, inbox, next, ready, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}
async function convoyOf2() {
  const a = await makeUser("lead"), b = await makeUser("follow");
  const made = await json(api(a, "POST", "/api/convoy", { consent: true, name: "Run" }));
  const id = made.context.sessionId as string;
  await json(api(b, "POST", "/api/convoy/join", { consent: true, invite: made.invite }));
  return { a, b, id };
}

describe("convoy voice", () => {
  beforeEach(fakeSfu);

  it("puts a connected member on the channel, tells the others, and lets them listen", async () => {
    const { a, b, id } = await convoyOf2();
    const ca = await connect(a, id), cb = await connect(b, id);
    expect(ca.ready.context.voiceReady).toBe(true);
    expect(ca.ready.context.voice).toEqual([]);

    const on = await json(api(a, "POST", `/api/convoy/${id}/voice`, { sdp: OFFER, mid: "0" }));
    expect(on.sdp).toEqual({ type: "answer", sdp: "v=0 sfu" });
    expect(on.voice).toEqual([]);
    expect(calls.every((c) => c.auth === "Bearer test-token")).toBe(true);
    expect(calls[1].body).toEqual({ sessionDescription: OFFER, tracks: [{ location: "local", mid: "0", trackName: "mic" }] });
    const told = await cb.next("voice");
    expect(told).toMatchObject({ key: ca.ready.context.you, on: true, muted: false, joined: true });
    expect(JSON.stringify(told)).not.toContain("sess");                       // session ids never go to the convoy

    const onB = await json(api(b, "POST", `/api/convoy/${id}/voice`, { sdp: OFFER, mid: "0" }));
    expect(onB.voice).toEqual([{ key: ca.ready.context.you, muted: false }]);
    const pull = await json(api(b, "POST", `/api/convoy/${id}/voice/pull`, { keys: [ca.ready.context.you, cb.ready.context.you, "nobodyhere"] }));
    expect(pull.sdp).toEqual({ type: "offer", sdp: "v=0 pull" });
    expect(pull.tracks).toEqual([{ key: ca.ready.context.you, mid: "1" }]);   // not themselves, not a stranger
    const pullCall = calls.find((c) => c.url.endsWith("sess2/tracks/new") && c.body.tracks[0].location === "remote")!;
    expect(pullCall.body.tracks).toEqual([{ location: "remote", sessionId: "sess1", trackName: "mic" }]);
    await ok(api(b, "PUT", `/api/convoy/${id}/voice/answer`, { sdp: ANSWER }));
    expect(calls.at(-1)).toMatchObject({ method: "PUT", url: expect.stringContaining("sessions/sess2/renegotiate"), body: { sessionDescription: ANSWER } });
  });

  it("relays mute, and takes a member off when they hang up or drop off the convoy's link", async () => {
    const { a, b, id } = await convoyOf2();
    const ca = await connect(a, id), cb = await connect(b, id);
    await json(api(a, "POST", `/api/convoy/${id}/voice`, { sdp: OFFER, mid: "0" }));
    await cb.next("voice");
    ca.send({ type: "voice", muted: true });
    expect(await cb.next("voice")).toMatchObject({ key: ca.ready.context.you, on: true, muted: true });
    await ok(api(a, "DELETE", `/api/convoy/${id}/voice`));
    expect(await cb.next("voice")).toMatchObject({ key: ca.ready.context.you, on: false });

    await json(api(a, "POST", `/api/convoy/${id}/voice`, { sdp: OFFER, mid: "0" }));
    await cb.next("voice");
    ca.ws.close(1000, "bye");
    expect(await cb.next("voice")).toMatchObject({ key: ca.ready.context.you, on: false });
    const again = await connect(a, id);
    expect(again.ready.context.voice).toEqual([]);
  });

  it("refuses outsiders, members without the convoy open, and bad requests", async () => {
    const { a, b, id } = await convoyOf2();
    const stranger = await makeUser("stranger");
    expect((await api(stranger, "POST", `/api/convoy/${id}/voice`, { sdp: OFFER, mid: "0" })).status).toBe(404);
    expect((await api(a, "POST", `/api/convoy/${id}/voice`, { sdp: OFFER, mid: "0" })).status).toBe(409);   // no socket open
    await connect(a, id);
    expect((await api(a, "POST", `/api/convoy/${id}/voice`, { sdp: { type: "answer", sdp: "v=0 xxxxxxxx" }, mid: "0" })).status).toBe(400);
    expect((await api(a, "POST", `/api/convoy/${id}/voice`, { sdp: OFFER, mid: "<x>" })).status).toBe(400);
    expect((await api(b, "POST", `/api/convoy/${id}/voice/pull`, { keys: ["abcdefgh"] })).status).toBe(409);   // not on the channel
    expect((await api(a, "POST", `/api/convoy/${id}/voice/pull`, { keys: [] })).status).toBe(400);
    expect(calls).toEqual([]);                                                // nothing reached the SFU
    sfuDown = true;
    expect((await api(a, "POST", `/api/convoy/${id}/voice`, { sdp: OFFER, mid: "0" })).status).toBe(502);
  });
});
