// ApexNav API Worker. Static files are served by Cloudflare's asset layer; only /api/* reaches this code
// (wrangler.jsonc: assets.run_worker_first). Phones never talk to the database directly.
import {
  APP_ORIGIN, appExchange, csrfCheck, createInvite, googleCallback, googleStart, logout, redeemInvite, requireMember, requireUser, sessionHash, viewer,
} from "./auth";
import { convoyAccept, convoyConnect, convoyCreate, convoyDismiss, convoyInvitePeople, convoyInvites, convoyJoin, convoyPreview, convoyRoom, unwrap } from "./convoy_routes";
import { Env, HttpError, body, json, str } from "./util";
import { rateCheck } from "./ratelimit";
import { clientError, errorSummary, serverError } from "./errors";
import { backupDatabase } from "./backup";
import { sweepExpired } from "./sweep";
import { appleSignIn } from "./apple";
import { hazardsNear, reportHazard, voteHazard } from "./hazards";
import { routeDelete, routeGet, routesSharedWithMe, shareRoute } from "./routes_shared";

const BACKUP_CRON = "0 7 * * 1";   // wrangler.jsonc triggers; the other cron is the daily sweep
import {
  boardActivity, boardFor, crewCreate, crewDiscover, crewInvite, crewInvitePreview, crewInvitesRevoke, crewJoin, crewJoinPublic, crewLeave, crewList, crewMembers, crewUpdate, friendAccept, friendList, friendRequest, friendRequestCancel,
  myGrants, publish, removePair, setGrant, setHandle,
} from "./social";
import { deleteAccount, exportMyData } from "./account";
import { carCreate, carDelete, carUpdate, myCars, peoplesCars } from "./garage";
import { chatDelete, chatList, chatPost, crewPage, crewPageUpdate } from "./crew_page";
import { decalsPlace } from "./livery";
import { presencePublish, presenceSettingsGet, presenceSettingsPut, presenceView } from "./presence";
import { buildCreate, buildDelete, buildFind, buildFollow, buildGet, buildUpdate, buildsFollowing, postCreate, postDelete, replyCreate, replyDelete, replyTried } from "./builds";
import { photoDelete, photoList, photoServe, photoUpload, photoUse } from "./photos";
import { block, blockList, fileReport, isModerator, moderationQueue, moderationResolve, report, unblock } from "./safety";
import { contribute, setContribute } from "./contribute";
import { pointsFor } from "./points";
import { redeem, shop } from "./redeem";
import { flagsFor } from "./flags";
import { coverage, exportRoads, roadBins } from "./roads";
import { crewStandings } from "./standings";
import { eventCancel, eventCreate, eventRole, eventRsvp, eventsList, eventsNear } from "./events";
import { healthReport, healthSummary } from "./health";
import { feedbackCreate, feedbackDone, feedbackList } from "./feedback";
import { friendProfile } from "./profile";
import { kudosGive, kudosReceived, kudosTake } from "./kudos";
import { STATS_SAMPLE, recordStat, statsSummary } from "./stats";
import { etaStart, etaUpdate, etaView } from "./eta_share";
import { highlightCreate, highlightDelete, highlightList, highlightRate } from "./highlights";
export { ConvoyIndex, ConvoyRoom } from "./convoy";
import { segmentAdopt, segmentCreate, segmentDelete, segmentList, segmentShare, segmentsSharedWithMe } from "./segments";

type Handler = (req: Request, env: Env, m: RegExpMatchArray) => Promise<Response>;
const routes: [string, RegExp, Handler, string][] = [];
const on = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), h, `${method} ${path}`]);
const noContent = () => new Response(null, { status: 204 });

// Status checks (tools/status_check.py, IDEAS Y-05): one trivial read proves the database answers, not just the Worker.
on("GET", "/api/health", async (_req, env) => {
  try { await env.DB.prepare("SELECT 1").first(); return json({ ok: true, db: true }); }
  catch (e) { console.error(JSON.stringify({ event: "health_db_failed", error: String(e) })); return json({ ok: false, db: false }, 503); }
});
// Anonymous crash reports (web/errors.js): scrubbed, logged and counted per day (no person in it). Rate limited per IP like any signed-out write.
on("POST", "/api/errors", async (req, env) => { await clientError(req, env); return noContent(); });
// Anonymous app health counts (web/health.js, IDEAS Y-03): yesterday's totals, once a day, no session read.
on("POST", "/api/app-health", async (req, env) => { await healthReport(req, env); return noContent(); });
on("GET", "/api/ops/app-health", async (req, env) => {
  if (!isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  return json(await healthSummary(env, new URL(req.url)));
});
// Feedback (IDEAS L-05): anyone may send it; the owner reads it.
on("POST", "/api/feedback", async (req, env) => json(await feedbackCreate(req, env, await viewer(req, env)), 201));
on("GET", "/api/ops/feedback", async (req, env) => {
  if (!isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  return json(await feedbackList(env));
});
on("POST", "/api/ops/feedback/:id/done", async (req, env, m) => {
  if (!isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  await feedbackDone(env, m.groups!.id);
  return noContent();
});
on("GET", "/api/ops/latency", async (req, env) => {
  if (!isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  return json(await statsSummary(env, new URL(req.url)));
});
on("GET", "/api/ops/errors", async (req, env) => {
  if (!isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  return json(await errorSummary(env, new URL(req.url)));
});
on("GET", "/api/auth/google/start", (req, env) => googleStart(req, env));
on("GET", "/api/auth/google/callback", (req, env) => googleCallback(req, env));
on("POST", "/api/auth/logout", (req, env) => logout(req, env));
on("POST", "/api/auth/app/exchange", (req, env) => appExchange(req, env));
on("POST", "/api/auth/apple", (req, env) => appleSignIn(req, env));

on("GET", "/api/me", async (req, env) => {
  const v = await viewer(req, env);
  if (!v) return json({ signed_in: false });
  // incoming friend requests: lets the app show a badge on the Crew tab without a second call
  const waiting = v.member ? await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM friendships WHERE status = 'pending' AND requested_by != ?1 AND (user_a = ?1 OR user_b = ?1)").bind(v.id).first<{ n: number }>() : null;
  const photo = v.member ? await env.DB.prepare("SELECT photo_id FROM users WHERE id = ?").bind(v.id).first<{ photo_id: string | null }>() : null;
  return json({ signed_in: true, id: v.id, handle: v.handle, name: v.displayName, member: v.member, requests: waiting?.n ?? 0, photo_id: photo?.photo_id ?? null,
               ...(v.member && isModerator(env, v) ? { moderator: true } : {}) });
});
on("POST", "/api/invites/redeem", async (req, env) => { await redeemInvite(env, await requireUser(req, env), req); return noContent(); });
on("POST", "/api/invites", async (req, env) => json(await createInvite(env, await requireMember(req, env), req), 201));
// Signed in is enough to take your data or close your account, member or not (someone removed by the owner keeps both rights).
on("GET", "/api/me/export", async (req, env) => json(await exportMyData(env, await requireUser(req, env))));
on("DELETE", "/api/me", async (req, env) => deleteAccount(env, await requireUser(req, env), req));
on("PUT", "/api/me/handle", async (req, env) => { await setHandle(env, await requireMember(req, env), req); return noContent(); });

on("PUT", "/api/me/contribute", async (req, env) => { await setContribute(env, await requireMember(req, env), req); return noContent(); });
on("POST", "/api/contribute", async (req, env) => json(await contribute(env, await requireMember(req, env), req), 202));

on("GET", "/api/roads", async (req, env) => { await requireMember(req, env); return json(await roadBins(env, new URL(req.url))); });
on("GET", "/api/coverage", async (req, env) => { await requireMember(req, env); return json(await coverage(env, new URL(req.url))); });
// The road-data export (docs/ROAD_DATA.md): the owner only, for a pilot; anyone else gets a plain 404.
on("GET", "/api/ops/roads.geojson", async (req, env) => {
  if (!isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  return json(await exportRoads(env, new URL(req.url)));
});
on("GET", "/api/points", async (req, env) => json(await pointsFor(env, (await requireMember(req, env)).id)));
on("GET", "/api/flags", async (req, env) => json(await flagsFor(env, req)));
on("GET", "/api/shop", async (req, env) => json(await shop(env, await requireMember(req, env))));
on("POST", "/api/redeem", async (req, env) => json(await redeem(env, await requireMember(req, env), req)));

on("POST", "/api/friends/request", async (req, env) => { await friendRequest(env, await requireMember(req, env), req); return json({ ok: true }, 202); });
on("POST", "/api/friends/request/cancel", async (req, env) => { await friendRequestCancel(env, await requireMember(req, env), req); return noContent(); });
on("GET", "/api/friends", async (req, env) => json(await friendList(env, await requireMember(req, env))));
on("POST", "/api/friends/accept", async (req, env) => { await friendAccept(env, await requireMember(req, env), req); return noContent(); });
on("DELETE", "/api/friends/:id", async (req, env, m) => { await removePair(env, (await requireMember(req, env)).id, m.groups!.id); return noContent(); });
on("GET", "/api/friends/:id/profile", async (req, env, m) => json(await friendProfile(env, await requireMember(req, env), m.groups!.id)));
on("POST", "/api/blocks", async (req, env) => { await block(env, await requireMember(req, env), req); return noContent(); });
on("GET", "/api/blocks", async (req, env) => json(await blockList(env, await requireMember(req, env))));
on("DELETE", "/api/blocks/:handle", async (req, env, m) => { await unblock(env, await requireMember(req, env), m.groups!.handle); return noContent(); });
on("POST", "/api/reports", async (req, env) => { await report(env, await requireMember(req, env), req); return noContent(); });
on("GET", "/api/moderation", async (req, env) => json(await moderationQueue(env, await requireMember(req, env))));
on("POST", "/api/moderation/resolve", async (req, env) => { await moderationResolve(env, await requireMember(req, env), req); return noContent(); });

on("POST", "/api/crews", async (req, env) => json(await crewCreate(env, await requireMember(req, env), req), 201));
on("GET", "/api/crews", async (req, env) => json(await crewList(env, await requireMember(req, env))));
on("GET", "/api/crews/:id/events", async (req, env, m) => json(await eventsList(env, await requireMember(req, env), m.groups!.id)));
on("POST", "/api/crews/:id/events", async (req, env, m) => json(await eventCreate(env, await requireMember(req, env), m.groups!.id, req), 201));
// Share your ETA (IDEAS S-19): the driver starts and refreshes it; anyone with the link reads it, signed out.
on("POST", "/api/eta", async (req, env) => json(await etaStart(env, await requireMember(req, env), req), 201));
on("PUT", "/api/eta/:token", async (req, env, m) => { await etaUpdate(env, await requireMember(req, env), m.groups!.token, req); return noContent(); });
on("GET", "/api/eta/:token", async (_req, env, m) => json(await etaView(env, m.groups!.token)));
on("GET", "/api/events/near", async (req, env) => json(await eventsNear(env, await requireMember(req, env), new URL(req.url))));
on("GET", "/api/events", async (req, env) => json(await eventsList(env, await requireMember(req, env), null)));
on("POST", "/api/events/:id/rsvp", async (req, env, m) => { await eventRsvp(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("POST", "/api/events/:id/role", async (req, env, m) => { await eventRole(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("DELETE", "/api/events/:id", async (req, env, m) => { await eventCancel(env, await requireMember(req, env), m.groups!.id); return noContent(); });
// the crew page (src/crew_page.ts, REVIEW.md roadmap 20)
on("GET", "/api/crews/:id/page", async (req, env, m) => json(await crewPage(env, await requireMember(req, env), m.groups!.id)));
on("PUT", "/api/crews/:id/page", async (req, env, m) => { await crewPageUpdate(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("PUT", "/api/crews/:id/decals", async (req, env, m) => { await decalsPlace(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("GET", "/api/crews/:id/chat", async (req, env, m) => json(await chatList(env, await requireMember(req, env), m.groups!.id, new URL(req.url))));
on("POST", "/api/crews/:id/chat", async (req, env, m) => json(await chatPost(env, await requireMember(req, env), m.groups!.id, req), 201));
on("DELETE", "/api/crews/:id/chat/:msg", async (req, env, m) => { await chatDelete(env, await requireMember(req, env), m.groups!.id, m.groups!.msg); return noContent(); });
on("GET", "/api/crews/:id/members", async (req, env, m) => json(await crewMembers(env, await requireMember(req, env), m.groups!.id)));
on("POST", "/api/crews/join", async (req, env) => json(await crewJoin(env, await requireMember(req, env), req)));
on("POST", "/api/crews/invite/preview", async (req, env) => json(await crewInvitePreview(env, await requireMember(req, env), req)));
on("POST", "/api/crews/:id/invite", async (req, env, m) => json(await crewInvite(env, await requireMember(req, env), m.groups!.id), 201));
on("DELETE", "/api/crews/:id/invites", async (req, env, m) => json(await crewInvitesRevoke(env, await requireMember(req, env), m.groups!.id)));
on("GET", "/api/crews/discover", async (req, env) => json(await crewDiscover(env, await requireMember(req, env), new URL(req.url))));
on("GET", "/api/crews/standings", async (req, env) => json(await crewStandings(env, await requireMember(req, env))));
on("PUT", "/api/crews/:id", async (req, env, m) => { await crewUpdate(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("POST", "/api/crews/:id/join", async (req, env, m) => json(await crewJoinPublic(env, await requireMember(req, env), m.groups!.id)));
on("DELETE", "/api/crews/:id/membership", async (req, env, m) => { await crewLeave(env, await requireMember(req, env), m.groups!.id); return noContent(); });

on("GET", "/api/grants", async (req, env) => json(await myGrants(env, await requireMember(req, env))));
on("PUT", "/api/grants", async (req, env) => { await setGrant(env, await requireMember(req, env), req); return noContent(); });

on("GET", "/api/garage", async (req, env) => json(await myCars(env, await requireMember(req, env))));
on("GET", "/api/garage/people", async (req, env) => json(await peoplesCars(env, await requireMember(req, env))));
on("POST", "/api/garage", async (req, env) => json(await carCreate(env, await requireMember(req, env), req), 201));
on("PUT", "/api/garage/:id", async (req, env, m) => { await carUpdate(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("DELETE", "/api/garage/:id", async (req, env, m) => { await carDelete(env, await requireMember(req, env), m.groups!.id); return noContent(); });
// build threads (src/builds.ts, REVIEW.md 5.3, roadmap 23); /following before /:id
on("GET", "/api/builds/following", async (req, env) => json(await buildsFollowing(env, await requireMember(req, env))));
on("GET", "/api/builds", async (req, env) => json(await buildFind(env, await requireMember(req, env), new URL(req.url))));
on("POST", "/api/builds", async (req, env) => json(await buildCreate(env, await requireMember(req, env), req), 201));
on("POST", "/api/builds/posts/:post/replies", async (req, env, m) => json(await replyCreate(env, await requireMember(req, env), m.groups!.post, req), 201));
on("DELETE", "/api/builds/posts/:post", async (req, env, m) => { await postDelete(env, await requireMember(req, env), m.groups!.post); return noContent(); });
on("PUT", "/api/builds/replies/:reply/tried", async (req, env, m) => { await replyTried(env, await requireMember(req, env), m.groups!.reply, req); return noContent(); });
on("DELETE", "/api/builds/replies/:reply", async (req, env, m) => { await replyDelete(env, await requireMember(req, env), m.groups!.reply); return noContent(); });
on("GET", "/api/builds/:id", async (req, env, m) => json(await buildGet(env, await requireMember(req, env), m.groups!.id)));
on("PUT", "/api/builds/:id", async (req, env, m) => { await buildUpdate(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("DELETE", "/api/builds/:id", async (req, env, m) => { await buildDelete(env, await requireMember(req, env), m.groups!.id); return noContent(); });
on("POST", "/api/builds/:id/posts", async (req, env, m) => json(await postCreate(env, await requireMember(req, env), m.groups!.id, req), 201));
on("PUT", "/api/builds/:id/follow", async (req, env, m) => { await buildFollow(env, await requireMember(req, env), m.groups!.id, true); return noContent(); });
on("DELETE", "/api/builds/:id/follow", async (req, env, m) => { await buildFollow(env, await requireMember(req, env), m.groups!.id, false); return noContent(); });
// friends on the map (src/presence.ts, REVIEW.md 5.4, roadmap 24)
on("GET", "/api/presence/settings", async (req, env) => json(await presenceSettingsGet(env, await requireMember(req, env))));
on("PUT", "/api/presence/settings", async (req, env) => { await presenceSettingsPut(env, await requireMember(req, env), req); return noContent(); });
on("GET", "/api/presence", async (req, env) => json(await presenceView(env, await requireMember(req, env))));
on("POST", "/api/presence", async (req, env) => { await presencePublish(env, await requireMember(req, env), req); return noContent(); });
// photos (src/photos.ts, REVIEW.md 5.2): JPEG in, metadata out; members only
on("POST", "/api/photos", async (req, env) => json(await photoUpload(env, await requireMember(req, env), req), 201));
on("GET", "/api/photos", async (req, env) => json(await photoList(env, await requireMember(req, env), new URL(req.url))));
on("GET", "/api/photos/:id", async (req, env, m) => photoServe(env, await requireMember(req, env), m.groups!.id));
on("PUT", "/api/photos/:id/use", async (req, env, m) => { await photoUse(env, await requireMember(req, env), m.groups!.id); return noContent(); });
on("DELETE", "/api/photos/:id", async (req, env, m) => { await photoDelete(env, await requireMember(req, env), m.groups!.id); return noContent(); });

on("POST", "/api/segments", async (req, env) => json(await segmentCreate(env, await requireMember(req, env), req), 201));
on("GET", "/api/segments", async (req, env) => json(await segmentList(env, await requireMember(req, env))));
on("GET", "/api/segments/shared", async (req, env) => json(await segmentsSharedWithMe(env, await requireMember(req, env))));
on("POST", "/api/segments/adopt", async (req, env) => json(await segmentAdopt(env, await requireMember(req, env), req), 201));
on("DELETE", "/api/segments/:id", async (req, env, m) => { await segmentDelete(env, await requireMember(req, env), m.groups!.id); return noContent(); });
on("POST", "/api/segments/:id/share", async (req, env, m) => { await segmentShare(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });

on("POST", "/api/routes", async (req, env) => json(await shareRoute(env, await requireMember(req, env), req), 201));
on("GET", "/api/routes/shared", async (req, env) => json(await routesSharedWithMe(env, await requireMember(req, env))));
on("GET", "/api/routes/:id", async (req, env, m) => json(await routeGet(env, await requireMember(req, env), m.groups!.id)));
on("DELETE", "/api/routes/:id", async (req, env, m) => json(await routeDelete(env, await requireMember(req, env), m.groups!.id)));
on("POST", "/api/hazards", async (req, env) => json(await reportHazard(env, await requireMember(req, env), req), 201));
on("GET", "/api/hazards", async (req, env) => { await requireMember(req, env); return json(await hazardsNear(env, new URL(req.url))); });
on("POST", "/api/hazards/:id/vote", async (req, env, m) => json(await voteHazard(env, await requireMember(req, env), m.groups!.id, req)));
on("POST", "/api/highlights", async (req, env) => json(await highlightCreate(env, await requireMember(req, env), req), 201));
on("GET", "/api/highlights", async (req, env) => json(await highlightList(env, await requireMember(req, env), new URL(req.url))));
on("POST", "/api/highlights/:id/rating", async (req, env, m) => { await highlightRate(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("POST", "/api/highlights/:id/report", async (req, env, m) => {   // older route: same rules as POST /api/reports
  const v = await requireMember(req, env), b = req.headers.get("content-length") === "0" ? null : await body<{ note?: unknown } | null>(req).catch(() => null);
  await fileReport(env, v, { kind: "highlight", target: m.groups!.id, reason: "other", note: b && typeof b === "object" ? b.note : undefined });
  return noContent();
});
on("DELETE", "/api/highlights/:id", async (req, env, m) => { await highlightDelete(env, await requireMember(req, env), m.groups!.id); return noContent(); });

on("POST", "/api/board", async (req, env) => json(await publish(env, await requireMember(req, env), req)));
// Kudos (IDEAS S-07): a tap of thanks on a friend's run you can see; no text.
on("POST", "/api/kudos", async (req, env) => { await kudosGive(env, await requireMember(req, env), req); return noContent(); });
on("DELETE", "/api/kudos", async (req, env) => { await kudosTake(env, await requireMember(req, env), req); return noContent(); });
on("GET", "/api/kudos", async (req, env) => json(await kudosReceived(env, await requireMember(req, env))));
on("GET", "/api/board/activity", async (req, env) => json(await boardActivity(env, await requireMember(req, env))));
on("GET", "/api/board/:canon", async (req, env, m) => json(await boardFor(env, await requireMember(req, env), m.groups!.canon)));

on("POST", "/api/convoy", async (req, env) => json(await convoyCreate(env, await requireMember(req, env), req), 201));
on("POST", "/api/convoy/join", async (req, env) => json(await convoyJoin(env, await requireMember(req, env), req)));
on("POST", "/api/convoy/preview", async (req, env) => json(await convoyPreview(env, await requireMember(req, env), req)));
on("GET", "/api/convoy/invites", async (req, env) => json(await convoyInvites(env, await requireMember(req, env))));
on("DELETE", "/api/convoy/invites/:id", async (req, env, m) => json(await convoyDismiss(env, await requireMember(req, env), m.groups!.id)));
on("GET", "/api/convoy/:id", async (req, env, m) => json(await convoyRoom(env, m.groups!.id).status((await requireMember(req, env)).id).then(unwrap)));
on("POST", "/api/convoy/:id/invite", async (req, env, m) => json(await convoyRoom(env, m.groups!.id).newInvite((await requireMember(req, env)).id).then(unwrap), 201));
on("POST", "/api/convoy/:id/ticket", async (req, env, m) => {
  const v = await requireMember(req, env);
  return json(await convoyRoom(env, m.groups!.id).ticket(v.id, (await sessionHash(req))!).then(unwrap), 201);
});
on("POST", "/api/convoy/:id/invite-people", async (req, env, m) => json(await convoyInvitePeople(env, await requireMember(req, env), m.groups!.id, req)));
on("POST", "/api/convoy/:id/accept", async (req, env, m) => json(await convoyAccept(env, await requireMember(req, env), m.groups!.id, req)));
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
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const fromApp = req.headers.get("origin") === APP_ORIGIN;
    if (req.method === "OPTIONS") return fromApp ? new Response(null, { status: 204, headers: APP_CORS }) : new Response(null, { status: 405 });
    const t0 = Date.now(), seen = { route: "" };
    const res = await handle(req, env, seen);
    // latency and error rates (IDEAS Y-17): sampled, 5xx always; written after the response
    const sampled = Math.random() < 1 / STATS_SAMPLE;
    if (ctx && (sampled || res.status >= 500)) ctx.waitUntil(recordStat(env, seen.route || "(none)", res.status, Date.now() - t0, sampled ? STATS_SAMPLE : 0));
    return fromApp ? withAppCors(res) : res;
  },
  // Cron triggers (wrangler.jsonc triggers): the weekly database backup, and the daily sweep of expired rows.
  async scheduled(ctrl: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (ctrl.cron === BACKUP_CRON) {
      ctx.waitUntil(backupDatabase(env).catch((e) => console.error(JSON.stringify({ event: "backup_failed", reason: String(e) }))));
    } else {
      ctx.waitUntil(sweepExpired(env).catch((e) => console.error(JSON.stringify({ event: "sweep_failed", reason: String(e) }))));
    }
  },
};

async function handle(req: Request, env: Env, seen: { route: string } = { route: "" }): Promise<Response> {
    let route = "";
    try {
      const url = new URL(req.url);
      for (const [method, re, handler, name] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) {
          route = name; seen.route = `${method} ${name}`;
          csrfCheck(req, env);
          await rateCheck(req, env, url.pathname);
          return await handler(req, env, m);
        }
      }
      if (routes.some(([, re]) => re.test(url.pathname))) throw new HttpError(405, "method_not_allowed");
      throw new HttpError(404, "not_found");
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, e.message === "rate_limited" ? { "retry-after": "60" } : {});
      console.error(e);
      await serverError(env, route || "(no route)", e);
      return json({ error: "server_error" }, 500);
    }
}
