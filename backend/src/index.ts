// ApexNav API Worker. Static files are served by Cloudflare's asset layer; only /api/* reaches this code
// (wrangler.jsonc: assets.run_worker_first). Phones never talk to the database directly.
import {
  csrfCheck, createInvite, googleCallback, googleStart, logout, redeemInvite, requireMember, requireUser, viewer,
} from "./auth";
import { Env, HttpError, json } from "./util";
import {
  blockUser, boardFor, crewCreate, crewInvite, crewJoin, crewLeave, crewList, friendAccept, friendList, friendRequest,
  myGrants, publish, removePair, setGrant, setHandle,
} from "./social";
import { deleteAccount, exportMyData } from "./account";
import { contribute, setContribute } from "./contribute";
import { nightlyMerge, pointsFor } from "./nightly";
import { roadBins } from "./roads";
import { highlightCreate, highlightDelete, highlightList, highlightRate, highlightReport } from "./highlights";
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

on("GET", "/api/me", async (req, env) => {
  const v = await viewer(req, env);
  return v ? json({ signed_in: true, id: v.id, handle: v.handle, name: v.displayName, member: v.member }) : json({ signed_in: false });
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
on("POST", "/api/crews/join", async (req, env) => json(await crewJoin(env, await requireMember(req, env), req)));
on("POST", "/api/crews/:id/invite", async (req, env, m) => json(await crewInvite(env, await requireMember(req, env), m.groups!.id), 201));
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

export default {
  /** Cron trigger (wrangler.jsonc "triggers"): rank, merge and score the staged contributions. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(nightlyMerge(env));
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);
      for (const [method, re, handler] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) {
          csrfCheck(req, env);
          return await handler(req, env, m);
        }
      }
      if (routes.some(([, re]) => re.test(url.pathname))) throw new HttpError(405, "method_not_allowed");
      throw new HttpError(404, "not_found");
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "server_error" }, 500);
    }
  },
};
