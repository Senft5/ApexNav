// Big-target in-car mode (docs/IDEAS.md C-07, C-08). While the car moves, every control grows to at least 60 pt and the
// keyboard stays shut; a passenger can unlock typing with one clear switch. Pure: the page feeds GPS speed and the clock,
// this file says whether the car counts as moving. Hysteresis so a crawl in traffic or a GPS blip doesn't flicker the UI:
//   - moving after 3 s at >= 4.5 m/s (10 mph), still moving down to 1.5 m/s;
//   - stopped after 5 s below 1.5 m/s, or 10 s with no speed at all (no fix, or a browser that reports none).
// Unknown speed never turns the mode on: a phone that reports no speed is never treated as moving.
(function (root) {
  const GO_MPS = 4.5, STOP_MPS = 1.5, GO_MS = 3000, STOP_MS = 5000, STALE_MS = 10000;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  class MotionGate {
    constructor() { this.moving = false; this.since = null; this.lastSpeedAt = null; }
    /** One speed sample (m/s, or null when unknown) at t ms. Returns true when the moving state changed. */
    update(speedMps, t) {
      if (!finite(t)) return false;
      const was = this.moving;
      if (finite(speedMps) && speedMps >= 0) {
        this.lastSpeedAt = t;
        const wants = this.moving ? speedMps >= STOP_MPS : speedMps >= GO_MPS;   // the state the sample argues for
        if (wants === this.moving) this.since = null;
        else if (this.since == null) this.since = t;
        else if (t - this.since >= (this.moving ? STOP_MS : GO_MS)) { this.moving = wants; this.since = null; }
      } else if (this.moving && (this.lastSpeedAt == null || t - this.lastSpeedAt >= STALE_MS)) {
        this.moving = false; this.since = null;
      }
      return this.moving !== was;
    }
    /** No sample for a while (call from a timer): the stale rule still applies. */
    tick(t) { return this.update(null, t); }
  }

  /** Text fields that open the keyboard (buttons, checkboxes and ranges don't). */
  function opensKeyboard(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return !el.readOnly && !el.disabled;
    if (tag !== 'input' || el.readOnly || el.disabled) return el.isContentEditable === true;
    const type = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(type);
  }

  const api = { MotionGate, opensKeyboard, GO_MPS, STOP_MPS, GO_MS, STOP_MS, STALE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexInCar = api;
})(typeof window !== 'undefined' ? window : globalThis);
