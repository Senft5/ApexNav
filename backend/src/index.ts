// ApexNav API Worker. Static files are served by Cloudflare's asset layer; only /api/* reaches this code
// (wrangler.jsonc: assets.run_worker_first). Phones never talk to the database directly.
import {
  APP_ORIGIN, appExchange, csrfCheck, createInvite, googleCallback, googleStart, logout, redeemInvite, requireMember, requireUser, sessionHash, viewer,
} from "./auth";
import { convoyConnect, convoyCreate, convoyJoin, convoyRoom, unwrap } from "./convoy_routes";
import { Env, HttpError, body, json, str } from "./util";
import { rateCheck } from "./ratelimit";
import {
  blockUser, boardFor, crewCreate, crewDiscover, crewInvite, crewJoin, crewJoinPublic, crewLeave, crewList, crewMembers, crewUpdate, friendAccept, friendList, friendRequest,
  myGrants, publish, removePair, setGrant, setHandle,
} from "./social";
import { deleteAccount, exportMyData } from "./account";
import { contribute, setContribute } from "./contribute";
import { pointsFor } from "./points";
import { roadBins } from "./roads";
import { highlightCreate, highlightDelete, highlightList, highlightRate, highlightReport } from "./highlights";
export { ConvoyIndex, ConvoyRoom } from "./convoy";
import { segmentAdopt, segmentCreate, segmentDelete, segmentList, segmentShare, segmentsSharedWithMe } from "./segments";

type Handler = (req: Request, env: Env, m: RegExpMatchArray) => Promise<Response>;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), h]);
const noContent = () => new Response(null, { status: 204 });

on("GET", "/api/health", async () => json({ ok: true }));
on("GET", "/api/auth/google/start", (req, env) => googleStart(req, env));
on("GET", "/api/auth/google/callback", (req, env) => googleCallback(req, env));
on("POST", "/api/auth/logout", (req, env) => logout(req, env));
on("POST", "/api/auth/app/exchange", (req, env) => appExchange(req, env));

on("GET", "/api/me", async (req, env) => {
  const v = await viewer(req, env);
  if (!v) return json({ signed_in: false });
  // incoming friend requests: lets the app show a badge on the Crew tab without a second call
  const waiting = v.member ? await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM friendships WHERE status = 'pending' AND requested_by != ?1 AND (user_a = ?1 OR user_b = ?1)").bind(v.id).first<{ n: number }>() : null;
  return json({ signed_in: true, id: v.id, handle: v.handle, name: v.displayName, member: v.member, requests: waiting?.n ?? 0 });
});
on("POST", "/api/invites/redeem", async (req, env) => { await redeemInvite(env, await requireUser(req, env), req); return noContent(); });
on("POST", "/api/invites", async (req, env) => json(await createInvite(env, await requireMember(req, env), req), 201));
on("GET", "/api/me/export", async (req, env) => json(await exportMyData(env, await requireMember(req, env))));
on("DELETE", "/api/me", async (req, env) => deleteAccount(env, await requireMember(req, env), req));
on("PUT", "/api/me/handle", async (req, env) => { await setHandle(env, await requireMember(req, env), req); return noContent(); });

on("PUT", "/api/me/contribute", async (req, env) => { await setContribute(env, await requireMember(req, env), req); return noContent(); });
on("POST", "/api/contribute", async (req, env) => json(await contribute(env, await requireMember(req, env), req), 202));

on("GET", "/api/roads", async (req, env) => { await requireMember(req, env); return json(await roadBins(env, new URL(req.url))); });
on("GET", "/api/points", async (req, env) => json(await pointsFor(env, (await requireMember(req, env)).id)));

on("POST", "/api/friends/request", async (req, env) => { await friendRequest(env, await requireMember(req, env), req); return json({ ok: true }, 202); });
on("GET", "/api/friends", async (req, env) => json(await friendList(env, await requireMember(req, env))));
on("POST", "/api/friends/accept", async (req, env) => { await friendAccept(env, await requireMember(req, env), req); return noContent(); });
on("DELETE", "/api/friends/:id", async (req, env, m) => { await removePair(env, (await requireMember(req, env)).id, m.groups!.id); return noContent(); });
on("POST", "/api/blocks", async (req, env) => { await blockUser(env, await requireMember(req, env), req); return noContent(); });

on("POST", "/api/crews", async (req, env) => json(await crewCreate(env, await requireMember(req, env), req), 201));
on("GET", "/api/crews", async (req, env) => json(await crewList(env, await requireMember(req, env))));
on("GET", "/api/crews/:id/members", async (req, env, m) => json(await crewMembers(env, await requireMember(req, env), m.groups!.id)));
on("POST", "/api/crews/join", async (req, env) => json(await crewJoin(env, await requireMember(req, env), req)));
on("POST", "/api/crews/:id/invite", async (req, env, m) => json(await crewInvite(env, await requireMember(req, env), m.groups!.id), 201));
on("GET", "/api/crews/discover", async (req, env) => json(await crewDiscover(env, await requireMember(req, env), new URL(req.url))));
on("PUT", "/api/crews/:id", async (req, env, m) => { await crewUpdate(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("POST", "/api/crews/:id/join", async (req, env, m) => json(await crewJoinPublic(env, await requireMember(req, env), m.groups!.id)));
on("DELETE", "/api/crews/:id/membership", async (req, env, m) => { await crewLeave(env, await requireMember(req, env), m.groups!.id); return noContent(); });

on("GET", "/api/grants", async (req, env) => json(await myGrants(env, await requireMember(req, env))));
on("PUT", "/api/grants", async (req, env) => { await setGrant(env, await requireMember(req, env), req); return noContent(); });

on("POST", "/api/segments", async (req, env) => json(await segmentCreate(env, await requireMember(req, env), req), 201));
on("GET", "/api/segments", async (req, env) => json(await segmentList(env, await requireMember(req, env))));
on("GET", "/api/segments/shared", async (req, env) => json(await segmentsSharedWithMe(env, await requireMember(req, env))));
on("POST", "/api/segments/adopt", async (req, env) => json(await segmentAdopt(env, await requireMember(req, env), req), 201));
on("DELETE", "/api/segments/:id", async (req, env, m) => { await segmentDelete(env, await requireMember(req, env), m.groups!.id); return noContent(); });
on("POST", "/api/segments/:id/share", async (req, env, m) => { await segmentShare(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });

on("POST", "/api/highlights", async (req, env) => json(await highlightCreate(env, await requireMember(req, env), req), 201));
on("GET", "/api/highlights", async (req, env) => json(await highlightList(env, await requireMember(req, env), new URL(req.url))));
on("POST", "/api/highlights/:id/rating", async (req, env, m) => { await highlightRate(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("POST", "/api/highlights/:id/report", async (req, env, m) => { await highlightReport(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("DELETE", "/api/highlights/:id", async (req, env, m) => { await highlightDelete(env, await requireMember(req, env), m.groups!.id); return noContent(); });

on("POST", "/api/board", async (req, env) => json(await publish(env, await requireMember(req, env), req)));
on("GET", "/api/board/:canon", async (req, env, m) => json(await boardFor(env, await requireMember(req, env), m.groups!.canon)));

on("POST", "/api/convoy", async (req, env) => json(await convoyCreate(env, await requireMember(req, env), req), 201));
on("POST", "/api/convoy/join", async (req, env) => json(await convoyJoin(env, await requireMember(req, env), req)));
on("GET", "/api/convoy/:id", async (req, env, m) => json(await convoyRoom(env, m.groups!.id).status((await requireMember(req, env)).id).then(unwrap)));
on("POST", "/api/convoy/:id/invite", async (req, env, m) => json(await convoyRoom(env, m.groups!.id).newInvite((await requireMember(req, env)).id).then(unwrap), 201));
on("POST", "/api/convoy/:id/ticket", async (req, env, m) => {
  const v = await requireMember(req, env);
  return json(await convoyRoom(env, m.groups!.id).ticket(v.id, (await sessionHash(req))!).then(unwrap), 201);
});
on("POST", "/api/convoy/:id/leave", async (req, env, m) => json(await convoyRoom(env, m.groups!.id).leave((await requireMember(req, env)).id).then(unwrap)));
on("POST", "/api/convoy/:id/remove", async (req, env, m) => {
  const v = await requireMember(req, env), { member } = await body<{ member?: unknown }>(req);
  await convoyRoom(env, m.groups!.id).remove(v.id, str(member, "member", 1, 20)).then(unwrap);
  return noContent();
});
// No sign-in check here on purpose: the socket's first frame carries a single-use ticket minted by POST .../ticket.
on("GET", "/api/convoy/:id/connect", async (req, env, m) => convoyConnect(req, env, m.groups!.id));

// CORS for the iOS shell only (pages at apexnav://app call this Worker cross-origin with a bearer token).
// No credentials: cookies never cross; any other origin gets no CORS headers at all.
const APP_CORS: Record<string, string> = {
  "access-control-allow-origin": APP_ORIGIN, "access-control-allow-methods": "GET, POST, PUT, DELETE",
  "access-control-allow-headers": "authorization, content-type, x-apexnav", "access-control-max-age": "600", vary: "Origin",
};
function withAppCors(res: Response): Response {
  if (res.status === 101 || res.webSocket) return res;   // a socket upgrade: CORS does not apply, and a 101 cannot be rebuilt
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(APP_CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const fromApp = req.headers.get("origin") === APP_ORIGIN;
    if (req.method === "OPTIONS") return fromApp ? new Response(null, { status: 204, headers: APP_CORS }) : new Response(null, { status: 405 });
    const res = await handle(req, env);
    return fromApp ? withAppCors(res) : res;
  },
};

async function handle(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);
      for (const [method, re, handler] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) {
          csrfCheck(req, env);
          await rateCheck(req, env, url.pathname);
          return await handler(req, env, m);
        }
      }
      if (routes.some(([, re]) => re.test(url.pathname))) throw new HttpError(405, "method_not_allowed");
      throw new HttpError(404, "not_found");
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, e.status === 429 ? { "retry-after": "60" } : {});
      console.error(e);
      return json({ error: "server_error" }, 500);
    }
}
