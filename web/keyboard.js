// The on-screen keyboard (review 2026-10-28). iOS lays the keyboard over the page and pans it instead of resizing it, so
// fixed bars (the tab bar) end up floating mid-screen or behind the keyboard, and a sheet's own search field can be panned
// out of sight. While a text field has the keyboard, <html> gets `kb-open` and `--kb-h` (the height left above the
// keyboard), so pages hide the tab bar and fit their content above it; the field is kept in view.
(function (root) {
  'use strict';
  const NOT_TEXT = /^(button|checkbox|radio|range|submit|reset|file|color|image|hidden)$/i;
  /** Fields that open the keyboard. */
  function isText(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
    return el.tagName === 'INPUT' && !NOT_TEXT.test(el.type || 'text');
  }
  /** Open when a text field has focus and the visible height shrank by more than any toolbar could (120 px). */
  function keyboardOpen(innerH, viewportH, active) {
    return isText(active) && innerH - viewportH > 120;
  }
  const api = { isText, keyboardOpen };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.ApexKeyboard = api;

  const vv = root.visualViewport, doc = root.document, html = doc.documentElement;
  // In the app the shell says how many px the keyboard covers (ApexNavApp.swift keyboardMoved): the web view neither resizes
  // nor reports it reliably there. In a browser, the visual viewport tells.
  let nativeCover = null;
  api.native = (px) => { nativeCover = Number.isFinite(px) && px >= 0 ? px : null; soon(); };
  let raf = 0;
  function update() {
    raf = 0;
    const active = doc.activeElement;
    const open = nativeCover != null ? isText(active) && nativeCover > 120 : !!vv && keyboardOpen(root.innerHeight, vv.height, active);
    const above = nativeCover != null ? root.innerHeight - nativeCover : vv ? vv.height : root.innerHeight;
    html.classList.toggle('kb-open', open);
    if (open) {
      html.style.setProperty('--kb-h', `${Math.round(above)}px`);
      // the page itself never scrolls: undo iOS's pan and bring the field into view inside its own scroller instead
      if (root.scrollY || (vv && vv.offsetTop)) root.scrollTo(0, 0);
      // after the page has refitted, bring the field into view inside its own scroller
      root.requestAnimationFrame(() => {
        const r = active.getBoundingClientRect();
        if (r.bottom > above - 8 || r.top < 0) active.scrollIntoView({ block: 'center' });
      });
    } else html.style.removeProperty('--kb-h');
  }
  function soon() { if (!raf) raf = root.requestAnimationFrame(update); }
  if (vv) { vv.addEventListener('resize', soon); vv.addEventListener('scroll', soon); }
  doc.addEventListener('focusin', () => root.setTimeout(soon, 60));
  doc.addEventListener('focusout', () => root.setTimeout(soon, 60));
})(typeof window !== 'undefined' ? window : globalThis);
