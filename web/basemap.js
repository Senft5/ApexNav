// The theme's basemap (web/themes.js `map` palettes) painted onto OpenFreeMap's vector style: shared by the cockpit
// (web/index.html) and the car's screen (web/carmap.js), so CarPlay shows the same Roadbook or Tapedeck map as the phone.
(function (root) {
  'use strict';

  /** Repaints the style's own layers in the palette P ({bg, water, waterLine, land, wood, road, roadMinor, casing, label,
   *  halo, boundary, contour, shadow, highlight, accentShade}); buildings, POIs and house numbers are hidden. Layers whose
   *  id starts with "apex-" are the page's own and are left alone, except the terrain ones named below. */
  // F-09 (REVIEW_FEEL): which property of which layer takes which palette colour is worked out once per style (the layer
  // ids and types, from getLayersOrder; getStyle() serialised all 122 layers on every switch), and a switch only sets the
  // values that changed since the last one.
  const plans = new WeakMap();
  function plan(map) {
    const ids = map.getLayersOrder ? map.getLayersOrder() : map.getStyle().layers.map((l) => l.id), key = ids.join('|');
    const owner = map.style || map, had = plans.get(owner);             // a new style (setStyle) is planned afresh
    if (had && had.key === key) return had;
    const ops = [], hide = [];
    for (const lid of ids) {
      const id = lid.toLowerCase(), lyr = map.getLayer(lid);
      if (!lyr || id.startsWith('apex-')) continue;
      const add = (k, v) => ops.push([lid, k, v]);                     // v: a palette key, or a fixed value in an array
      if (/building|poi|housenumber|aeroway|ferry/.test(id)) { hide.push(lid); continue; }
      if (lyr.type === 'background') add('background-color', 'bg');
      else if (lyr.type === 'fill') {
        if (id.includes('water')) add('fill-color', 'water');
        else if (/wood|forest|park|grass|scrub|wetland/.test(id)) { add('fill-color', 'wood'); add('fill-opacity', [0.7]); }
        else { add('fill-color', 'land'); add('fill-opacity', [0.5]); }
        add('fill-outline-color', ['rgba(0,0,0,0)']);
      } else if (lyr.type === 'line') {
        if (id.includes('water')) add('line-color', 'waterLine');
        else if (id.includes('boundary')) add('line-color', 'boundary');
        else if (/road|transportation|highway|bridge|tunnel|street|path/.test(id)) {
          const minor = /minor|service|track|path|street|residential/.test(id);
          add('line-color', id.includes('casing') ? 'casing' : (minor ? 'roadMinor' : 'road'));
        } else if (/rail/.test(id)) add('line-color', 'boundary');
      } else if (lyr.type === 'symbol') { add('text-color', 'label'); add('text-halo-color', 'halo'); add('text-halo-width', [1.4]); add('icon-opacity', [0]); }
    }
    const p = { key, ops, hide, set: new Map(), hidden: false };
    plans.set(owner, p);
    return p;
  }
  function restyle(map, P) {
    const p = plan(map);
    if (!p.hidden) { for (const lid of p.hide) { try { map.setLayoutProperty(lid, 'visibility', 'none'); } catch (_) {} } p.hidden = true; }
    const put = (lid, k, v) => { const key = lid + '|' + k; if (v === undefined || p.set.get(key) === v) return; try { map.setPaintProperty(lid, k, v); p.set.set(key, v); } catch (_) {} };
    for (const [lid, k, v] of p.ops) put(lid, k, Array.isArray(v) ? v[0] : P[v]);
    const has = (id) => map.getLayer(id);
    if (has('apex-hillshade')) {
      put('apex-hillshade', 'hillshade-shadow-color', P.shadow);
      put('apex-hillshade', 'hillshade-highlight-color', P.highlight);
      put('apex-hillshade', 'hillshade-accent-color', P.accentShade);
      put('apex-hillshade', 'hillshade-exaggeration', 0.36);
    }
    if (has('apex-contours')) put('apex-contours', 'line-color', P.contour);
    if (has('apex-contour-labels')) { put('apex-contour-labels', 'text-color', P.contour); put('apex-contour-labels', 'text-halo-color', P.bg); }
  }

  root.ApexBasemap = { restyle };
})(typeof window !== 'undefined' ? window : globalThis);
