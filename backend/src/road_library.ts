// The road library (big bet #6, 2026-11-15): vettadrive.app/roads lists great roads by state and area, and each road has
// its own page at /roads/<id>: its shape, length and corners, the roads near it, and Drive it in Vetta (the road's own
// #road= link, web/road_link.js, which opens the app or plans it on the website). Pages are drawn here, on the server,
// with no script, so a search engine and a link preview read them as they are. The roads come from
// web/data/road_library.json (tools/road_library.js, from our road graph: OpenStreetMap data, attributed on every page).
// Nothing here is measured or anyone's: no member, drive or time is read, and no database is touched.
import { Env } from "./util";

export interface LibRoad { id: string; name: string; area: string; km: number; corners: number; score: number; line: [number, number][]; link: string | null }
export interface LibArea { id: string; name: string; state: string; lat: number; lon: number }
export interface Library { built: string; graph: string; areas: LibArea[]; roads: LibRoad[] }

const DATA_PATH = "/data/road_library.json";
const ID_RE = /^[a-z0-9-]{1,80}$/;
export const STATES: Record<string, string> = {
  AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California", CO: "Colorado", CT: "Connecticut", GA: "Georgia", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", KY: "Kentucky", MA: "Massachusetts", ME: "Maine", MI: "Michigan", MN: "Minnesota", MO: "Missouri",
  MT: "Montana", NC: "North Carolina", NH: "New Hampshire", NM: "New Mexico", NY: "New York", OH: "Ohio", OR: "Oregon",
  PA: "Pennsylvania", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia", VT: "Vermont", WA: "Washington",
  WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming",
};

let cached: { at: number; lib: Library } | null = null;
/** The library from the site's own files, kept for 10 minutes per isolate (a deploy brings a new one). */
export async function library(env: Env, origin: string): Promise<Library | null> {
  if (cached && Date.now() - cached.at < 600_000) return cached.lib;
  if (!env.ASSETS) return null;
  const r = await env.ASSETS.fetch(new Request(new URL(DATA_PATH, origin)));
  if (!r.ok) return null;
  const lib = await r.json() as Library;
  cached = { at: Date.now(), lib };
  return lib;
}
export const _resetLibrary = () => { cached = null; };

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const miles = (km: number) => { const mi = km / 1.609344; return mi >= 10 ? `${Math.round(mi)}` : mi.toFixed(1); };
const near = (a: LibArea) => `${a.name}, ${a.state}`;

/** The road's line drawn to fit a w × h box (north up, a degree of longitude shrunk by its latitude), as an SVG path. */
export function shapePath(line: [number, number][], w = 1000, h = 560, pad = 40): string {
  if (!line.length) return "";
  const k = Math.cos((line.reduce((s, p) => s + p[0], 0) / line.length) * Math.PI / 180);
  const xs = line.map((p) => p[1] * k), ys = line.map((p) => -p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min((w - 2 * pad) / Math.max(1e-9, x1 - x0), (h - 2 * pad) / Math.max(1e-9, y1 - y0));
  const ox = (w - s * (x1 - x0)) / 2, oy = (h - s * (y1 - y0)) / 2;
  return line.map((_, i) => `${i ? "L" : "M"}${(ox + (xs[i] - x0) * s).toFixed(1)} ${(oy + (ys[i] - y0) * s).toFixed(1)}`).join(" ");
}

const MARK = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="mark" viewBox="0 0 100 100"><g transform="translate(-7 0)"><circle cx="34" cy="84" r="8" fill="currentColor"/><path d="M34 84 V52 Q34 26 62 21.5" fill="none" stroke="currentColor" stroke-width="9"/><path d="M60 9 L88 18 L63 34 Z" fill="currentColor"/><circle cx="51" cy="43" r="6.5" fill="#FF3341"/></g></symbol></svg>`;
const CSS = `:root{--bg:#0A0A0B;--bg2:#111214;--raised:#1B1C20;--ink:#F5F5F7;--dim:#A0A3AB;--red:#FF3341;--hair:#2B2D33;--num:"Barlow Condensed","Arial Narrow",system-ui,sans-serif;--gut:max(20px,env(safe-area-inset-left,0px))}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 "Inter Tight",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.wrap{max-width:1080px;margin:0 auto;padding:0 var(--gut)}
nav{border-bottom:1px solid var(--hair);padding-top:env(safe-area-inset-top,0px)}nav .wrap{display:flex;align-items:center;gap:20px;height:64px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none}.brand svg{width:30px;height:30px;color:var(--ink)}.brand b{font:800 24px/1 var(--num);letter-spacing:.08em}
nav .links{margin-left:auto;display:flex;gap:20px;align-items:center;font-size:15px}nav .links a{text-decoration:none;color:var(--dim)}nav .links a:hover{color:var(--ink)}nav .links a.btn{color:#0A0A0B}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 26px;border-radius:999px;font-weight:700;text-decoration:none;font-size:16px;background:var(--red);color:#0A0A0B}
.btn:hover{background:#ff5561}nav .btn{min-height:40px;padding:0 18px;font-size:14px}
main{padding:40px 0 64px}.eyebrow{font:700 14px/1 var(--num);letter-spacing:.22em;text-transform:uppercase;color:var(--red);margin:0 0 14px}
.eyebrow a{text-decoration:none}h1{font:800 clamp(40px,8vw,76px)/.95 var(--num);letter-spacing:.01em;margin:0 0 22px;text-transform:uppercase;overflow-wrap:anywhere}
.facts{display:flex;flex-wrap:wrap;gap:12px 40px;margin:0 0 26px;padding:0}.facts div{display:flex;flex-direction:column}
.facts b{font:800 44px/1 var(--num)}.facts span{color:var(--dim);font-size:14px;letter-spacing:.06em;text-transform:uppercase}
.shape{display:block;width:100%;height:auto;background:var(--bg2);border:1px solid var(--hair);border-radius:20px;margin:0 0 26px}
.shape .asphalt{fill:none;stroke:var(--raised);stroke-width:26;stroke-linecap:round;stroke-linejoin:round}
.shape .line{fill:none;stroke:var(--red);stroke-width:5;stroke-linecap:round;stroke-linejoin:round}.shape circle{fill:var(--ink)}
h2{font:800 28px/1 var(--num);text-transform:uppercase;letter-spacing:.04em;margin:44px 0 14px}
h3{font:700 15px/1.2 var(--num);text-transform:uppercase;letter-spacing:.16em;color:var(--dim);margin:28px 0 8px}
ul.roads{list-style:none;margin:0;padding:0;border-top:1px solid var(--hair)}ul.roads li{border-bottom:1px solid var(--hair)}
ul.roads a{display:flex;gap:16px;align-items:baseline;justify-content:space-between;min-height:52px;padding:12px 2px;text-decoration:none}
ul.roads a:hover b{color:var(--red)}ul.roads b{font-weight:600;overflow-wrap:anywhere}ul.roads span{color:var(--dim);font-size:15px;white-space:nowrap}
.states{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px;padding:0;list-style:none}.states a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid var(--hair);border-radius:999px;text-decoration:none;font-size:15px}
footer{border-top:1px solid var(--hair);padding:28px 0 calc(28px + env(safe-area-inset-bottom,0px));color:var(--dim);font-size:14px}
footer .wrap{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center}footer a{color:var(--ink);text-decoration:none}`;

interface Head { title: string; description: string; url: string }
function page(h: Head, body: string): string {
  const m = (attr: string, k: string, v: string) => `<meta ${attr}="${k}" content="${esc(v)}" />`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />`
    + `<meta name="theme-color" content="#0A0A0B" /><title>${esc(h.title)}</title>${m("name", "description", h.description)}<link rel="canonical" href="${esc(h.url)}" />`
    + m("property", "og:site_name", "Vetta") + m("property", "og:type", "website") + m("property", "og:title", h.title) + m("property", "og:description", h.description)
    + m("property", "og:url", h.url) + m("property", "og:image", "https://vettadrive.app/brand/icon-1024.png") + m("name", "twitter:card", "summary")
    + `<link rel="icon" href="/brand/mark.svg" type="image/svg+xml" /><link rel="apple-touch-icon" href="/brand/icon-180.png" /><link rel="stylesheet" href="/fonts/fonts.css" />`
    + `<style>${CSS}</style></head><body>${MARK}<nav aria-label="Vetta"><div class="wrap"><a class="brand" href="/roads"><svg aria-hidden="true"><use href="#mark"/></svg><b>VETTA</b></a>`
    + `<div class="links"><a href="/roads">Roads</a><a class="btn" href="https://vettadrive.com/">Get Vetta</a></div></div></nav><main><div class="wrap">${body}</div></main>`
    + `<footer><div class="wrap"><a href="https://vettadrive.com/">About</a><a href="https://vettadrive.com/privacy.html">Privacy</a><a href="https://vettadrive.com/terms.html">Terms</a>`
    + `<span>Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a></span></div></footer></body></html>`;
}

const roadRow = (r: LibRoad) => `<li><a href="/roads/${esc(r.id)}"><b>${esc(r.name)}</b><span>${miles(r.km)} mi · ${r.corners} corners</span></a></li>`;
const stateSlug = (code: string) => code.toLowerCase();

/** /roads: every state with roads, then each area's roads, best first. `state` narrows it to one (/roads/oh). */
export function indexPage(lib: Library, origin: string, state?: string): string {
  const areas = new Map(lib.areas.map((a) => [a.id, a])), by = new Map<string, LibRoad[]>();
  for (const r of lib.roads) { const l = by.get(r.area) || []; l.push(r); by.set(r.area, l); }
  const states = [...new Set(lib.areas.filter((a) => by.has(a.id)).map((a) => a.state))].sort((a, b) => (STATES[a] || a).localeCompare(STATES[b] || b));
  const shown = state ? states.filter((s) => s === state) : states;
  let body = state ? `<p class="eyebrow"><a href="/roads">Great roads</a></p><h1>${esc(STATES[state] || state)}</h1>`
    : `<p class="eyebrow">Great roads</p><h1>Roads worth the drive</h1><ul class="states">${states.map((s) => `<li><a href="/roads/${stateSlug(s)}">${esc(STATES[s] || s)}</a></li>`).join("")}</ul>`;
  for (const s of shown) {
    if (!state) body += `<h2><a href="/roads/${stateSlug(s)}" style="text-decoration:none">${esc(STATES[s] || s)}</a></h2>`;
    for (const a of lib.areas.filter((x) => x.state === s && by.has(x.id)).sort((x, y) => x.name.localeCompare(y.name))) {
      body += `<h3>Near ${esc(a.name)}</h3><ul class="roads">${by.get(a.id)!.sort((x, y) => y.score - x.score).map(roadRow).join("")}</ul>`;
    }
  }
  const where = state ? STATES[state] || state : "the US";
  return page({ title: state ? `Great roads in ${where} · Vetta` : "Great roads · Vetta",
    description: `The twistiest roads in ${where}, area by area, with each one's length and corners. Drive any of them with Vetta calling every corner.`,
    url: `${origin}/roads${state ? `/${stateSlug(state)}` : ""}` }, body);
}

/** /roads/<id>: one road. */
export function roadPage(lib: Library, origin: string, r: LibRoad): string {
  const a = lib.areas.find((x) => x.id === r.area)!;
  const mi = miles(r.km), perMi = r.corners / (r.km / 1.609344);
  const d = shapePath(r.line), first = d.match(/^M([\d.]+) ([\d.]+)/), last = d.match(/L([\d.]+) ([\d.]+)$/);
  const others = lib.roads.filter((x) => x.area === r.area && x.id !== r.id).sort((x, y) => y.score - x.score).slice(0, 8);
  const drive = r.link ? `${origin}/#road=${r.link}` : `${origin}/`;
  const body = `<p class="eyebrow"><a href="/roads/${stateSlug(a.state)}">Near ${esc(near(a))}</a></p><h1>${esc(r.name)}</h1>`
    + `<div class="facts"><div><b>${mi}</b><span>miles</span></div><div><b>${r.corners}</b><span>corners</span></div><div><b>${perMi.toFixed(1)}</b><span>corners a mile</span></div></div>`
    + `<svg class="shape" viewBox="0 0 1000 560" role="img" aria-label="The shape of ${esc(r.name)}, north up"><path class="asphalt" d="${d}"/><path class="line" d="${d}"/>`
    + (first ? `<circle cx="${first[1]}" cy="${first[2]}" r="9"/>` : "") + (last ? `<circle cx="${last[1]}" cy="${last[2]}" r="9"/>` : "") + `</svg>`
    + `<a class="btn" href="${esc(drive)}">Drive it in Vetta</a>`
    + (others.length ? `<h2>More near ${esc(a.name)}</h2><ul class="roads">${others.map(roadRow).join("")}</ul>` : "");
  return page({ title: `${r.name} · near ${near(a)} · Vetta`, description: `${mi} miles and ${r.corners} corners near ${near(a)}. Drive it with Vetta calling every corner.`, url: `${origin}/roads/${r.id}` }, body);
}

/** /roads/sitemap.xml: every page here, for search engines. */
export function sitemap(lib: Library, origin: string): string {
  const states = [...new Set(lib.areas.map((a) => a.state))];
  const urls = [`${origin}/roads`, ...states.map((s) => `${origin}/roads/${stateSlug(s)}`), ...lib.roads.map((r) => `${origin}/roads/${r.id}`)];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(u)}</loc><lastmod>${lib.built}</lastmod></url>`).join("")}</urlset>`;
}

const html = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600",
  "content-security-policy": "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });

/** The answer for a /roads path, or null when it isn't one. The pages live on the app's own name (vettadrive.app). */
export async function roadLibrary(env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (p !== "/roads" && !p.startsWith("/roads/")) return null;
  const lib = await library(env, url.origin).catch(() => null);
  if (!lib) return html(page({ title: "Great roads · Vetta", description: "", url: `${url.origin}/roads` }, `<h1>Not here right now</h1><p><a href="/roads">Try again</a></p>`), 503);
  if (p === "/roads") return html(indexPage(lib, url.origin));
  const rest = p.slice("/roads/".length);
  if (rest === "sitemap.xml") return new Response(sitemap(lib, url.origin), { headers: { "content-type": "application/xml", "cache-control": "public, max-age=3600" } });
  const code = rest.toUpperCase();
  if (/^[a-z]{2}$/.test(rest) && lib.areas.some((a) => a.state === code)) return html(indexPage(lib, url.origin, code));
  const r = ID_RE.test(rest) ? lib.roads.find((x) => x.id === rest) : undefined;
  if (r) return html(roadPage(lib, url.origin, r));
  return html(page({ title: "Not found · Vetta", description: "", url: `${url.origin}/roads` }, `<p class="eyebrow">Great roads</p><h1>No road here</h1><a class="btn" href="/roads">All roads</a>`), 404);
}
