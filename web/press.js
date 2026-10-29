// Press feedback on both pages (index.html, analysis.html). iOS WebKit only applies :active while some touchstart listener
// exists on the page, so without this no control visibly reacts to a finger and the app feels unresponsive (the owner,
// 2026-10-29). The listener does nothing and is passive: scrolling is untouched. The look itself is in controls.css.
(function (root) {
  'use strict';
  if (root.document) root.document.addEventListener('touchstart', function () {}, { passive: true });
})(typeof window !== 'undefined' ? window : globalThis);
