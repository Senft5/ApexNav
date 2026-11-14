// Official traffic events (closures, lane closures, roadwork, slow traffic, crashes) from the state DOTs' own free, keyless
// public feeds, for the phone's and the car's maps and for routing round full closures (web/road_events.js; cockpit.js):
//   Indiana: INDOT's CARS events API (in.carsprogram.org, PUBLIC_DOMAIN), about 14 MB of JSON statewide.
//   Kentucky: KYTC's WZDx 4.1 work zones (a public Google Cloud Storage file, no CORS, so relayed here).
//   Ohio: ODOT's OHGO public API needs a free key the owner registers (docs/OWNER_TODO.md): `ohgoApiKey` in the CTX_KEYS
//   secret the route context reads, or the secret OHGO_API_KEY; with it, its incidents, construction, travel delays and sudden slowdowns are added; without it Ohio is
//   simply not in the list.
// Each feed is compacted to a short row per event, the truck-only restrictions (width, weight, height, oversize) and the
// shoulder and rest-area closures left out. The phone asks for the whole region, never sending where it is; the answer
// is cached TRAFFIC_S at Cloudflare's edge, so the DOTs are asked once per edge per TRAFFIC_S whatever the use.
import { Env } from "./util";

export const TRAFFIC_S = 300;
export const IN_EVENTS = "https://in.carsprogram.org/carsapi_v1/api/events";
export const KY_WZDX = "https://storage.googleapis.com/kytc-its-2020-openrecords/public/feeds/WZDx/kytc_wzdx_v4.1.geojson";
export const OHGO = "https://publicapi.ohgo.com/api/v1";
const SEC = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" };

/**
 * One event. kind: "closure" (the road is closed both ways: routed round), "closed_way" (closed one way: shown, not routed
 * round, since a point can't say which way), "lane" (lanes or a ramp closed), "roadwork", "slow" (slow or stop-and-go
 * traffic), "crash", "traffic" (anything else that slows a drive). label: what the pin and the voice say. until: epoch ms
 * the agency expects it to end, or null when it gave none.
 */
export interface TrafficEvent { id: string; kind: string; label: string; lat: number; lon: number; road: string | null; until: number | null; src: string; heading?: number; text?: string }
// one way only ("I-65 southbound"): the way it applies as a compass heading, so the phone never calls the far side's
const HEADING: Record<string, number> = { northbound: 0, eastbound: 90, southbound: 180, westbound: 270 };
const OH_DIR: Record<string, string> = { n: "northbound", s: "southbound", e: "eastbound", w: "westbound" };

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inRange = (lat: number, lon: number) => lat > 24 && lat < 50 && lon > -125 && lon < -66;   // the lower 48: a bad fix is dropped
const dirOf = (s: string) => { const m = /\b(north|south|east|west)bound\b/i.exec(s); return m ? `${m[1].toLowerCase()}bound` : null; };
const cut = (s: unknown, n: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, n) : null);

// INDOT CARS codes (headline.code, lower case) by what a driver needs to know
const FULL = new Set(["closed", "road closure", "bridge is closed", "all lanes blocked", "closed to traffic", "closed for repairs"]);
const SKIP = /shoulder|rest area|turn bay|parking/;
const LANE = (code: string) => /ramp/.test(code) ? "Ramp closed" : /reduced to|lane|lanes blocked|intermittent|closed intermittently/.test(code) ? "Lane closed" : null;
const SLOW = new Set(["slow traffic", "stop and go traffic", "queuing traffic", "heavy traffic", "congestion", "delays", "long delays"]);
const TRAFFIC_WORDS: Record<string, string> = { "look out for flagger": "Flagger", "mobile maintenance operations": "Road crew", parade: "Parade", festival: "Event", "local event": "Event" };

/** INDOT's events as rows: current ones only (started, not ended), restrictions left out. */
export function parseIndiana(json: unknown, nowMs: number): TrafficEvent[] {
  if (!Array.isArray(json)) return [];
  const out: TrafficEvent[] = [];
  for (const e of json as Record<string, any>[]) {
    try {
      if (!e || e.status !== "CURRENT") continue;
      const cat = String(e.headline?.category ?? "").toLowerCase(), code = String(e.headline?.code ?? "").toLowerCase();
      const d = Array.isArray(e.details) ? e.details[0] : null, loc = d && Array.isArray(d.locations) ? d.locations[0] : null;
      const g = loc?.["primary-location"]?.["geo-location"];
      if (!d || !g || !finite(g.latitude) || !finite(g.longitude) || !inRange(g.latitude, g.longitude)) continue;
      if (d.access && d.access !== "PUBLIC_DOMAIN" && d.access !== "PUBLIC") continue;
      const start = d["start-time"]?.time, end = d["end-time"]?.time;
      if (finite(start) && start > nowMs) continue;                     // planned, not yet begun
      if (finite(end) && end <= nowMs) continue;
      const desc = String(e.description ?? ""), head = desc.split(":")[0], dir = dirOf(head);
      const both = loc["link-direction"] === "BOTH_DIRECTIONS" || loc["link-direction"] === "NOT_DIRECTIONAL" || /both directions/i.test(head);
      let kind: string, label: string;
      if (cat === "restriction" || SKIP.test(code)) continue;
      if (cat === "closure" && FULL.has(code)) { if (both || !dir) { kind = "closure"; label = "Road closed"; } else { kind = "closed_way"; label = `Closed ${dir}`; } }
      else if (cat === "closure") { const w = LANE(code); if (!w) continue; kind = "lane"; label = w; }
      else if (cat === "roadwork") { kind = "roadwork"; label = "Roadwork"; }
      else if (cat === "traffic-condition" || cat === "delay" || SLOW.has(code)) { kind = "slow"; label = /stop and go/.test(code) ? "Stop and go" : "Slow traffic"; }
      else if (cat === "accident" || cat === "incident" || /crash|accident|collision/.test(code)) { kind = "crash"; label = "Crash"; }
      else if (cat === "obstruction" || cat === "warning" || cat === "mobile-situation" || cat === "special-event" || cat === "weather") { kind = "traffic"; label = TRAFFIC_WORDS[code] ?? (cat === "weather" ? "Weather" : cat === "obstruction" ? "Obstruction" : "Traffic alert"); }
      else continue;
      out.push({ id: `dot:IN:${String(e["event-id"] ?? "").slice(0, 40)}`, kind, label, lat: r5(g.latitude), lon: r5(g.longitude),
        road: cut(loc["route-designator"], 40), until: finite(end) ? end : null, src: "INDOT", ...(dir && !both ? { heading: HEADING[dir] } : {}) });
    } catch { /* one malformed event never drops the rest */ }
  }
  return out;
}

/** KYTC's WZDx work zones as rows: current ones, at the zone's start; one with a general lane closed is "Lane closed". */
export function parseWzdx(json: unknown, nowMs: number, state: string, src: string): TrafficEvent[] {
  const feats = (json as { features?: unknown })?.features;
  if (!Array.isArray(feats)) return [];
  const out: TrafficEvent[] = [];
  for (const f of feats as Record<string, any>[]) {
    try {
      const p = f?.properties, c = p?.core_details;
      if (!p || !c || (c.event_type && c.event_type !== "work-zone")) continue;
      const g = f.geometry, first = g?.type === "LineString" ? g.coordinates?.[0] : g?.type === "Point" ? g.coordinates : g?.type === "MultiPoint" ? g.coordinates?.[0] : null;
      if (!Array.isArray(first) || !finite(first[0]) || !finite(first[1]) || !inRange(first[1], first[0])) continue;
      const start = Date.parse(p.start_date), end = Date.parse(p.end_date);
      if (Number.isFinite(start) && start > nowMs) continue;
      if (Number.isFinite(end) && end <= nowMs) continue;
      const lanes = Array.isArray(p.lanes) ? p.lanes : [];
      const general = lanes.filter((l: any) => l && l.type === "general");
      const closedAll = p.vehicle_impact === "all-lanes-closed";
      const someClosed = general.some((l: any) => l.status === "closed") || /lanes-closed/.test(String(p.vehicle_impact ?? ""));
      const dir = dirOf(`${c.direction ?? ""}`.replace(/bound$/, "") + "bound");
      const [kind, label] = closedAll ? ["closed_way", dir ? `Closed ${dir}` : "Road closed"] : someClosed ? ["lane", "Lane closed"] : ["roadwork", "Roadwork"];
      out.push({ id: `dot:${state}:${String(f.id ?? c.name ?? "").slice(0, 40)}`, kind, label, lat: r5(first[1]), lon: r5(first[0]),
        road: cut(Array.isArray(c.road_names) ? c.road_names[0] : null, 40), until: Number.isFinite(end) ? end : null, src, ...(dir ? { heading: HEADING[dir] } : {}) });
    } catch { /* as above */ }
  }
  return out;
}

/** OHGO's incidents and construction (with the owner's free key): { results: [{ id, latitude, longitude, ... }] }. */
export function parseOhgo(json: unknown, kind: "incident" | "construction", nowMs: number): TrafficEvent[] {
  const rows = (json as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  const out: TrafficEvent[] = [];
  for (const r of rows as Record<string, any>[]) {
    try {
      if (!r || !finite(r.latitude) || !finite(r.longitude) || !inRange(r.latitude, r.longitude)) continue;
      // checked against OHGO's live answer 2026-11-14: roadStatus (incidents) or status (construction) is Open, Restricted or
      // Closed; direction is "N" / "S" / "E" / "W" (incidents) or "westbound" / "both directions" (construction)
      const cat = String(r.category ?? "").toLowerCase(), st = String(r.roadStatus ?? r.status ?? "").toLowerCase();
      const end = Date.parse(r.endDate ?? "");
      if (Number.isFinite(end) && end <= nowMs) continue;
      const start = Date.parse(r.startDate ?? "");
      if (Number.isFinite(start) && start > nowMs) continue;
      const rawDir = String(r.direction ?? "").trim().toLowerCase(), both = /both/.test(rawDir);
      const dir = both ? null : (OH_DIR[rawDir] ?? dirOf(rawDir) ?? dirOf(String(r.description ?? "")));
      const ramp = /\bramp\b/i.test(`${r.routeName ?? ""} ${r.location ?? ""}`);
      let k: string, label: string;
      if (/crash|accident|collision/.test(cat)) { k = "crash"; label = "Crash"; }
      else if (st === "closed" && ramp) { k = "lane"; label = "Ramp closed"; }
      else if (st === "closed") { if (both || !dir) { k = "closure"; label = "Road closed"; } else { k = "closed_way"; label = `Closed ${dir}`; } }
      else if (st === "restricted") { k = "lane"; label = "Lane closed"; }
      else if (kind === "construction" || /repair|maint|road ?work/.test(cat)) { k = "roadwork"; label = "Roadwork"; }
      else { k = "traffic"; label = "Traffic alert"; }
      out.push({ id: `dot:OH:${String(r.id ?? "").slice(0, 40)}`, kind: k, label, lat: r5(r.latitude), lon: r5(r.longitude),
        road: cut(r.routeName ?? r.location, 40), until: Number.isFinite(end) ? end : null, src: "ODOT", ...(dir ? { heading: HEADING[dir] } : {}) });
    } catch { /* as above */ }
  }
  return out;
}

/**
 * OHGO's slowdowns (its docs, 2026-11-14; both lists were empty at night when checked): travel-delays (a stretch's
 * currentAvgSpeed against normalAvgSpeed, mph, and delayTime, minutes) and dangerous-slowdowns (currentMPH against normalMPH
 * where traffic drops suddenly, as at the back of a queue). A delay under 2 minutes with speed above 60 % of normal is left
 * out; anything under 15 mph is "Traffic stopped".
 */
export function parseOhgoSlow(json: unknown, kind: "delay" | "slowdown"): TrafficEvent[] {
  const rows = (json as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  const out: TrafficEvent[] = [];
  const num = (r: Record<string, any>, ...k: string[]) => { for (const x of k) if (finite(r[x])) return r[x] as number; return NaN; };
  for (const r of rows as Record<string, any>[]) {
    try {
      const lat = num(r, "latitude", "Latitude"), lon = num(r, "longitude", "Longitude");
      if (!inRange(lat, lon)) continue;
      const now = kind === "delay" ? num(r, "currentAvgSpeed", "CurrentAvgSpeed") : num(r, "currentMPH", "CurrentMPH");
      const normal = kind === "delay" ? num(r, "normalAvgSpeed", "NormalAvgSpeed") : num(r, "normalMPH", "NormalMPH");
      const delay = num(r, "delayTime", "DelayTime");
      if (kind === "delay" && !(delay >= 2 || (now > 0 && normal > 0 && now < 0.6 * normal))) continue;
      const rawDir = String(r.direction ?? r.Direction ?? "").trim().toLowerCase();
      const dir = /both/.test(rawDir) ? null : (OH_DIR[rawDir] ?? dirOf(rawDir) ?? dirOf(String(r.description ?? r.Description ?? "")));
      const label = finite(now) && now < 15 ? "Traffic stopped" : kind === "slowdown" ? "Sudden slowdown" : "Slow traffic";
      out.push({ id: `dot:OH:${kind}:${String(r.id ?? r.Id ?? "").slice(0, 40)}`, kind: "slow", label, lat: r5(lat), lon: r5(lon),
        road: cut(r.routeName ?? r.RouteName ?? r.location ?? r.Location, 40), until: null, src: "ODOT", ...(dir ? { heading: HEADING[dir] } : {}) });
    } catch { /* as above */ }
  }
  return out;
}

/**
 * OHGO's road weather sensors (checked live 2026-11-14): each site's surface sensors report a status ("Dry", "Wet", "Trace
 * Wet", "Chemically Wet", "Snow Watch", "Ice Watch", "Ice", "Snow", "Frost" ...) and a surface temperature (deg F). The worst
 * at a site is kept: ice, snow, frost, a watch, or a wet surface at or under 32 F is "ice"; a wet one is "wet"; dry or
 * unknown is left out. A reading over 2 h old (lastUpdate, Eastern time without a zone) is left out too.
 */
export function parseOhgoWeather(json: unknown, nowMs: number): TrafficEvent[] {
  const rows = (json as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  const out: TrafficEvent[] = [];
  for (const r of rows as Record<string, any>[]) {
    try {
      if (!r || !finite(r.latitude) || !finite(r.longitude) || !inRange(r.latitude, r.longitude)) continue;
      let worst = 0, label = "";
      for (const x of Array.isArray(r.surfaceSensors) ? r.surfaceSensors : []) {
        const st = String(x?.status ?? "").toLowerCase(), t = x?.surfaceTemperature;
        const at = Date.parse(String(x?.lastUpdate ?? "") + "-05:00");     // Eastern (EST; an hour out in summer, never a day)
        if (Number.isFinite(at) && nowMs - at > 2 * 3600e3) continue;
        const wet = /wet|slush|water/.test(st), cold = finite(t) && t > -60 && t <= 32;
        let w = 0, l = "";
        if (/watch/.test(st)) { w = 2; l = "Road near freezing"; }                     // "Snow Watch", "Ice Watch": a warning, not snow
        else if (/ice|black/.test(st)) { w = 3; l = "Icy road"; }
        else if (/snow|slush/.test(st)) { w = 3; l = "Snow on the road"; }
        else if (/frost/.test(st)) { w = 3; l = "Frost on the road"; }
        else if (wet && cold) { w = 3; l = "Road may be icy"; }
        else if (wet) { w = 1; l = "Wet road"; }
        if (w > worst) { worst = w; label = l; }
      }
      if (!worst) continue;
      out.push({ id: `dot:OH:wx:${String(r.id ?? "").slice(0, 30)}`, kind: worst >= 2 ? "ice" : "wet", label, lat: r5(r.latitude), lon: r5(r.longitude),
        road: null, until: null, src: "ODOT sensor" });
    } catch { /* as above */ }
  }
  return out;
}

/**
 * OHGO's message signs (checked live 2026-11-14): `messages` are the pages a sign shows, in capitals, padded with spaces and
 * CR LF. Travel-time pages ("TRAVEL TIME TO", "MINUTES TO") are left out (the route already has its time); the rest become one line ("Main St closed 3 miles
 * ahead"), for the plate only: a sign is never read aloud. The way it faces comes from its location ("I-71 SB @ ...").
 */
export function parseOhgoSigns(json: unknown): TrafficEvent[] {
  const rows = (json as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  const out: TrafficEvent[] = [];
  const AB: Record<string, string> = { nb: "northbound", sb: "southbound", eb: "eastbound", wb: "westbound" };
  for (const r of rows as Record<string, any>[]) {
    try {
      if (!r || !finite(r.latitude) || !finite(r.longitude) || !inRange(r.latitude, r.longitude) || !Array.isArray(r.messages)) continue;
      const pages = r.messages.map((m: unknown) => String(m ?? "").replace(/\s+/g, " ").trim()).filter((m: string) => m && !/travel time|minutes to/i.test(m));
      if (!pages.length) continue;
      const line = pages.join(". ").toLowerCase().replace(/(^|\. )([a-z])/g, (_m: string, a: string, b: string) => a + b.toUpperCase())
        .replace(/\b(i|us|sr|cr)-?(\d+)/g, (_m: string, a: string, n: string) => `${a.toUpperCase()}-${n}`).replace(/\b([nsew]) (I-\d+)/g, (_m: string, d: string, i: string) => `${d.toUpperCase()} ${i}`);
      const m = /\b(nb|sb|eb|wb)\b/i.exec(String(r.location ?? "")), dir = m ? AB[m[1].toLowerCase()] : null;
      out.push({ id: `dot:OH:sign:${String(r.id ?? "").slice(0, 30)}`, kind: "sign", label: "Sign", lat: r5(r.latitude), lon: r5(r.longitude),
        road: cut(r.location, 40), until: null, src: "ODOT", text: line.slice(0, 90), ...(dir ? { heading: HEADING[dir] } : {}) });
    } catch { /* as above */ }
  }
  return out;
}

async function get(fetcher: typeof fetch, url: string): Promise<unknown> {
  const r = await fetcher(url, { headers: { "user-agent": "Vetta-traffic/1.0", accept: "application/json" }, cf: { cacheTtl: TRAFFIC_S, cacheEverything: true } } as RequestInit);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
}

/** Every feed's current events, with the agencies that answered and those that didn't. */
export async function trafficEvents(env: Env, fetcher: typeof fetch = fetch, nowMs = Date.now()) {
  const jobs: [string, () => Promise<TrafficEvent[]>][] = [
    ["INDOT", async () => parseIndiana(await get(fetcher, IN_EVENTS), nowMs)],
    ["KYTC", async () => parseWzdx(await get(fetcher, KY_WZDX), nowMs, "KY", "KYTC")],
  ];
  let key: unknown = null;
  try { key = env.CTX_KEYS ? (JSON.parse(env.CTX_KEYS) as Record<string, unknown>).ohgoApiKey : null; } catch { key = null; }
  if (!(typeof key === "string" && key)) key = env.OHGO_API_KEY ?? null;   // or a secret of its own (one paste for the owner)
  if (typeof key === "string" && key) jobs.push(["ODOT", async () => {
    const q = `?api-key=${encodeURIComponent(key as string)}`;
    const [inc, con, delays, slow, wx, signs] = await Promise.all([get(fetcher, `${OHGO}/incidents${q}`), get(fetcher, `${OHGO}/construction${q}`),
      get(fetcher, `${OHGO}/travel-delays${q}`).catch(() => null), get(fetcher, `${OHGO}/dangerous-slowdowns${q}`).catch(() => null),
      get(fetcher, `${OHGO}/weather-sensor-sites${q}`).catch(() => null), get(fetcher, `${OHGO}/digital-signs${q}`).catch(() => null)]);   // (the last four: a bonus, never the reason Ohio is missing)
    return [...parseOhgo(inc, "incident", nowMs), ...parseOhgo(con, "construction", nowMs), ...parseOhgoSlow(delays, "delay"), ...parseOhgoSlow(slow, "slowdown"),
      ...parseOhgoWeather(wx, nowMs), ...parseOhgoSigns(signs)];
  }]);
  const ok: string[] = [], failed: string[] = [], events: TrafficEvent[] = [];
  await Promise.all(jobs.map(async ([name, run]) => { try { events.push(...(await run())); ok.push(name); } catch { failed.push(name); } }));
  ok.sort(); failed.sort();
  return { at: nowMs, sources: ok, failed, events };
}

/** GET /api/traffic/v1/events.json: the compact list, cached TRAFFIC_S at the edge; 502 when no feed answered. */
export async function trafficResponse(env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request("https://apexnav.cache/traffic/v1/events.json");
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return new Response(hit.body, { headers: hit.headers });
  const out = await trafficEvents(env, fetcher);
  if (!out.sources.length) return new Response(JSON.stringify({ error: "traffic_unavailable" }), { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store", ...SEC } });
  const res = new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${TRAFFIC_S}`, ...SEC } });
  if (cache) await cache.put(key, res.clone());
  return res;
}
