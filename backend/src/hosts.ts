// The owner's domains (2026-11-14): vettadrive.app is the web app, the API and the links people share (drive, road,
// roadbook, convoy, friend); vettadrive.com is the information page (About, Privacy, Terms, the App Store). Both are
// Custom Domains on this one Worker (wrangler.jsonc routes), and apexnav.senftns.workers.dev keeps working unchanged, since
// the iOS app calls it. www. of either goes to the bare name.
// wrangler.jsonc run_worker_first sends "/", "/index.html" and "/.well-known/*" here, besides /api/*; everything else is a
// static file served before the Worker runs.
import { Env } from "./util";

export const APP_HOST = "vettadrive.app";
export const INFO_HOST = "vettadrive.com";
const TEAM_APP_ID = "JNX759T5W6.com.senft.ApexNav";   // Apple team + bundle id (project.yml)

/** apple-app-site-association: which links on vettadrive.app open the app (ApexNavApp.swift ApexWebBundle.linkItems),
 *  only the page links that carry something to open; a plain visit to the site, the pages and the API stay in Safari. */
export const AASA = {
  applinks: {
    details: [{
      appIDs: [TEAM_APP_ID],
      components: [
        { "/": "/api/*", exclude: true },
        ...["invite", "crew", "add", "convoy", "road", "roadbook", "friend", "post"].map((k) => ({ "/": "/", "?": { [k]: "?*" } })),
        { "/": "/", "#": "road=*" },
        { "/": "/", "#": "place=*" },                                       // a place someone sent (web/place_link.js)
      ],
    }],
  },
  webcredentials: { apps: [TEAM_APP_ID] },
};

const isWellKnown = (p: string) => p === "/.well-known/apple-app-site-association" || p === "/apple-app-site-association";

/** The answer for a request on one of our names before the API sees it, or null to carry on (an /api/ path). */
export async function routeHost(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url), host = url.hostname, path = url.pathname;
  if (host === `www.${APP_HOST}` || host === `www.${INFO_HOST}`) {
    url.hostname = host.slice(4);
    return Response.redirect(url.toString(), 301);
  }
  if (isWellKnown(path)) {
    return new Response(JSON.stringify(AASA), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
  }
  if (path.startsWith("/api/")) return null;
  if (!env.ASSETS) return new Response("Not found", { status: 404 });
  // vettadrive.com's front page is the information page; every other host's is the app
  if (host === INFO_HOST && (path === "/" || path === "/index.html")) {
    const about = await env.ASSETS.fetch(new Request(new URL("/about", url.origin), { headers: req.headers }));
    return new Response(about.body, { status: about.status, headers: about.headers });
  }
  return env.ASSETS.fetch(req);
}
