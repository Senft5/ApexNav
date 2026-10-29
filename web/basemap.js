// The theme's basemap (web/themes.js `map` palettes) painted onto OpenFreeMap's vector style: shared by the cockpit
// (web/index.html) and the car's screen (web/carmap.js), so CarPlay shows the same Roadbook or Tapedeck map as the phone.
(function (root) {
  'use strict';

  /** Repaints the style's own layers in the palette P ({bg, water, waterLine, land, wood, road, roadMinor, casing, label,
   *  halo, boundary, contour, shadow, highlight, accentShade}); buildings, POIs and house numbers are hidden. Layers whose
   *  id starts with "apex-" are the page's own and are left alone, except the terrain ones named below. */
  function restyle(map, P) {
    for (const lyr of map.getStyle().layers) {
      const id = lyr.id.toLowerCase();
      if (id.startsWith('apex-')) continue;
      const set = (k, v) => { try { map.setPaintProperty(lyr.id, k, v); } catch (_) {} };
      if (/building|poi|housenumber|aeroway|ferry/.test(id)) { try { map.setLayoutProperty(lyr.id, 'visibility', 'none'); } catch (_) {} continue; }
      if (lyr.type === 'background') set('background-color', P.bg);
      else if (lyr.type === 'fill') {
        if (id.includes('water')) set('fill-color', P.water);
        else if (/wood|forest|park|grass|scrub|wetland/.test(id)) { set('fill-color', P.wood); set('fill-opacity', 0.7); }
        else { set('fill-color', P.land); set('fill-opacity', 0.5); }
        set('fill-outline-color', 'rgba(0,0,0,0)');
      } else if (lyr.type === 'line') {
        if (id.includes('water')) set('line-color', P.waterLine);
        else if (id.includes('boundary')) set('line-color', P.boundary);
        else if (/road|transportation|highway|bridge|tunnel|street|path/.test(id)) {
          const minor = /minor|service|track|path|street|residential/.test(id);
          set('line-color', id.includes('casing') ? P.casing : (minor ? P.roadMinor : P.road));
        } else if (/rail/.test(id)) set('line-color', P.boundary);
      } else if (lyr.type === 'symbol') { set('text-color', P.label); set('text-halo-color', P.halo); set('text-halo-width', 1.4); set('icon-opacity', 0); }
    }
    const has = (id) => map.getLayer(id);
    if (has('apex-hillshade')) {
      map.setPaintProperty('apex-hillshade', 'hillshade-shadow-color', P.shadow);
      map.setPaintProperty('apex-hillshade', 'hillshade-highlight-color', P.highlight);
      map.setPaintProperty('apex-hillshade', 'hillshade-accent-color', P.accentShade);
      map.setPaintProperty('apex-hillshade', 'hillshade-exaggeration', 0.36);
    }
    if (has('apex-contours')) map.setPaintProperty('apex-contours', 'line-color', P.contour);
    if (has('apex-contour-labels')) { map.setPaintProperty('apex-contour-labels', 'text-color', P.contour); map.setPaintProperty('apex-contour-labels', 'text-halo-color', P.bg); }
  }

  root.ApexBasemap = { restyle };
})(typeof window !== 'undefined' ? window : globalThis);
