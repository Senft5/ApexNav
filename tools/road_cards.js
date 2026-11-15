// A link card for every road in the road library (big bet #6, 2026-11-15): a 1200 x 630 JPEG of the road on the real map
// (OpenFreeMap's dark style, the road in Vetta's red on a white casing), its name and facts under it and VETTA beside them.
// A link to vettadrive.app/roads/<id> pasted into Messages, X, Discord or Slack then shows the road, not the app icon
// (backend/src/road_library.ts, og:image when R2 has the card). .github/workflows/road-cards.yml runs this and uploads
// the cards to R2 (roads/v1/<id>.jpg) after each change to web/data/road_library.json.
//   node tools/road_cards.js OUT_DIR [road-id ...]     (needs Playwright's Chromium and the map's servers)
// A card that fails (no map in WAIT_MS) is skipped and listed; the road's page keeps the app icon.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const W = 1200, H = 630, MAP_H = 470, WAIT_MS = 20000;
const STYLE = 'https://tiles.openfreemap.org/styles/dark';

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="vendor/maplibre-gl.css"><style>@font-face{font-family:"Barlow Condensed";font-weight:800;font-display:block;src:url(fonts/barlow-condensed-800.woff2) format("woff2")}@font-face{font-family:"Inter Tight";font-weight:400 700;font-display:block;src:url(fonts/inter-tight.woff2) format("woff2")}</style>
<style>html,body{margin:0;background:#0A0A0B}#card{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#0A0A0B;font-family:"Inter Tight",system-ui,sans-serif}
#map{position:absolute;left:0;top:0;width:${W}px;height:${MAP_H}px}.maplibregl-ctrl-attrib,.maplibregl-ctrl-logo{display:none!important}
#bar{position:absolute;left:0;right:0;top:${MAP_H}px;bottom:0;display:flex;align-items:center;gap:32px;padding:0 48px;border-top:4px solid #FF3341}
#txt{flex:1;min-width:0}#name{font:800 64px/1 "Barlow Condensed","Arial Narrow",sans-serif;text-transform:uppercase;color:#F5F5F7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#facts{margin-top:12px;font-size:30px;color:#A0A3AB;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#mark{font:800 44px/1 "Barlow Condensed",sans-serif;letter-spacing:.08em;color:#F5F5F7}</style>
<script src="vendor/maplibre-gl.js"></script></head><body><div id="card"><div id="map"></div><div id="bar"><div id="txt"><div id="name"></div><div id="facts"></div></div><div id="mark">VETTA</div></div></div>
<script>
const map = new maplibregl.Map({ container: 'map', style: ${JSON.stringify(STYLE)}, interactive: false, attributionControl: false, fadeDuration: 0, preserveDrawingBuffer: true, center: [-84, 38], zoom: 5 });
const ready = new Promise((ok) => map.on('load', () => {
  map.addSource('road', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'casing', type: 'line', source: 'road', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.9, 'line-width': 13 } });
  map.addLayer({ id: 'line', type: 'line', source: 'road', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FF3341', 'line-width': 7 } });
  ok();
}));
// the faces (font-display: block here, not the app's optional) are loaded before the first card is drawn
const faces = Promise.all(['800 64px "Barlow Condensed"', '400 30px "Inter Tight"'].map((f) => document.fonts.load(f))).catch(() => null);
window.show = async (line, name, facts) => {
  await ready; await faces;
  document.getElementById('name').textContent = name;
  document.getElementById('facts').textContent = facts;
  map.getSource('road').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: line.map((p) => [p[1], p[0]]) } });
  const lats = line.map((p) => p[0]), lons = line.map((p) => p[1]);
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: { top: 48, bottom: 48, left: 80, right: 80 }, animate: false, maxZoom: 15 });
  await new Promise((ok) => { if (map.loaded() && map.areTilesLoaded()) setTimeout(ok, 50); map.once('idle', ok); });
  return true;
};
</script></body></html>`;

const miles = (km) => { const mi = km / 1.609344; return mi >= 10 ? `${Math.round(mi)}` : mi.toFixed(1); };
/** The card's line under the name (the road page's facts, web words). */
function factsLine(road, area) {
  return `${miles(road.km)} mi · ${road.corners} corners · near ${area.name}, ${area.state}`;
}

async function main() {
  const out = process.argv[2];
  if (!out) { console.error('usage: node tools/road_cards.js OUT_DIR [road-id ...]'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/road_library.json'), 'utf8'));
  const areas = new Map(lib.areas.map((a) => [a.id, a])), only = process.argv.slice(3);
  const roads = lib.roads.filter((r) => !only.length || only.includes(r.id));
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  // the page's own files (MapLibre, fonts) from web/; the map's tiles from OpenFreeMap
  await page.route('http://cards.local/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/') return r.fulfill({ contentType: 'text/html', body: PAGE });
    const f = path.join(ROOT, 'web', path.normalize(p).replace(/^([/\\])+/, ''));
    return f.startsWith(path.join(ROOT, 'web')) && fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404 });
  });
  await page.goto('http://cards.local/');
  const failed = [];
  let n = 0;
  for (const r of roads) {
    const a = areas.get(r.area);
    try {
      await Promise.race([page.evaluate(([line, name, facts]) => window.show(line, name, facts), [r.line, r.name, factsLine(r, a)]),
        new Promise((_, no) => setTimeout(() => no(new Error('map timeout')), WAIT_MS))]);
      await page.locator('#card').screenshot({ path: path.join(out, `${r.id}.jpg`), type: 'jpeg', quality: 82 });
      n++;
    } catch (e) { failed.push(`${r.id}: ${e.message}`); }
  }
  await browser.close();
  console.log(`${n} of ${roads.length} cards in ${out}`);
  for (const f of failed) console.log(`  failed ${f}`);
  if (!n && roads.length) process.exit(1);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { factsLine, miles };
