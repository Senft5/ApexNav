// The opening cover (review 2026-10-29): the page starts behind a plain panel with the Vetta lockup (the launch screen's, at
// its size and place, REVIEW4 U-80), in the theme's own
// colour (themes.js puts the last look back from <head>), and fades out once the page has drawn: on the map page when the
// basemap is styled, elsewhere after the first render. So a launch or a page change never shows day colours, an unstyled
// map or a half-built page. It never stays longer than MAX_MS, whatever happens (offline, a slow map).
(function (root) {
  'use strict';
  const MAX_MS = 2500;
  let gone = false;
  function done() {
    if (gone) return;
    gone = true;
    const el = root.document.getElementById('boot');
    if (!el) return;
    el.classList.add('gone');
    root.setTimeout(() => el.remove(), 250);
  }
  root.ApexBoot = { done, MAX_MS };
  // The web fonts' stylesheet (<link id="webFonts" media="print">) applies once it has loaded, so it never holds the scripts
  // back on a slow network (index.html, analysis.html).
  const fonts = root.document && root.document.getElementById('webFonts');
  if (fonts) {
    const on = () => { fonts.media = 'all'; };
    if (fonts.sheet) on(); else fonts.addEventListener('load', on, { once: true });
  }
  root.addEventListener('DOMContentLoaded', () => root.setTimeout(done, MAX_MS));
})(window);
