// ApexNav API Worker. Static files are served by Cloudflare's asset layer; only /api/* and the front pages reach this code
// (wrangler.jsonc: assets.run_worker_first; the front pages and app links: src/hosts.ts). Phones never talk to the database directly.
import { routeHost } from "./hosts";
import {
  APP_ORIGIN, appExchange, csrfCheck, createInvite, googleCallback, googleStart, invitePreview, logout, redeemInvite, requireMember, requireUser, sessionCookie, sessionHash, viewer,
} from "./auth";
import { convoyAccept, convoyCode, convoyCodeJoin, convoyCodePreview, convoyConnect, convoyCreate, convoyDismiss, convoyInvitePeople, convoyInvites, convoyJoin, convoyPreview, convoyRoom, unwrap } from "./convoy_routes";
import { Env, HttpError, body, json, str } from "./util";
import { rateCheck } from "./ratelimit";
import { clientError, countError, errorSummary, failingRoutes, serverError } from "./errors";
import { backupDatabase } from "./backup";
import { pushStatus } from "./apns";
import { sweepExpired } from "./sweep";
import { cronHealth, runCron } from "./cron_runs";
import { appleSignIn } from "./apple";
import { crewHazardKinds, hazardsNear, reportHazard, voteHazard } from "./hazards";
import { routeDelete, routeGet, routesSharedWithMe, shareRoute } from "./routes_shared";
import { bookCreate, bookDelete, bookFollow, bookGet, bookUpdate, booksMine, booksNear, roadAdd, roadRemove, roadStamp, roadUpdate } from "./roadbooks";
import { duelAccept, duelCreate, duelEnd, duelList } from "./duels";

const BACKUP_CRON = "0 7 * * 1";   // wrangler.jsonc triggers; the other cron is the daily sweep
import {
  boardActivity, boardFor, crewCreate, crewDiscover, crewInvite, crewInvitePreview, crewInvitesBy, crewInvitesRevoke, crewJoin, crewJoinPublic, crewLeave, crewList, crewMembers, crewUpdate, friendAccept, friendList, friendRequest, friendRequestCancel,
  ghosts, myGrants, publish, removePair, setGrant, setHandle,
} from "./social";
import { deleteAccount, exportMyData } from "./account";
import { itemsDelete, itemsGet, itemsPut } from "./member_items";
import * as drivePosts from "./drive_posts";
import { mediaGet, mediaPut } from "./post_media";
import { afterCrewDrive, afterDuel, afterFriend, afterKudos, afterPostComment, afterPostKudos, pushForget, pushQuiet, pushRegister } from "./push";
import { carCreate, carDelete, carUpdate, myCars, peoplesCars } from "./garage";
import { chatDelete, chatList, chatPost, crewBadge, crewFeed, crewPage, crewPageUpdate, crewVoiceGet, crewVoicePut, crewVoices, templateCreate, templateDelete, templatesList } from "./crew_page";
import { decalsPlace } from "./livery";
import { presencePublish, presenceSettingsGet, presenceSettingsPut, presenceView } from "./presence";
import { buildChatDelete, buildChatList, buildChatPost, buildCreate, buildDelete, buildFind, buildFollow, buildGet, buildUpdate, buildsFollowing, postCreate, postDelete, replyCreate, replyDelete, replyTried } from "./builds";
import { photoDelete, photoList, photoServe, photoUpload, photoUse } from "./photos";
import { ctxServe } from "./context_grid";
import { cameraList, graphIndex, graphTile } from "./graph";
import { dataPut } from "./data_store";
import { block, blockList, fileReport, isModerator, moderationQueue, moderationResolve, report, unblock } from "./safety";
import { contribute, setContribute } from "./contribute";
import { pointsFor } from "./points";
import { redeem, shop } from "./redeem";
import { flagsFor } from "./flags";
import { ctxKeys, workzones } from "./route_feeds";
import { osmTile } from "./osm_relay";
import { traceTile } from "./trace_relay";
import { grantedThemes } from "./themes";
import { isDeveloper } from "./developers";
import { coverage, exportRoads, roadBins } from "./roads";
import { crewStandings } from "./standings";
import { crewBoard, publishDriveScores } from "./drive_scores";
import { enter as taEnter, circuitsNow, leave as taLeave, makeCircuit, runs as taRuns, timeAttack } from "./time_attack";
import { fixedArea, fixedEnter, fixedEntered, fixedLeave, fixedMake, fixedRuns } from "./ta_fixed";
import { eventCame, eventCancel, eventCreate, eventRecord, eventRole, eventRsvp, eventUpdate, eventsList, eventsNear } from "./events";
import { healthReport, healthSummary } from "./health";
import { feedbackCreate, feedbackDone, feedbackList } from "./feedback";
import { friendProfile } from "./profile";
import { kudosGive, kudosReceived, kudosTake } from "./kudos";
import { inbox } from "./inbox";
import { STATS_SAMPLE, recordStat, statsSummary } from "./stats";
import { etaStart, etaUpdate, etaView } from "./eta_share";
import { highlightCreate, highlightDelete, highlightList, highlightRate } from "./highlights";
export { ConvoyIndex, ConvoyRoom } from "./convoy";
import { crewHomeSet, crewMeetCells } from "./crew_meet";
import { chargers } from "./chargers";
import { camerasResponse, trafficResponse } from "./traffic";
import { dailyServerCheck, serverSide, serviceHistory, serviceReport } from "./service_check";
import { QUERY_WARN, countedDb } from "./query_budget";
import { SHED_ROUTES, countedKv, countedR2, flushUsage, usageState } from "./usage";
import { segmentAdopt, segmentCreate, segmentDelete, segmentList, segmentShare, segmentsSharedWithMe } from "./segments";

type Handler = (req: Request, env: Env, m: RegExpMatchArray, ctx?: ExecutionContext) => Promise<Response>;
/** Work after the answer (a push): in waitUntil where there is a context, else done before answering (tests). */
const later = async (ctx: ExecutionContext | undefined, p: Promise<unknown>) => { if (ctx) ctx.waitUntil(p); else await p; };
const routes: [string, RegExp, Handler, string][] = [];
const on = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), h, `${method} ${path}`]);
const noContent = () => new Response(null, { status: 204 });

// Status checks (tools/status_check.py, IDEAS Y-05): one trivial read proves the database answers, not just the Worker.
// The cron jobs ride along (src/cron_runs.ts): a backup or sweep that stopped or keeps failing is an outage there too, and so
// is a route whose 500s keep coming (src/errors.ts failingRoutes).
// Push (src/apns.ts): set up here, and does APNs answer this Worker (the HTTP/2 check). Nothing personal.
on("GET", "/api/push/status", async (_req, env) => json(await pushStatus(env)));
on("GET", "/api/health", async (_req, env) => {
  try { return json({ ok: true, db: true, cron: await cronHealth(env), failing_routes: await failingRoutes(env) }); }
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
// Service check (service_check.ts, web/service_check.js): the owner's phone sends what it saw; the Worker's own side.
on("POST", "/api/ops/service-check", async (req, env) => {
  if (!isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  return json(await serviceReport(req, env));
});
on("GET", "/api/ops/service-check", async (req, env) => {
  if (!isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  return json(await serviceHistory(env, new URL(req.url)));
});
on("GET", "/api/ops/service-check/server", async (req, env) => {
  if (!isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  return json(await serverSide(env));
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
  // contribute: the Share road feel switch, so the app needn't fetch the whole export (every table) to read one flag
  const photo = v.member ? await env.DB.prepare("SELECT u.photo_id, m.contribute FROM users u LEFT JOIN members m ON m.user_id = u.id WHERE u.id = ?")
    .bind(v.id).first<{ photo_id: string | null; contribute: number | null }>() : null;
  // private themes granted to this account by hand (migration 0044): their looks, for this account only; [] for everyone else
  const themes = await grantedThemes(env, v.id);
  const again = sessionCookie(req);                                  // the website's cookie keeps up with the sliding session
  return json({ signed_in: true, id: v.id, handle: v.handle, name: v.displayName, member: v.member, requests: waiting?.n ?? 0, photo_id: photo?.photo_id ?? null,
               contribute: !!photo?.contribute, themes, ...(v.member && isModerator(env, v) ? { moderator: true } : {}), ...(await isDeveloper(env, v) ? { developer: true } : {}) },
              200, again ? { "set-cookie": again } : {});
});
on("POST", "/api/invites/redeem", async (req, env) => { await redeemInvite(env, await requireUser(req, env), req); return noContent(); });
on("POST", "/api/invites/preview", async (req, env) => json(await invitePreview(env, await requireMember(req, env), req)));   // P-02: whose friend link
on("POST", "/api/invites", async (req, env) => json(await createInvite(env, await requireMember(req, env), req), 201));
// Signed in is enough to take your data or close your account, member or not (someone removed by the owner keeps both rights).
on("GET", "/api/me/export", async (req, env) => json(await exportMyData(env, await requireUser(req, env))));
on("DELETE", "/api/me", async (req, env) => deleteAccount(env, await requireUser(req, env), req));
// Saved routes and pinned places on your account (member_items.ts): signed in is enough, they are your own
on("GET", "/api/me/items", async (req, env) => json(await itemsGet(env, await requireUser(req, env), new URL(req.url))));
on("PUT", "/api/me/items", async (req, env) => json(await itemsPut(env, await requireUser(req, env), req)));
on("DELETE", "/api/me/items", async (req, env) => { await itemsDelete(env, await requireUser(req, env), new URL(req.url)); return noContent(); });
on("PUT", "/api/me/handle", async (req, env) => { await setHandle(env, await requireMember(req, env), req); return noContent(); });

on("PUT", "/api/me/contribute", async (req, env) => { await setContribute(env, await requireMember(req, env), req); return noContent(); });
on("POST", "/api/contribute", async (req, env) => json(await contribute(env, await requireMember(req, env), req), 202));

on("GET", "/api/roads", async (req, env) => { await requireMember(req, env); return json(await roadBins(env, new URL(req.url))); });
// EV chargers by 0.25-degree tile for fuel-stop spacing (chargers.ts; route_ctx/car.js): members only, the key stays here
on("GET", "/api/chargers", async (req, env) => { await requireMember(req, env); return json(await chargers(env, new URL(req.url))); });
on("GET", "/api/coverage", async (req, env) => { await requireMember(req, env); return json(await coverage(env, new URL(req.url))); });
// The road-data export (docs/ROAD_DATA.md): the owner only, for a pilot; anyone else gets a plain 404.
on("GET", "/api/ops/roads.geojson", async (req, env) => {
  if (!isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  return json(await exportRoads(env, new URL(req.url)));
});
on("GET", "/api/points", async (req, env) => json(await pointsFor(env, (await requireMember(req, env)).id)));
on("GET", "/api/flags", async (req, env) => json(await flagsFor(env, req)));
// Work zones from state feeds without CORS (web/route_ctx/hazards_live.js); 0.5° tiles only, nothing kept.
on("GET", "/api/ctx/workzones", async (req) => workzones(req));
on("GET", "/api/ctx/keys", async (_req, env) => ctxKeys(env));
// OpenStreetMap map features by one 0.05° tile (osm_relay.ts; route_ctx/osm_overpass.js): Overpass server-side, kept a week
on("GET", "/api/ctx/osm", async (req, env, _m, ctx) => {
  const url = new URL(req.url);   // ?diag=1 asks every mirror uncached: the owner's tool, never anyone's
  if (url.searchParams.get("diag") === "1" && !isModerator(env, await requireMember(req, env))) throw new HttpError(404, "not_found");
  return osmTile(url, env, ctx);
});
// The router's edges for a stage cut from the map tiles (trace_relay.ts; route_ctx/router_edges.js), kept 3 days per shape
on("GET", "/api/ctx/trace", async (req) => traceTile(new URL(req.url)));
on("GET", "/api/shop", async (req, env) => json(await shop(env, await requireMember(req, env))));
on("POST", "/api/redeem", async (req, env) => json(await redeem(env, await requireMember(req, env), req)));

on("POST", "/api/friends/request", async (req, env, _m, ctx) => {
  const v = await requireMember(req, env), n = await friendRequest(env, v, req);
  if (n) await later(ctx, afterFriend(env, v, n.to, n.mutual));
  return json({ ok: true }, 202);
});
on("POST", "/api/friends/request/cancel", async (req, env) => { await friendRequestCancel(env, await requireMember(req, env), req); return noContent(); });
on("GET", "/api/friends", async (req, env) => json(await friendList(env, await requireMember(req, env))));
on("POST", "/api/friends/accept", async (req, env, _m, ctx) => {
  const v = await requireMember(req, env), other = await friendAccept(env, v, req);
  await later(ctx, afterFriend(env, v, other, true));
  return noContent();
});
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
on("POST", "/api/crews/:id/events", async (req, env, m, ctx) => {
  const v = await requireMember(req, env), e = await eventCreate(env, v, m.groups!.id, req);
  await later(ctx, afterCrewDrive(env, v, m.groups!.id, e.id));
  return json(e, 201);
});
// Share your ETA (IDEAS S-19): the driver starts and refreshes it; anyone with the link reads it, signed out.
on("POST", "/api/eta", async (req, env) => json(await etaStart(env, await requireMember(req, env), req), 201));
on("PUT", "/api/eta/:token", async (req, env, m) => { await etaUpdate(env, await requireMember(req, env), m.groups!.token, req); return noContent(); });
on("GET", "/api/eta/:token", async (_req, env, m) => json(await etaView(env, m.groups!.token)));
on("GET", "/api/timeattack", async (req, env) => json(await timeAttack(env, await requireMember(req, env), new URL(req.url))));
on("GET", "/api/timeattack/circuits", async (req, env) => json(await circuitsNow(env, await requireMember(req, env))));
on("POST", "/api/timeattack/circuit", async (req, env) => json(await makeCircuit(env, await requireMember(req, env), req)));
on("POST", "/api/timeattack/enter", async (req, env) => json(await taEnter(env, await requireMember(req, env), req)));
on("POST", "/api/timeattack/runs", async (req, env) => json(await taRuns(env, await requireMember(req, env), req)));
on("DELETE", "/api/timeattack/entry", async (req, env) => { await taLeave(env, await requireMember(req, env), new URL(req.url)); return noContent(); });
// fixed time attacks (ta_fixed.ts): three per area a season, one featured a week, boards by week, month, year or all time
on("GET", "/api/ta", async (req, env) => json(await fixedArea(env, await requireMember(req, env), new URL(req.url))));
on("GET", "/api/ta/entered", async (req, env) => json(await fixedEntered(env, await requireMember(req, env))));
on("POST", "/api/ta/circuit", async (req, env) => json(await fixedMake(env, await requireMember(req, env), req)));
on("POST", "/api/ta/enter", async (req, env) => json(await fixedEnter(env, await requireMember(req, env), req)));
on("POST", "/api/ta/runs", async (req, env) => json(await fixedRuns(env, await requireMember(req, env), req)));
on("DELETE", "/api/ta/entry", async (req, env) => { await fixedLeave(env, await requireMember(req, env), new URL(req.url)); return noContent(); });
on("GET", "/api/events/near", async (req, env) => json(await eventsNear(env, await requireMember(req, env), new URL(req.url))));
on("GET", "/api/events", async (req, env) => json(await eventsList(env, await requireMember(req, env), null)));
on("POST", "/api/events/:id/rsvp", async (req, env, m) => { await eventRsvp(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("POST", "/api/events/:id/role", async (req, env, m) => { await eventRole(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("DELETE", "/api/events/:id", async (req, env, m) => { await eventCancel(env, await requireMember(req, env), m.groups!.id); return noContent(); });
// the run as one card (REVIEW_PEOPLE.md P-03, P-10): set the rest on the card, who came, and the drive remembered
on("PUT", "/api/events/:id", async (req, env, m) => { await eventUpdate(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("POST", "/api/events/:id/came", async (req, env, m) => { await eventCame(env, await requireMember(req, env), m.groups!.id, true); return noContent(); });
on("DELETE", "/api/events/:id/came", async (req, env, m) => { await eventCame(env, await requireMember(req, env), m.groups!.id, false); return noContent(); });
on("GET", "/api/events/:id/record", async (req, env, m) => json(await eventRecord(env, await requireMember(req, env), m.groups!.id)));
// the crew page (src/crew_page.ts, REVIEW.md roadmap 20)
on("GET", "/api/crews/:id/page", async (req, env, m) => json(await crewPage(env, await requireMember(req, env), m.groups!.id)));
// the board as a total of drive Scores over a period (drive_scores.ts, the owner's TestFlight note 06)
on("GET", "/api/crews/:id/board", async (req, env, m) => json(await crewBoard(env, await requireMember(req, env), m.groups!.id, new URL(req.url))));
on("POST", "/api/drives/scores", async (req, env) => json(await publishDriveScores(env, await requireMember(req, env), req)));
on("PUT", "/api/crews/:id/page", async (req, env, m) => { await crewPageUpdate(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("PUT", "/api/crews/:id/badges", async (req, env, m) => { await crewBadge(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("GET", "/api/crews/:id/templates", async (req, env, m) => json(await templatesList(env, await requireMember(req, env), m.groups!.id)));
on("POST", "/api/crews/:id/templates", async (req, env, m) => json(await templateCreate(env, await requireMember(req, env), m.groups!.id, req), 201));
on("DELETE", "/api/crews/:id/templates/:tid", async (req, env, m) => { await templateDelete(env, await requireMember(req, env), m.groups!.id, m.groups!.tid); return noContent(); });
on("PUT", "/api/crews/:id/decals", async (req, env, m) => { await decalsPlace(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("GET", "/api/crews/:id/chat", async (req, env, m) => json(await chatList(env, await requireMember(req, env), m.groups!.id, new URL(req.url))));
on("POST", "/api/crews/:id/chat", async (req, env, m) => json(await chatPost(env, await requireMember(req, env), m.groups!.id, req), 201));
on("DELETE", "/api/crews/:id/chat/:msg", async (req, env, m) => { await chatDelete(env, await requireMember(req, env), m.groups!.id, m.groups!.msg); return noContent(); });
on("GET", "/api/crews/:id/members", async (req, env, m) => json(await crewMembers(env, await requireMember(req, env), m.groups!.id)));
// fair meeting points (crew_meet.ts): your rough home area for this crew, opt-in; the crew's cells without names
on("PUT", "/api/crews/:id/home", async (req, env, m) => json(await crewHomeSet(env, await requireMember(req, env), m.groups!.id, req)));
on("GET", "/api/crews/:id/meet", async (req, env, m) => json(await crewMeetCells(env, await requireMember(req, env), m.groups!.id)));
on("POST", "/api/crews/join", async (req, env) => json(await crewJoin(env, await requireMember(req, env), req)));
on("POST", "/api/crews/invite/preview", async (req, env) => json(await crewInvitePreview(env, await requireMember(req, env), req)));
on("POST", "/api/crews/:id/invite", async (req, env, m) => json(await crewInvite(env, await requireMember(req, env), m.groups!.id), 201));
on("DELETE", "/api/crews/:id/invites", async (req, env, m) => json(await crewInvitesRevoke(env, await requireMember(req, env), m.groups!.id)));
on("PUT", "/api/crews/:id/invites", async (req, env, m) => json(await crewInvitesBy(env, await requireMember(req, env), m.groups!.id, req)));   // P-07: who can invite
on("GET", "/api/crews/voices", async (req, env) => json(await crewVoices(env, await requireMember(req, env))));
on("PUT", "/api/crews/:id/voice/:pack", async (req, env, m) => { await crewVoicePut(env, await requireMember(req, env), m.groups!.id, m.groups!.pack, req); return noContent(); });
on("GET", "/api/crews/:id/voice/:pack", async (req, env, m) => crewVoiceGet(env, await requireMember(req, env), m.groups!.id, m.groups!.pack));
on("GET", "/api/crews/feed", async (req, env) => json(await crewFeed(env, await requireMember(req, env))));   // your crews at a glance, and their feed
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
on("GET", "/api/builds/:id/chat", async (req, env, m) => json(await buildChatList(env, await requireMember(req, env), m.groups!.id)));
on("POST", "/api/builds/:id/chat", async (req, env, m) => json(await buildChatPost(env, await requireMember(req, env), m.groups!.id, req), 201));
on("DELETE", "/api/builds/:id/chat/:msg", async (req, env, m) => { await buildChatDelete(env, await requireMember(req, env), m.groups!.id, m.groups!.msg); return noContent(); });
on("POST", "/api/builds/:id/posts", async (req, env, m) => json(await postCreate(env, await requireMember(req, env), m.groups!.id, req), 201));
on("PUT", "/api/builds/:id/follow", async (req, env, m) => { await buildFollow(env, await requireMember(req, env), m.groups!.id, true); return noContent(); });
on("DELETE", "/api/builds/:id/follow", async (req, env, m) => { await buildFollow(env, await requireMember(req, env), m.groups!.id, false); return noContent(); });
// friends on the map (src/presence.ts, REVIEW.md 5.4, roadmap 24)
on("GET", "/api/presence/settings", async (req, env) => json(await presenceSettingsGet(env, await requireMember(req, env))));
on("PUT", "/api/presence/settings", async (req, env) => { await presenceSettingsPut(env, await requireMember(req, env), req); return noContent(); });
on("GET", "/api/presence", async (req, env) => json(await presenceView(env, await requireMember(req, env))));
on("POST", "/api/presence", async (req, env) => { await presencePublish(env, await requireMember(req, env), req); return noContent(); });
// the context grid's wider region (src/context_grid.ts): public data, bundled per ~150 km tile
on("GET", "/api/ctx/v1/index.json", (_req, env) => ctxServe(env, "v1/index.json"));
on("GET", "/api/ctx/v1/8/:x/:y", (_req, env, m) => ctxServe(env, `v1/8/${m.groups!.x}/${m.groups!.y}`));
// Vetta's own scored road network beyond Cincinnati (src/graph.ts): tiles from the repository's graph-data branch
on("GET", "/api/graph/v1/index.json", (req, env) => graphIndex(req, fetch, env));
on("GET", "/api/graph/v1/:name", (req, env, m) => graphTile(req, m.groups!.name, fetch, env));
// Official traffic events from the state DOTs' free feeds (traffic.ts; web/road_events.js): public, the whole region, cached 5 min
on("GET", "/api/traffic/v1/events.json", (_req, env) => trafficResponse(env));
// Ohio's traffic cameras (still pictures of the road) for the map's opt-in Road cameras layer (traffic.ts; web/road_cams.js)
on("GET", "/api/traffic/v1/cameras.json", (_req, env) => camerasResponse(env));
// Avoid cameras' own camera list for the region (graph.ts cameraList; web/cameras.js), from the graph-data branch
on("GET", "/api/cameras/v1/region.json", (_req, env) => cameraList(fetch, env));
// CI's upload of the map data into R2 (src/data_store.ts): a GitHub OIDC token of this repository's main branch, no secret
on("PUT", "/api/ops/data", (req, env, _m, ctx) => dataPut(req, env, ctx));
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
// Roadbooks (src/roadbooks.ts): collections of great roads. A public one opens by its link with no account; the rest need a member.
on("GET", "/api/roadbooks/near", async (req, env) => json(await booksNear(env, await viewer(req, env), new URL(req.url))));
on("GET", "/api/roadbooks", async (req, env) => json(await booksMine(env, await requireMember(req, env))));
on("POST", "/api/roadbooks", async (req, env) => json(await bookCreate(env, await requireMember(req, env), req), 201));
on("PUT", "/api/roadbooks/roads/:rid/stamp", async (req, env, m) => json(await roadStamp(env, await requireMember(req, env), m.groups!.rid, true)));
on("DELETE", "/api/roadbooks/roads/:rid/stamp", async (req, env, m) => json(await roadStamp(env, await requireMember(req, env), m.groups!.rid, false)));
on("GET", "/api/roadbooks/:id", async (req, env, m) => json(await bookGet(env, await viewer(req, env), m.groups!.id)));
on("PUT", "/api/roadbooks/:id", async (req, env, m) => { await bookUpdate(env, await requireMember(req, env), m.groups!.id, req); return noContent(); });
on("DELETE", "/api/roadbooks/:id", async (req, env, m) => { await bookDelete(env, await requireMember(req, env), m.groups!.id); return noContent(); });
on("POST", "/api/roadbooks/:id/roads", async (req, env, m) => json(await roadAdd(env, await requireMember(req, env), m.groups!.id, req), 201));
on("PUT", "/api/roadbooks/:id/roads/:rid", async (req, env, m) => { await roadUpdate(env, await requireMember(req, env), m.groups!.id, m.groups!.rid, req); return noContent(); });
on("DELETE", "/api/roadbooks/:id/roads/:rid", async (req, env, m) => { await roadRemove(env, await requireMember(req, env), m.groups!.id, m.groups!.rid); return noContent(); });
on("PUT", "/api/roadbooks/:id/follow", async (req, env, m) => { await bookFollow(env, await requireMember(req, env), m.groups!.id, true); return noContent(); });
on("DELETE", "/api/roadbooks/:id/follow", async (req, env, m) => { await bookFollow(env, await requireMember(req, env), m.groups!.id, false); return noContent(); });
on("GET", "/api/hazards/kinds", async (req, env) => json(await crewHazardKinds(env, await requireMember(req, env))));
on("POST", "/api/hazards", async (req, env) => json(await reportHazard(env, await requireMember(req, env), req), 201));
on("GET", "/api/hazards", async (req, env) => json(await hazardsNear(env, new URL(req.url), await requireMember(req, env))));
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

// Duels (src/duels.ts): a friend against a friend on a stage for a few days, the higher Score wins; Scores they already share.
on("GET", "/api/duels", async (req, env) => json(await duelList(env, await requireMember(req, env))));
on("POST", "/api/duels", async (req, env, _m, ctx) => {
  const v = await requireMember(req, env), d = await duelCreate(env, v, req);
  await later(ctx, afterDuel(env, v, d.id, false));
  return json(d, 201);
});
on("POST", "/api/duels/:id/accept", async (req, env, m, ctx) => {
  const v = await requireMember(req, env), d = await duelAccept(env, v, m.groups!.id);
  await later(ctx, afterDuel(env, v, m.groups!.id, true));
  return json(d);
});
on("DELETE", "/api/duels/:id", async (req, env, m) => json(await duelEnd(env, await requireMember(req, env), m.groups!.id)));
on("POST", "/api/board", async (req, env) => json(await publish(env, await requireMember(req, env), req)));
// Kudos (IDEAS S-07): a tap of thanks on a friend's run you can see; no text.
// drive posts and the friends feed (src/drive_posts.ts)
on("GET", "/api/feed", async (req, env) => json(await drivePosts.feed(env, await requireMember(req, env), new URL(req.url))));
on("POST", "/api/posts", async (req, env) => json(await drivePosts.postCreate(env, await requireMember(req, env), req), 201));
on("GET", "/api/posts/:id", async (req, env, m) => json(await drivePosts.postGet(env, await requireMember(req, env), m.groups!.id)));
on("DELETE", "/api/posts/:id", async (req, env, m) => { await drivePosts.postDelete(env, await requireMember(req, env), m.groups!.id); return noContent(); });
on("POST", "/api/posts/:id/kudos", async (req, env, m, ctx) => {
  const v = await requireMember(req, env), k = await drivePosts.postKudos(env, v, m.groups!.id, true);
  if (k) await later(ctx, afterPostKudos(env, v, m.groups!.id, k.author, k.title));
  return noContent();
});
on("DELETE", "/api/posts/:id/kudos", async (req, env, m) => { await drivePosts.postKudos(env, await requireMember(req, env), m.groups!.id, false); return noContent(); });
on("POST", "/api/posts/:id/comments", async (req, env, m, ctx) => {
  const v = await requireMember(req, env), c = await drivePosts.commentCreate(env, v, m.groups!.id, req);
  await later(ctx, afterPostComment(env, v, m.groups!.id, c.author, c.title));
  return json({ id: c.id }, 201);
});
on("PUT", "/api/posts/:id/media", async (req, env, m) => json(await mediaPut(env, await requireMember(req, env), m.groups!.id, req)));
on("GET", "/api/posts/:id/media", async (req, env, m) => mediaGet(env, await requireMember(req, env), m.groups!.id));
on("DELETE", "/api/comments/:id", async (req, env, m) => { await drivePosts.commentDelete(env, await requireMember(req, env), m.groups!.id); return noContent(); });
on("POST", "/api/kudos", async (req, env, _m, ctx) => {
  const v = await requireMember(req, env), k = await kudosGive(env, v, req);
  if (k) await later(ctx, afterKudos(env, v, k.owner, k.canon));
  return noContent();
});
// push notifications (src/push.ts): this phone's APNs token, kept while signed in
on("POST", "/api/push/token", async (req, env) => json(await pushRegister(env, await requireUser(req, env), req)));
on("PUT", "/api/push/quiet", async (req, env) => { await pushQuiet(env, await requireMember(req, env), req); return noContent(); });
on("DELETE", "/api/push/token", async (req, env) => { const v = await requireUser(req, env); const b = (await req.json().catch(() => ({}))) as { token?: unknown }; await pushForget(env, v.id, b.token); return noContent(); });
on("DELETE", "/api/kudos", async (req, env) => { await kudosTake(env, await requireMember(req, env), req); return noContent(); });
on("GET", "/api/kudos", async (req, env) => json(await kudosReceived(env, await requireMember(req, env))));
// For you (src/inbox.ts): what happened to you socially, made from what each part already shows you; seen is kept on the phone.
on("GET", "/api/inbox", async (req, env) => json(await inbox(env, await requireMember(req, env))));
on("GET", "/api/board/activity", async (req, env) => json(await boardActivity(env, await requireMember(req, env))));
on("GET", "/api/board/ghosts", async (req, env) => { const u = new URL(req.url);
  return json(await ghosts(env, await requireMember(req, env), (u.searchParams.get("canons") || "").split(",").filter(Boolean), u.searchParams.get("surface"))); });
on("GET", "/api/board/:canon", async (req, env, m) => json(await boardFor(env, await requireMember(req, env), m.groups!.canon)));

on("POST", "/api/convoy", async (req, env) => json(await convoyCreate(env, await requireMember(req, env), req), 201));
on("POST", "/api/convoy/join", async (req, env) => json(await convoyJoin(env, await requireMember(req, env), req)));
on("POST", "/api/convoy/preview", async (req, env) => json(await convoyPreview(env, await requireMember(req, env), req)));
on("POST", "/api/convoy/code/join", async (req, env) => json(await convoyCodeJoin(env, await requireMember(req, env), req)));
on("POST", "/api/convoy/code/preview", async (req, env) => json(await convoyCodePreview(env, await requireMember(req, env), req)));
on("GET", "/api/convoy/invites", async (req, env) => json(await convoyInvites(env, await requireMember(req, env))));
on("DELETE", "/api/convoy/invites/:id", async (req, env, m) => json(await convoyDismiss(env, await requireMember(req, env), m.groups!.id)));
on("GET", "/api/convoy/:id", async (req, env, m) => json(await convoyRoom(env, m.groups!.id).status((await requireMember(req, env)).id).then(unwrap)));
on("POST", "/api/convoy/:id/code", async (req, env, m) => json(await convoyCode(env, await requireMember(req, env), m.groups!.id), 201));
on("POST", "/api/convoy/:id/invite", async (req, env, m) => json(await convoyRoom(env, m.groups!.id).newInvite((await requireMember(req, env)).id).then(unwrap), 201));
on("POST", "/api/convoy/:id/ticket", async (req, env, m) => {
  const v = await requireMember(req, env);
  return json(await convoyRoom(env, m.groups!.id).ticket(v.id, (await sessionHash(req))!).then(unwrap), 201);
});
on("POST", "/api/convoy/:id/invite-people", async (req, env, m) => json(await convoyInvitePeople(env, await requireMember(req, env), m.groups!.id, req)));
on("POST", "/api/convoy/:id/accept", async (req, env, m) => json(await convoyAccept(env, await requireMember(req, env), m.groups!.id, req)));
on("POST", "/api/convoy/:id/keep", async (req, env, m) => json(await convoyRoom(env, m.groups!.id).keepGoing((await requireMember(req, env)).id).then(unwrap)));
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
    const site = await routeHost(req, env);   // www., the app-links file, and the front pages of vettadrive.app / .com (src/hosts.ts)
    if (site) return site;
    const fromApp = req.headers.get("origin") === APP_ORIGIN;
    if (req.method === "OPTIONS") return fromApp ? new Response(null, { status: 204, headers: APP_CORS }) : new Response(null, { status: 405 });
    const t0 = Date.now(), seen = { route: "" };
    // every D1 query this request makes is counted (src/query_budget.ts); tests set QUERY_LIMIT to fail like production would
    const q = { n: 0 }, res = await handle(req, metered(env, q, env.QUERY_LIMIT ? Number(env.QUERY_LIMIT) : undefined), seen, ctx);
    if (ctx) ctx.waitUntil(flushUsage(env));   // the usage guard's count (src/usage.ts), every 30 s per isolate
    if (ctx && q.n > QUERY_WARN) ctx.waitUntil(countError(env, { source: "server", kind: "queries", message: `${q.n} D1 queries in one request`, page: seen.route || "(none)", stack: "" }));
    // latency and error rates (IDEAS Y-17): sampled, 5xx always; written after the response
    const sampled = Math.random() < 1 / STATS_SAMPLE;
    if (ctx && (sampled || res.status >= 500)) ctx.waitUntil(recordStat(env, seen.route || "(none)", res.status, Date.now() - t0, sampled ? STATS_SAMPLE : 0));
    return fromApp ? withAppCors(res) : res;
  },
  // Cron triggers (wrangler.jsonc triggers): the weekly database backup, and the daily sweep of expired rows.
  async scheduled(ctrl: ScheduledController, raw: Env, ctx: ExecutionContext): Promise<void> {
    const env = metered(raw, { n: 0 });
    if (ctrl.cron === BACKUP_CRON) {
      ctx.waitUntil(runCron(env, "backup", async () => {
        // near this month's included D1 / KV amounts the backup waits for the 1st (src/usage.ts); last week's copy stays
        if ((await usageState(env))?.shedding) { console.log(JSON.stringify({ event: "backup_skipped", reason: "usage" })); return; }
        if ((env.ARCHIVE || env.BACKUPS) && !(await backupDatabase(env))) throw new Error("backup not written (too big)");
      }).finally(() => flushUsage(raw, true)));
    } else {
      ctx.waitUntil(runCron(env, "sweep", () => sweepExpired(env)).finally(() => flushUsage(raw, true)));
      ctx.waitUntil(dailyServerCheck(env));   // the service check's server side once a day, no phone needed (source 'server')
    }
  },
};

// The env a request or cron sees: its D1 queries counted (src/query_budget.ts) and its D1 rows and KV calls metered for
// the usage guard (src/usage.ts).
const KV_BINDINGS = new Set<PropertyKey>(["BACKUPS", "PHOTOS", "OSM", "CTX"]), R2_BINDINGS = new Set<PropertyKey>(["ARCHIVE", "DATA", "MEDIA"]);
function metered(env: Env, q: { n: number }, limit?: number): Env {
  const db = countedDb(env.DB, q, limit), wrapped = new Map<PropertyKey, unknown>();
  return new Proxy(env, {
    get(t, k) {
      if (k === "DB") return db;
      const v = Reflect.get(t, k);
      if (!v || !(KV_BINDINGS.has(k) || R2_BINDINGS.has(k))) return v;
      if (!wrapped.has(k)) wrapped.set(k, KV_BINDINGS.has(k) ? countedKv(v as KVNamespace) : countedR2(v as R2Bucket));
      return wrapped.get(k);
    },
  });
}

const D1_DAILY = /exceeded D1's free tier daily/i;
const untilMidnightUtc = () => { const d = new Date(); return Math.max(60, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime()) / 1000)); };

async function handle(req: Request, env: Env, seen: { route: string } = { route: "" }, ctx?: ExecutionContext): Promise<Response> {
    let route = "";
    try {
      const url = new URL(req.url);
      for (const [method, re, handler, name] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) {
          route = name; seen.route = `${method} ${name}`;
          csrfCheck(req, env);
          await rateCheck(req, env, url.pathname);
          if (SHED_ROUTES.has(route)) {   // near this month's included usage: optional uploads wait for the 1st (src/usage.ts)
            const u = await usageState(env);
            if (u?.shedding) return json({ error: "service_unavailable", scope: "uploads", until: u.until }, 503, { "retry-after": "3600" });
          }
          return await handler(req, env, m, ctx);
        }
      }
      if (routes.some(([, re]) => re.test(url.pathname))) throw new HttpError(405, "method_not_allowed");
      throw new HttpError(404, "not_found");
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, e.message === "rate_limited" ? { "retry-after": "60" } : {});
      // the account used up D1's free daily rows (read or written): every query fails until midnight UTC, so this is the
      // service being down for the day, not a bug in the route (and it can't be counted: the count is a D1 write too)
      if (D1_DAILY.test(String(e instanceof Error ? e.message : e))) {
        console.error(JSON.stringify({ event: "d1_daily_limit", route }));
        const wait = untilMidnightUtc();
        return json({ error: "service_unavailable", until: new Date(Date.now() + wait * 1000).toISOString() }, 503, { "retry-after": String(wait) });
      }
      console.error(e);
      await serverError(env, route || "(no route)", e);
      return json({ error: "server_error" }, 500);
    }
}
