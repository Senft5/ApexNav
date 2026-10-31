// Low-power cockpit (docs/IDEAS.md P-02). A hot phone on the dash, iOS Low Power Mode or a battery under 20 % (not charging)
// drops the chase cam to 30 fps without road shake, the map to 2x pixels and hides hillshade and contours. Pure: the page
// feeds what it knows (app frames carry `thermal` 0-3 and `low_power_mode`; a browser may offer navigator.getBattery), this
// file says whether to save power and why. Unknown inputs keep their last value and never turn the saver on by themselves.
//   - thermal: on at critical (3), or at serious (2) held for 2 minutes, off at fair (1) or nominal (0). A phone charging on
//     a dash with GPS and CarPlay sits at serious much of the time (the owner, 2026-10-31: "it always thinks my phone is
//     warm"); serious alone is not a reason to dim the map;
//   - battery: on at <= 20 % while not charging, off at >= 25 % or once charging (no flapping around 20 %).
(function (root) {
  const THERMAL_ON = 3, THERMAL_SERIOUS = 2, SERIOUS_HOLD_MS = 120000, BATTERY_ON = 0.20, BATTERY_OFF = 0.25, LOW_FPS = 30;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  class PowerSaver {
    constructor() { this.seriousSince = null; this.hot = false; this.lowPowerMode = false; this.battery = false; this.low = false; this.lastDraw = -Infinity; }
    /** What the page knows now; any field may be missing. Returns true when `low` changed. */
    update({ thermal, lowPowerMode, batteryLevel, charging, t = Date.now() } = {}) {
      const was = this.low;
      if (finite(thermal)) {
        if (thermal >= THERMAL_ON) this.hot = true;
        else if (thermal >= THERMAL_SERIOUS) {
          if (this.seriousSince === null) this.seriousSince = t;
          if (t - this.seriousSince >= SERIOUS_HOLD_MS) this.hot = true;   // held hot ends here; a hot phone stays hot until fair
        } else { this.hot = false; this.seriousSince = null; }
        if (thermal >= THERMAL_ON && this.seriousSince === null) this.seriousSince = t;
      }
      if (typeof lowPowerMode === 'boolean') this.lowPowerMode = lowPowerMode;
      if (charging === true) this.battery = false;
      else if (finite(batteryLevel)) {
        if (batteryLevel <= BATTERY_ON && charging === false) this.battery = true;
        else if (batteryLevel >= BATTERY_OFF) this.battery = false;
      }
      this.low = this.hot || this.lowPowerMode || this.battery;
      return this.low !== was;
    }
    /** Why the saver is on, for the one-line notice (null when off). */
    get reason() {
      if (this.hot) return 'Phone is warm';
      if (this.lowPowerMode) return 'Low Power Mode';
      if (this.battery) return 'Battery low';
      return null;
    }
    /** Whether the camera loop should draw at animation-frame time ts (ms): every frame normally, 30 a second when low. */
    frameDue(ts) {
      if (!this.low || !finite(ts)) return true;
      if (ts - this.lastDraw < 1000 / LOW_FPS - 2) return false;   // 2 ms slack so a 60 Hz screen lands on every other frame
      this.lastDraw = ts;
      return true;
    }
  }

  const api = { PowerSaver, THERMAL_ON, SERIOUS_HOLD_MS, BATTERY_ON, BATTERY_OFF, LOW_FPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPower = api;
})(typeof window !== 'undefined' ? window : globalThis);
