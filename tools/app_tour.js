// A recorded tour of the whole app for review: every tab, sheet and menu, a planned route driven by simulated GPS with
// spoken directions and notes, a demo replay with pace notes, the Log, Stages, Crew and Settings. The video comes from
// Playwright; the co-driver's audio is tapped from WebAudio and muxed in; every spoken line (including device-voice
// lines a headless browser can't play) is logged with its time and burned in as a caption under the screen.
// Run: node tools/app_tour.js [scene ...]   (OUT=dir, default ./tour-out). Needs the network (map tiles, router).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const WEB = path.join(__dirname, '..', 'web'), OUT = path.resolve(process.env.OUT || 'tour-out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.m4a': 'audio/mp4', '.wasm': 'application/wasm', '.webmanifest': 'application/json', '.bin': 'application/octet-stream' };
const server = http.createServer((q, r) => {
  let p = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(b); });
}).listen(0);
const START = { latitude: 35.3626, longitude: -84.2866 };                 // Tellico Plains, TN
const NEWS_ID = /id: '([^']+)'/.exec(fs.readFileSync(path.join(WEB, 'whats_new.js'), 'utf8'))[1];

// In the page before anything loads: tap WebAudio into a recorder, log every line the speech queue hands out and every
// device-voice utterance, so the review hears and reads what a driver would.
function pageHooks() {
  const log = (kind, text) => window.__tourLog && window.__tourLog({ at: Date.now(), kind, text });   // wall clock: the page reloads between scenes
  // every clip the co-driver plays goes through an AudioBufferSourceNode: send each buffer once and each start with its
  // wall-clock time, and the tour rebuilds the soundtrack exactly (a live MediaRecorder tap dropped data)
  if (window.AudioBufferSourceNode) {
    const ids = new WeakMap(); let next = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration) {
      try {
        const b = this.buffer, ctx = this.context;
        if (b && window.__tourClip) {
          let id = ids.get(b);
          if (id == null) {
            ids.set(b, id = next++);
            const ch = b.getChannelData(0), u = new Uint8Array(ch.buffer.slice(ch.byteOffset, ch.byteOffset + ch.byteLength));
            let str = ''; for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode(...u.subarray(i, i + 0x8000));
            window.__tourClip({ id, rate: b.sampleRate, pcm: btoa(str) });
          }
          const at = Date.now() + Math.max(0, (when || 0) - ctx.currentTime) * 1000;
          window.__tourPlay({ id, at, offset: offset || 0, duration: duration == null ? null : duration, speed: this.playbackRate ? this.playbackRate.value : 1 });
        }
      } catch (_) {}
      return start.call(this, when, offset, duration);
    };
  }
  if (window.speechSynthesis) { const speak = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = (u) => { log('device voice', u.text); return speak(u); }; }
  let q = window.ApexSpeechQueue;
  Object.defineProperty(window, 'ApexSpeechQueue', { configurable: true, get: () => q, set: (v) => {
    q = v && v.createSpeechQueue ? { ...v, createSpeechQueue: (...a) => { const sq = v.createSpeechQueue(...a); const take = sq.take.bind(sq);
      sq.take = (...b) => { const it = take(...b); if (it) log(it.kind === 'hazard' ? 'hazard' : it.chain ? 'note' : 'line', it.text); return it; }; return sq; } } : v;
  } });
}

const scenes = {};
const scene = (name, fn) => { scenes[name] = fn; };

scene('first-run', async ({ page, base, cap }) => {
  await cap('First run: onboarding');
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(4000);
  for (let i = 0; i < 6; i++) {
    const next = await page.$('#obNext:visible');
    if (!next) break;
    await page.waitForTimeout(2500); await next.click().catch(() => {});
  }
  await page.waitForTimeout(3000);
});

scene('map', async ({ page, base, cap, fresh }) => {
  await fresh();
  await cap('Map: idle cockpit');
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.waitForTimeout(5000);
  await cap('Map: style switches');
  if (await page.isVisible('#swTab')) { await page.click('#swTab'); await page.waitForTimeout(3000); await page.click('#swTab').catch(() => {}); await page.waitForTimeout(1500); }
});

scene('plan', async ({ page, base, cap, fresh, ctx }) => {
  await fresh();
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.waitForTimeout(2500);
  await cap('Where to?: search');
  await page.click('#destInput'); await page.waitForTimeout(1500);
  await page.type('#destInput', 'Robbinsville', { delay: 120 });
  await page.waitForSelector('#placeList .place', { timeout: 15000 }); await page.waitForTimeout(2000);
  await cap('Route: planning and the route card');
  await page.click('#placeList .place');
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && t.steps && t.steps.length; }, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.click('#routeBar'); await page.waitForTimeout(4000);
  await page.mouse.wheel(0, 600); await page.waitForTimeout(2500); await page.mouse.wheel(0, -600); await page.waitForTimeout(1000);
  // the option list re-renders on each pick, so look the buttons up again every time
  const opt = (i) => page.locator('#routeCardOptions button').nth(i);
  if (await page.locator('#routeCardOptions button').count() > 1) {
    await cap('Route: the second option'); await opt(1).click(); await page.waitForTimeout(6000);
    await opt(0).click().catch(() => {}); await page.waitForTimeout(5000);
  }
  await cap('Route: Preview (flyover)');
  if (await page.isVisible('#routePreviewBtn')) { await page.click('#routePreviewBtn'); await page.waitForTimeout(14000); await page.keyboard.press('Escape'); await page.waitForTimeout(1500); }
  if (!(await page.isVisible('#routeDriveBtn'))) await page.click('#routeBar').catch(() => {});
  await cap('Drive: start, permissions');
  await page.click('#routeDriveBtn'); await page.waitForTimeout(2500);
  if (await page.isVisible('#permGo')) { await page.click('#permGo'); }
  await cap('Drive: simulated GPS along the route (spoken directions and notes)');
  // drive 2.5 km of the route at about 15 m/s, a fix every 333 ms
  const pts = await page.evaluate(() => {
    const t = window.apexDebug.track, out = [];
    for (let m = 0, i = 0; m < Math.min(2500, t.dist[t.dist.length - 1]); m += 5) {
      while (i < t.dist.length - 2 && t.dist[i + 1] < m) i++;
      const f = (m - t.dist[i]) / Math.max(1e-6, t.dist[i + 1] - t.dist[i]);
      out.push({ latitude: t.lat[i] + f * (t.lat[i + 1] - t.lat[i]), longitude: t.lon[i] + f * (t.lon[i + 1] - t.lon[i]) });
    }
    return out;
  });
  for (const p of pts) { await ctx.setGeolocation({ ...p, accuracy: 5 }); await page.waitForTimeout(333); }
  await cap('Drive: report a hazard');
  if (await page.isVisible('#hzReportBtn')) { await page.click('#hzReportBtn'); await page.waitForTimeout(3000); await page.click('#hzCancel').catch(() => {}); await page.waitForTimeout(1500); }
  await cap('Drive: end and the drive summary');
  if (await page.isVisible('#driveEnd')) { await page.click('#driveEnd'); await page.waitForTimeout(6000); }
});

scene('replay', async ({ page, base, cap, fresh }) => {
  await fresh();
  await cap('Replay: demo drive with pace notes');
  await page.goto(`${base}/index.html?drive=dry_ridge&play=1`);
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apexDebug.track.events.length);
  await page.evaluate(() => { const st = window.apexDebug.state, t = window.apexDebug.track; st.cursorM = t.dist[t.dist.length - 1] * 0.45; });
  await page.waitForTimeout(75000);
});

scene('loops', async ({ page, base, cap, fresh }) => {
  await fresh();
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.waitForTimeout(2000);
  await cap('Loops: a 30-minute loop');
  await page.click('#destInput'); await page.waitForTimeout(1500);
  const loop = await page.$('#planBody button:has-text("30")');
  if (loop) { await loop.click(); await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route'; }, null, { timeout: 150000 }).catch(() => {}); await page.waitForTimeout(4000); await page.click('#routeBar').catch(() => {}); await page.waitForTimeout(5000); }
  await page.click('#planClear').catch(() => {}); await page.waitForTimeout(1500);
  await cap('Explore: roads nearby');
  await page.click('#destInput').catch(() => {}); await page.waitForTimeout(1000);
  const ex = await page.$('#planBody button:has-text("15 min")');
  if (ex) { await ex.click(); await page.waitForTimeout(20000); }
});

async function tab(page, cap, name, label) {
  await cap(label);
  // the map page's tab bar is buttons; Log and Stages are their own page, whose tab bar is links
  const LABEL = { map: 'Map', log: 'Log', stages: 'Stages', crew: 'Crew', setup: 'Settings' };
  await page.click(`#tabbar .tab[data-view="${name}"], nav.tabbar a:has(span:text-is("${LABEL[name]}"))`); await page.waitForTimeout(2500);
  await page.mouse.move(195, 480);   // over the content, not the header, so the wheel scrolls it
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(1300); }
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -500);
  await page.waitForTimeout(1000);
}

scene('tabs', async ({ page, base, cap, fresh }) => {
  await fresh();
  await page.goto(`${base}/index.html?drive=dry_ridge`);
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.waitForTimeout(3000);
  await tab(page, cap, 'log', 'Log: drives');
  const d = await page.$('#sheet .drive-row, #sheet [data-drive], #planBody .drive, .drive-list a, [data-drive-id]');
  if (d) { await cap('Log: a drive'); await d.click(); await page.waitForTimeout(4000); for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(1300); } }
  await tab(page, cap, 'stages', 'Stages');
  await tab(page, cap, 'crew', 'Crew (signed out)');
  await tab(page, cap, 'setup', 'Settings: every section');
  await tab(page, cap, 'map', 'Map');
});

scene('member', async ({ page, base, cap, fresh, ctx }) => {
  await fresh(true);
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await page.waitForTimeout(2500);
  await tab(page, cap, 'crew', 'Crew (a member, example data)');
  await tab(page, cap, 'setup', 'Settings (a member)');
});

// ---- Stills for the design review (REVIEW2.md U-37): every surface the mockups drew, stubbed with what a real account
// would show, so the next review judges them rather than an empty state. Each scene saves OUT/stills/NAME.png.
// Run just these: node tools/app_tour.js route-card friends-map plan-drive crew-board tapedeck-drive
function polyline6(points) {
  let out = '', pLat = 0, pLon = 0;
  const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lat, lon] of points) { const a = Math.round(lat * 1e6), b = Math.round(lon * 1e6); out += enc(a - pLat) + enc(b - pLon); pLat = a; pLon = b; }
  return out;
}
// A mountain road between two places: tight bends (radius about 70 m) on a slower sweep, so the route card has corners,
// a profile with corner ticks and named legs. `alt` bends it differently for the alternatives.
function mountainTrip(locs, alt) {
  const a = locs[0], b = locs[locs.length - 1], n = 4000, pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, env = Math.sin(t * Math.PI);
    const wig = (Math.sin(t * Math.PI * (220 + alt * 40)) * 0.0007 + Math.sin(t * Math.PI * (9 + alt * 3)) * (0.004 + alt * 0.002)) * env;
    pts.push([a.lat + (b.lat - a.lat) * t + wig, a.lon + (b.lon - a.lon) * t - wig]);
  }
  const km = 31 + alt * 4, names = [['Cherohala Skyway', 'Santeetlah Road'], ['Tellico River Road', 'Joyce Kilmer Road'], ['Mud Gap Road', 'Snowbird Road']][alt];
  return { legs: [{ shape: polyline6(pts), maneuvers: [
    { type: 1, begin_shape_index: 0, length: km * 0.6, street_names: [names[0]], instruction: `Drive east on ${names[0]}.` },
    { type: 10, begin_shape_index: Math.round(n * 0.6), length: km * 0.4, street_names: [names[1]], instruction: `Turn right onto ${names[1]}.` },
    { type: 4, begin_shape_index: n, length: 0, instruction: 'You have arrived.' }] }],
    summary: { length: km, time: 2700 + alt * 300, has_highway: false, has_toll: false, has_ferry: false } };
}

scene('route-card', async ({ page, base, cap, fresh, ctx, still }) => {
  await fresh();
  await ctx.route('https://valhalla1.openstreetmap.de/**', (r) => {
    const req = JSON.parse(r.request().postData() || '{}');
    if (!req.locations) return r.abort();
    const alts = Math.min(2, req.alternates || 0);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ trip: mountainTrip(req.locations, 0), alternates: Array.from({ length: alts }, (_, i) => ({ trip: mountainTrip(req.locations, i + 1) })) }) });
  });
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await cap('Route card: a mountain route with corners, its profile and two alternatives');
  await page.click('#destInput'); await page.fill('#destInput', 'Robbinsville');
  await page.waitForSelector('#placeList .place', { timeout: 15000 });
  await page.click('#placeList .place');
  await page.waitForFunction(() => { const t = window.apexDebug.track; return t && t.kind === 'route' && t.steps && t.steps.length; }, null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.click('#routeBar').catch(() => {}); await page.waitForTimeout(4000);
  await still('route-card');
  await page.mouse.move(195, 600); await page.mouse.wheel(0, 700); await page.waitForTimeout(1500);
  await still('route-card-2');
  await ctx.unroute('https://valhalla1.openstreetmap.de/**');
});

scene('friends-map', async ({ page, base, cap, fresh, still }) => {
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  await fresh((p) => {
    if (p === '/api/me') return { signed_in: true, member: true, handle: 'nate', name: 'Nate' };
    if (p === '/api/presence/settings') return { audience: 'friends', delay_s: 600, fuzz: true };
    if (p === '/api/presence') return [{ handle: 'sam', photo_id: null, delay_s: 600, fuzz: true, lat: 35.3690, lon: -84.2790, road: null, at: ago(11) },
      { handle: 'jules', photo_id: null, delay_s: 0, fuzz: false, lat: 35.3560, lon: -84.2960, road: 'Cherohala Skyway', at: ago(0.5) }];
  });
  await page.evaluate(() => { localStorage.setItem('apex.privacyZones', JSON.stringify([{ id: 'z1', name: 'Home', lat: 35.3640, lon: -84.2880, r: 300 }]));
    const prefs = JSON.parse(localStorage.getItem('apex.prefs') || '{}'); prefs.toggles = { ...(prefs.toggles || {}), friends: true }; localStorage.setItem('apex.prefs', JSON.stringify(prefs)); });
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.map);
  await cap('Friends on the map: two friends and a home zone');
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.apexDebug.state.follow = false; window.apexDebug.map.jumpTo({ center: [-84.2840, 35.3630], zoom: 13, pitch: 0 }); });   // both friends and home in view
  await page.waitForSelector('.fm-puck', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3500);
  console.log('  friends on the map:', await page.$$eval('.fm-puck', (p) => p.length), 'toggle', await page.evaluate(() => window.apexDebug.state.toggles.friends));
  await still('friends-map');
});

const CREW_API = () => {
  const soon = new Date(Date.now() + 4 * 86400e3); soon.setUTCHours(10, 30, 0, 0);   // 6:30 in Tellico Plains
  const at = (h) => new Date(Date.now() - h * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  return (p) => {
    if (p === '/api/me') return { signed_in: true, member: true, handle: 'nate', name: 'Nate' };
    if (p === '/api/crews') return [{ id: 'k1', name: 'Ridge Runners', role: 'owner', visibility: 'public', area_name: 'Tellico Plains, TN', members: 6 }];
    if (p === '/api/crews/k1/members') return [{ handle: 'nate', mine: true }, { handle: 'sam', mine: false }, { handle: 'jules', mine: false }, { handle: 'dee', mine: false }];
    if (p === '/api/crews/k1/page') return { id: 'k1', name: 'Ridge Runners', motto: 'Slow in, smooth out. Dawn runs, no heroes.', visibility: 'public', area_name: 'Tellico Plains, TN',
      members: 6, is_owner: true, crest: 'apex', crest_photo_id: null, stripe: '#c8102e', cover_photo_id: null, sharing_scores: true,
      livery: { tier: 'plain', decals: 0, next: { tier: 'club', at: 5 }, supporters: [], mine: { pro: false, decals: 0, on: true } },
      routes: [{ id: 'r1', name: 'Cherohala Skyway and back' }], stages: [{ id: 's1', name: 'Skyway climb' }],
      board: [{ handle: 'sam', score: 811, car: 'Mazda MX-5', mine: false }, { handle: 'jules', score: 764, car: 'Toyota GR86', mine: false },
        { handle: 'nate', score: 702, car: 'Mazda MX-5', mine: true }, { handle: 'dee', score: null, car: 'BMW 330i', mine: false }],
      next: { id: 'e1', title: 'Dawn run: Skyway and back', starts_at: soon.toISOString(), meet_name: "Tellico Plains Hardee's", going: ['sam', 'jules', 'dee'], my_rsvp: null } };
    if (p === '/api/crews/k1/chat') return [{ id: 'm1', handle: 'sam', body: 'Fog was gone by 7 last time. Same plan?', created_at: at(3), mine: false, photo_id: null },
      { id: 'm2', handle: 'jules', body: 'In. Bringing the radio.', created_at: at(1), mine: false, photo_id: null },
      { id: 'm3', handle: 'nate', body: 'Same plan. Full tanks, meet 6:15.', created_at: at(0.3), mine: true, photo_id: null }];
    if (p === '/api/events') return [{ id: 'e1', crew_id: 'k1', crew_name: 'Ridge Runners', title: 'Dawn run: Skyway and back', starts_at: soon.toISOString(), meet_name: "Tellico Plains Hardee's",
      meet_lat: 35.36, meet_lon: -84.29, notes: null, by_handle: 'sam', mine: false, can_cancel: false, my_rsvp: null, going: ['sam', 'jules', 'dee'], maybe: 1, lead: 'sam', sweep: 'jules', regroup: [] }];
    return undefined;
  };
};

scene('crew-board', async ({ page, base, cap, fresh, still }) => {
  await fresh(CREW_API());
  await page.goto(`${base}/index.html?view=crew`);
  await page.waitForSelector('.crew-page .cp-title h2', { timeout: 15000 });
  await cap('Crew: the board and the chat');
  await page.waitForTimeout(2000);
  await still('crew-board');
  const chat = await page.$('.cp-msg');
  if (chat) { await chat.scrollIntoViewIfNeeded(); await page.waitForTimeout(800); }
  await still('crew-chat');
});

scene('plan-drive', async ({ page, base, cap, fresh, still }) => {
  await fresh(CREW_API());
  await page.goto(`${base}/index.html?view=crew`);
  await page.waitForSelector('.crew-page .cp-title h2', { timeout: 15000 });
  await cap('Crew: Plan a drive, the form open');
  await page.evaluate(() => { const r = [...document.querySelectorAll('.nav-row')].find((b) => b.textContent.includes('Crew drives')); if (r) r.click(); });
  await page.waitForTimeout(600);
  await page.click('.side-pop.open button:has-text("Plan a drive")');
  await page.fill('.side-pop.open input[aria-label="Drive name"]', 'Dragon run').catch(() => {});
  await page.waitForTimeout(1200);
  await still('plan-drive');
});

scene('tapedeck-drive', async ({ page, base, cap, fresh, still }) => {
  await fresh();
  // as on a phone: the iOS shell's bridge is there (so frames feed a recorded drive), the drive starts from its link
  await page.addInitScript(() => { window.webkit = { messageHandlers: { apex: { postMessage() {} } } }; });
  await page.goto(`${base}/index.html?drive=dry_ridge`);
  await page.waitForFunction(() => window.apexDebug && window.apexDebug.track && window.apex && typeof window.apex.onNative === 'function');
  await cap('Tapedeck: a live drive, not a replay');
  await page.evaluate(() => window.apexDebug.tryTheme('tapedeck'));   // the trial starts from the demo replay; then drive
  await page.waitForTimeout(1500);
  const pts = await page.evaluate(() => { const t = window.apexDebug.track, out = [];
    for (let i = Math.floor(t.dist.length * 0.3); i < t.dist.length * 0.36; i++) out.push([t.lat[i], t.lon[i]]); return out; });
  await page.evaluate(() => window.apex.onNative({ type: 'link', params: { go: 'drive' } }));
  await page.waitForTimeout(600);
  if (await page.isVisible('#permSheet.show')) await page.click('#permGo');
  // frames as the shell pushes them (window.apex.live): a fix every 0.1 s at 22 m/s along the demo road
  let at = 1e6;
  for (let i = 1; i < pts.length; i++) {
    const [la, lo] = pts[i], [pa, po] = pts[i - 1], course = (Math.atan2((lo - po) * Math.cos(la * Math.PI / 180), la - pa) * 180 / Math.PI + 360) % 360;
    at += 100;
    await page.evaluate((f) => window.apex.live(f), { lat: la, lon: lo, t: at, accuracy_m: 4, speed_mps: 22, course_deg: course, has_fix: true, lat_g: 0.3 * Math.sin(i / 9), lon_g: 0, calibration: 'locked', recording: true, segments: i });
    await page.waitForTimeout(100);
    if (i === Math.floor(pts.length / 2)) await still('tapedeck-drive');
  }
  console.log('  mode:', await page.evaluate(() => window.apexDebug.state.mode), '·', await page.textContent('#dsMain'));
  await still('tapedeck-drive-2');
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/New_York',
    geolocation: START, permissions: ['geolocation'], recordVideo: { dir: OUT, size: { width: 390, height: 844 } } });
  const log = [], caps = [];
  const clock = Date.now();   // the video starts with the context
  await ctx.exposeFunction('__tourLog', (e) => log.push({ t: (e.at - clock) / 1000, kind: e.kind, text: e.text }));
  const clips = new Map(), plays = [];
  await ctx.exposeFunction('__tourClip', (c) => { const b = Buffer.from(c.pcm, 'base64'); clips.set(c.id, { rate: c.rate, pcm: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }); });
  await ctx.exposeFunction('__tourPlay', (p) => plays.push({ ...p, t: (p.at - clock) / 1000 }));
  await ctx.addInitScript(pageHooks);
  await ctx.route(`${base}/api/**`, (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await ctx.route('https://photon.komoot.io/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [
    { geometry: { coordinates: [-83.8074, 35.3229] }, properties: { name: 'Robbinsville', state: 'North Carolina', county: 'Graham County', type: 'city' } }] }) }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push({ t: (Date.now() - clock) / 1000, kind: 'page error', text: String(e.message || e).slice(0, 200) }));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) log.push({ t: (Date.now() - clock) / 1000, kind: 'console error', text: m.text().slice(0, 200) }); });
  const cap = async (text) => { caps.push({ t: (Date.now() - clock) / 1000, text }); console.log('·', text); };
  // a still of the screen as it is, for the design review (OUT/stills/NAME.png)
  const still = async (name) => { fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true }); await page.screenshot({ path: path.join(OUT, 'stills', `${name}.png`) }); };
  const fresh = async (member) => {
    await page.goto(`${base}/index.html?blank=1`).catch(() => {});
    await page.evaluate((id) => { localStorage.clear(); localStorage.setItem('apex.onboarded', '1'); localStorage.setItem('apex.newsSeen', id); localStorage.setItem('apex.prefs', JSON.stringify({ notesMode: 'full' })); }, NEWS_ID).catch(() => {});
    await ctx.unroute(`${base}/api/**`);
    if (typeof member === 'function') await ctx.route(`${base}/api/**`, (r) => {
      const u = new URL(r.request().url()), m = r.request().method(), b = member(u.pathname, m);
      if (b === undefined) return m === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fulfill({ status: 204 });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    });
    else if (member) await ctx.route(`${base}/api/**`, (r) => {
      const u = new URL(r.request().url()), json = (b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.pathname === '/api/me') return json({ signed_in: true, member: true, handle: 'nate', name: 'Nate', requests: 1 });
      if (u.pathname === '/api/crews') return json([{ id: 'C1', name: 'Ridge Runners', role: 'owner', members: 6, visibility: 'public' }]);
      if (u.pathname === '/api/friends') return json([{ id: 'U1', handle: 'sam', name: 'Sam', status: 'accepted', incoming: 0 }, { id: 'U2', handle: 'ali', name: 'Ali', status: 'pending', incoming: 1 }]);
      if (u.pathname === '/api/points') return json({ total: 140, weeks: [{ week: '2026-W43', octane: 22 }], board: [{ handle: 'nate', total: 140 }, { handle: 'sam', total: 96 }], pioneer: { firsts: 3, seconds: 1 }, month: null });
      return json([]);
    });
    // signed out, as the real server answers: /api/me says so, everything else is 401
    else await ctx.route(`${base}/api/**`, (r) => (new URL(r.request().url()).pathname === '/api/me'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"signed_in":false}' })
      : r.fulfill({ status: 401, contentType: 'application/json', body: '{}' })));
  };
  const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes);
  try {
    for (const name of want) {
      try { await scenes[name]({ page, base, cap, fresh, ctx, still }); }
      catch (e) { log.push({ t: (Date.now() - clock) / 1000, kind: 'tour error', text: `${name}: ${String(e.message || e).split('\n')[0]}` }); console.log('!', name, String(e.message || e).split('\n').slice(0, process.env.TOUR_DEBUG ? 12 : 1).join('\n')); }
    }
  } finally {
    const video = await page.video().path();
    await ctx.close(); await browser.close(); server.close();
    // the soundtrack: every clip mixed in at the moment it started (mono, 48 kHz, linear resampling)
    const RATE = 48000, total = Math.ceil(((Date.now() - clock) / 1000 + 5) * RATE), mix = new Float32Array(total);
    for (const p of plays) {
      const c = clips.get(p.id); if (!c) continue;
      const step = (c.rate / RATE) * (p.speed || 1), from = Math.round(p.offset * c.rate);
      const n = Math.floor((p.duration != null ? p.duration * c.rate : c.pcm.length - from) / step), at = Math.round(p.t * RATE);
      for (let i = 0; i < n && at + i < total; i++) { const x = from + i * step, k = Math.floor(x), f = x - k; if (k + 1 >= c.pcm.length) break; mix[at + i] += c.pcm[k] * (1 - f) + c.pcm[k + 1] * f; }
    }
    const tracks = [];
    if (plays.length) {
      const wav = Buffer.alloc(44 + total * 2);
      wav.write('RIFF', 0); wav.writeUInt32LE(36 + total * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(total * 2, 40);
      for (let i = 0; i < total; i++) wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mix[i] * 32767))), 44 + i * 2);
      tracks.push({ f: path.join(OUT, 'voice.wav'), at: 0 }); fs.writeFileSync(tracks[0].f, wav);
    }
    fs.writeFileSync(path.join(OUT, 'speech.json'), JSON.stringify({ chapters: caps, log }, null, 1));
    // captions: the chapter on top, spoken lines and errors under it
    const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = (s % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${x}`; };
    const esc = (s) => String(s).replace(/[{}\\]/g, '').replace(/\n/g, ' ');
    let ass = '[Script Info]\nScriptType: v4.00+\nPlayResX: 390\nPlayResY: 1000\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Alignment, MarginV, BorderStyle, Outline, Shadow\n'
      + 'Style: Chapter,Inter,17,&H00FFFFFF,&H00000000,&H00000000,1,8,8,1,0,0\nStyle: Line,Inter,15,&H0055DDFF,&H00000000,&H00000000,0,8,34,1,0,0\nStyle: Err,Inter,13,&H004040FF,&H00000000,&H00000000,0,8,58,1,0,0\n\n[Events]\nFormat: Layer, Start, End, Style, Text\n';
    caps.forEach((c, i) => { ass += `Dialogue: 0,${ts(c.t)},${ts(caps[i + 1] ? caps[i + 1].t : c.t + 600)},Chapter,${esc(c.text)}\n`; });
    log.forEach((l) => { const err = /error/.test(l.kind); ass += `Dialogue: 0,${ts(l.t)},${ts(l.t + (err ? 4 : 3.5))},${err ? 'Err' : 'Line'},${esc(`${l.kind}: ${l.text}`)}\n`; });
    fs.writeFileSync(path.join(OUT, 'captions.ass'), ass);
    const outFile = path.join(OUT, 'app-tour.mp4');
    const args = ['-y', '-i', video, ...tracks.flatMap((t) => ['-i', t.f])];
    const vf = `pad=390:1000:0:156:color=0x1b1b1b,subtitles=${path.join(OUT, 'captions.ass')}`;
    if (tracks.length) {
      const mix = tracks.map((t, i) => `[${i + 1}:a]adelay=${Math.round(t.at * 1000)}|${Math.round(t.at * 1000)}[a${i}]`).join(';') + ';' + tracks.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${tracks.length}:normalize=0[a]`;
      args.push('-filter_complex', `[0:v]${vf}[v];${mix}`, '-map', '[v]', '-map', '[a]');
    } else args.push('-vf', vf);
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', outFile);
    try { execFileSync('ffmpeg', args, { stdio: 'pipe' }); console.log('wrote', outFile); } catch (e) { console.log('ffmpeg failed', String(e.stderr || e).slice(-800)); }
  }
})();
