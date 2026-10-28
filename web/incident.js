// Crash check (IDEAS D-17): a hard impact while moving, then the car stopped and staying stopped, asks "Are you OK?".
// No answer in a minute (or "Get help") shows one-tap ways to call emergency services and to text the contact you chose,
// with where you are. The phone can't send a text or place a call by itself; the driver or someone with them taps.
// A backup, never a replacement for the phone's own crash detection or for calling for help.
// createDetector() is pure (tests/test_incident.py); mount() is the page's sheet.
(function (root) {
  'use strict';
  const IMPACT_G = 6;              // a phone falling onto a seat or a deep pothole in a mount is ~2-5 g; crash pulses are 20 g and more
  const MOVING_MPS = 7;            // ~16 mph in the 5 s before the impact: a parking bump or a dropped phone at a stop isn't one
  const STOP_MPS = 1.5;
  const STOP_WITHIN_S = 15;        // the car comes to rest soon after the impact...
  const STILL_S = 8;               // ...and stays there
  const COOLDOWN_S = 600;
  const ANSWER_S = 60;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * Feed it live frames { t (ms), speed_mps, impact_g }. Returns 'ask' once when a crash looks likely, else null.
   * Unknown impact (no motion data) never starts a check; unknown speed never confirms one.
   */
  function createDetector() {
    const speeds = [];                 // [t, v] over the last 5 s
    let spike = null, stoppedAt = null, lastAsk = -Infinity;
    return {
      update(f) {
        if (!f || !finite(f.t)) return null;
        const v = finite(f.speed_mps) ? f.speed_mps : null;
        if (v != null) { speeds.push([f.t, v]); while (speeds.length && f.t - speeds[0][0] > 5000) speeds.shift(); }
        if (!spike && finite(f.impact_g) && f.impact_g >= IMPACT_G && (f.t - lastAsk) / 1000 >= COOLDOWN_S
            && speeds.some(([, s]) => s >= MOVING_MPS)) { spike = f.t; stoppedAt = null; }
        if (!spike) return null;
        if (v == null) return null;
        if (v <= STOP_MPS) { if (stoppedAt == null) stoppedAt = f.t; }
        else stoppedAt = null;
        if (stoppedAt == null && (f.t - spike) / 1000 > STOP_WITHIN_S) { spike = null; return null; }   // drove on: a pothole or the phone
        if (stoppedAt != null && (f.t - stoppedAt) / 1000 >= STILL_S) { spike = null; lastAsk = f.t; return 'ask'; }
        return null;
      },
    };
  }

  /** The emergency number for the phone's region: 911 in North America, 112 elsewhere (it works from any GSM phone). */
  function emergencyNumber(locale) {
    const region = String(locale || '').split(/[-_]/)[1] || '';
    return /^(US|CA|MX|PR|GU|VI|AS|MP)$/i.test(region) ? '911' : '112';
  }

  /** The text for the contact: what happened and where, with a maps link; position unknown says so. */
  function helpText(pos) {
    const at = pos && finite(pos.lat) && finite(pos.lon)
      ? ` I'm at https://maps.apple.com/?ll=${pos.lat.toFixed(5)},${pos.lon.toFixed(5)}&q=Here` : ' My position is unknown.';
    return `Vetta sensed a hard impact and I haven't answered.${at}`;
  }
  /** An sms: link (the body after "&" works on iOS, "?" on Android); digits and + only from the stored number. */
  function smsHref(number, body, ios) {
    const n = String(number || '').replace(/[^\d+]/g, '');
    return n ? `sms:${n}${ios ? '&' : '?'}body=${encodeURIComponent(body)}` : null;
  }

  const CSS = `
    .crash-sheet { position: fixed; inset: 0; z-index: 60; background: var(--panel); color: var(--panel-ink); display: grid; align-content: center;
      gap: 16px; padding: 24px 20px calc(24px + var(--safe-bottom, 0px)); text-align: center; }
    .crash-sheet h2 { margin: 0; font-size: 34px; }
    .crash-sheet .big { font-size: 22px; padding: 18px; width: 100%; max-width: 420px; justify-self: center; }
    .crash-sheet .count { font-size: 15px; color: var(--panel-dim); }
  `;

  /**
   * The page lends el, say (speech), haptic, contact() → {name, phone}|null, position() → {lat, lon}|null.
   * Returns { ask() }: shows the sheet (one at a time).
   */
  function mount(page) {
    const { el, say, haptic, contact, position } = page;
    if (!document.getElementById('crash-css')) document.head.append(el('style', { id: 'crash-css', textContent: CSS }));
    let open = null;
    function close() { if (open) { clearInterval(open.timer); open.node.remove(); open = null; } }
    function help(node) {
      const c = contact(), pos = position(), num = emergencyNumber(navigator.language);
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      node.replaceChildren(el('h2', { textContent: 'Get help' }),
        el('a', { className: 'ink-btn solid big', href: `tel:${num}`, textContent: `Call ${num}` }));
      const href = c && smsHref(c.phone, helpText(pos), ios);
      if (href) node.append(el('a', { className: 'ink-btn big', href, textContent: `Text ${c.name || c.phone}` }));
      else node.append(el('p', { className: 'note', textContent: 'Add an emergency contact in Settings → Crash check to text someone from here.' }));
      node.append(el('p', { className: 'note', textContent: 'Your phone opens the call or the message; nothing is sent until you (or someone with you) taps.' }));
      const ok = el('button', { className: 'ink-btn big', textContent: 'I\'m OK, close' });
      ok.addEventListener('click', close);
      node.append(ok);
    }
    function ask() {
      if (open) return;
      const node = el('div', { className: 'crash-sheet' });
      node.setAttribute('role', 'alertdialog'); node.setAttribute('aria-modal', 'true'); node.setAttribute('aria-label', 'Are you OK?');
      const count = el('p', { className: 'count' });
      const okBtn = el('button', { className: 'ink-btn solid big', textContent: 'I\'m OK' });
      const helpBtn = el('button', { className: 'ink-btn big', textContent: 'Get help' });
      node.append(el('h2', { textContent: 'Are you OK?' }), el('p', { textContent: 'Vetta sensed a hard impact and then a stop.' }), okBtn, helpBtn, count);
      document.body.append(node);
      let left = ANSWER_S;
      const tick = () => { count.textContent = `Showing ways to get help in ${left} s`; };
      tick();
      open = { node, timer: setInterval(() => { left--; if (left <= 0) { clearInterval(open.timer); help(node); } else tick(); }, 1000) };
      okBtn.addEventListener('click', close);
      helpBtn.addEventListener('click', () => { clearInterval(open.timer); help(node); });
      try { haptic('hazard'); } catch (_) {}
      try { say('Are you OK? Tap I\'m OK, or get help.'); } catch (_) {}
      okBtn.focus();
    }
    return { ask, close };
  }

  const api = { createDetector, emergencyNumber, helpText, smsHref, mount, IMPACT_G, MOVING_MPS, STILL_S, STOP_WITHIN_S, COOLDOWN_S, ANSWER_S };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexIncident = api;
})(typeof window !== 'undefined' ? window : globalThis);
