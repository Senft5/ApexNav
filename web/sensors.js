// Web sensors for DRIVE mode: GPS (Geolocation API) and motion (DeviceMotion), turned into the same live frame the native app pushes
// through window.apex.live. Honest about what a browser can measure (CLAUDE.md: unknown stays unknown):
//   - speed, course, position: from GPS.
//   - lat_g / lon_g: DERIVED from the GPS track (v x yaw rate, dv/dt), smoothed. Not IMU readings; browsers cannot give a phone-mount-independent
//     chassis frame, and a 1 Hz GPS cannot see anything quicker than about a second. Labelled source 'gps' in recordings.
//   - roughness_rms: from the accelerometer, orientation independent (high-passed magnitude), in g; null if the device gives no motion events.
//   - camber_deg, crest_vertical_g, vert_peak_g: from the same live pipeline and automatic mount calibration the app runs
//     (live_pipeline.js, IDEAS A-02), fed by DeviceMotion when the browser gives acceleration, gravity and rotation rate. A browser's
//     sensors are not proven, so they count only once the mount is locked AND its lateral g agrees with the GPS-derived one
//     (CrossCheck); then the frame says calibration 'locked' and roughness_rms becomes the app's (>8 Hz vertical). Otherwise null.
//     The native app's frames carry camber_deg and
//     crest_vertical_g from its IMU; Recorder keeps them, and the app's lat_g/lon_g, only while the frame says calibration 'locked'
//     (a solved phone-to-car rotation). Its vert_peak_g (largest >8 Hz vertical spike, g) becomes each 5 m sample's pothole/bump evidence.
// FrameBuilder is pure and unit-tested; start()/stop() are the thin browser shell and must be called from a user gesture (iOS requires it).
(function (root) {
  const G = 9.80665, D2R = Math.PI / 180;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const metres = (a, b) => { const c = Math.cos(a.lat * D2R); return Math.hypot((b.lon - a.lon) * 111320 * c, (b.lat - a.lat) * 110540); };
  const bearing = (a, b) => { const c = Math.cos(a.lat * D2R); return (Math.atan2((b.lon - a.lon) * 111320 * c, (b.lat - a.lat) * 110540) / D2R + 360) % 360; };

  const MAX_ACCURACY_M = 65;          // worse than this and we say "no fix" rather than invent a position
  const MIN_YAW_SPEED = 2.0;          // m/s: below this heading is noise, so no lateral g
  const SMOOTH_S = 1.6;               // window (s) for the derived g

  class FrameBuilder {
    constructor() {
      this.fixes = []; this.motion = []; this.lastCourse = null; this.roughness = null; this.lat = null; this.impact = null;
      const L = root.ApexLivePipeline || (typeof require === 'function' ? (() => { try { return require('./live_pipeline.js'); } catch (_) { return null; } })() : null);
      this.L = L; this.imu = null; this.check = L ? new L.CrossCheck() : null; this.speed = 0; this.imuAt = null;
    }
    /** One DeviceMotion sample through the live pipeline: { accel, gravity, gyro } from ApexLivePipeline.fromDeviceMotion, t its
     *  sensor time (s), wall the clock the GPS fixes use (ms). */
    addImu(s, t, wall = Date.now()) {
      if (!this.L || !s) return;
      if (!this.imu) this.imu = new this.L.IMUPipeline();
      this.imu.step(s.accel, s.gyro, t, this.speed, s.gravity); this.imuAt = wall;
    }
    /** The mount as far as this browser has proven it: null (no IMU), 'default', 'awaitingPull', 'locked' (unverified) or 'verified'. */
    get mount() { return !this.imu ? null : this.imu.mount.state === 'locked' && this.check.verified ? 'verified' : this.imu.mount.state; }
    /** Camber, crest, spikes and roughness from the IMU, or {} while the mount isn't verified (fields stay as the GPS shell has them). */
    _imuFields(gpsLatG, t) {
      const p = this.imu;
      if (!p || this.imuAt == null || Math.abs(t - this.imuAt) > 1500) { if (this.check) this.check.reset(); return {}; }   // motion stopped
      if (p.mount.state !== 'locked') { this.check.reset(); p.takeVertPeak(); return {}; }
      this.check.add(p.latAcc / this.L.G, gpsLatG);
      const peak = p.takeVertPeak();
      if (!this.check.verified) return {};
      const G_ = this.L.G, r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
      return { calibration: 'locked', camber_deg: r(p.camber / D2R, 2), crest_vertical_g: r(p.crestAcc / G_, 3), vert_peak_g: r(peak / G_, 3),
               roughness_rms: r(Math.sqrt(Math.max(0, p.roughMeanSq)) / G_, 4) };
    }
    /** A GPS fix: { t (ms), lat, lon, accuracy (m), speed (m/s|null), heading (deg|null), altitude (m|null) }. Returns a live frame. */
    addFix(f) {
      const bad = !finite(f.lat) || !finite(f.lon) || (finite(f.accuracy) && f.accuracy > MAX_ACCURACY_M);
      if (bad) return { has_fix: false, accuracy_m: finite(f.accuracy) ? f.accuracy : null };
      const prev = this.fixes[this.fixes.length - 1];
      let v = finite(f.speed) && f.speed >= 0 ? f.speed : null;
      if (v == null && prev && f.t > prev.t) v = metres(prev, f) / ((f.t - prev.t) / 1000);
      if (v == null) v = 0;
      let course = finite(f.heading) && v > 1 ? f.heading : (prev && metres(prev, f) > 3 ? bearing(prev, f) : (prev ? prev.course : null));
      const fix = { t: f.t, lat: f.lat, lon: f.lon, v, course, alt: finite(f.altitude) ? f.altitude : null };
      this.fixes.push(fix);
      while (this.fixes.length > 2 && fix.t - this.fixes[0].t > 6000) this.fixes.shift();
      const { lonG, latG } = this._g();
      this.speed = v;
      return { has_fix: true, lat: f.lat, lon: f.lon, speed_mps: v, course_deg: course, lon_g: lonG, lat_g: latG, camber_deg: null,
               roughness_rms: this.roughness, elevation_m: fix.alt, accuracy_m: finite(f.accuracy) ? f.accuracy : null, t: f.t,
               impact_g: this._takeImpact(), ...this._imuFields(latG, f.t), web_mount: this.mount };
    }
    /** The largest impact since the last fix (g), then reset; null when the phone sends no motion. */
    _takeImpact() { const v = this.impact; this.impact = null; return v == null ? null : Math.round(v * 100) / 100; }
    /** Smoothed g derived from the last SMOOTH_S seconds of fixes; null while there is not enough track. */
    _g() {
      const fx = this.fixes, last = fx[fx.length - 1];
      let i = fx.length - 1;
      while (i > 0 && last.t - fx[i - 1].t <= SMOOTH_S * 1000) i--;
      const first = fx[i], dt = (last.t - first.t) / 1000;
      if (i === fx.length - 1 || dt < 0.6) return { lonG: null, latG: null };
      const lonG = (last.v - first.v) / dt / G;
      let latG = null;
      if (finite(first.course) && finite(last.course) && Math.min(first.v, last.v) >= MIN_YAW_SPEED) {
        const dpsi = wrapPi((last.course - first.course) * D2R);            // compass course grows clockwise
        const yawLeft = -dpsi / dt;                                          // ISO 8855: left turn = positive
        latG = ((first.v + last.v) / 2) * yawLeft / G;
      }
      return { lonG, latG };
    }
    /** A motion sample: { t (ms), ax, ay, az } = accelerationIncludingGravity in m/s^2 (any phone orientation). Updates roughness (g RMS, ~1 s window). */
    addMotion(m) {
      if (![m.ax, m.ay, m.az].every(finite)) return;
      this.motion.push({ t: m.t, a: Math.hypot(m.ax, m.ay, m.az) / G });
      // Hard impacts for the crash check (incident.js): how far the magnitude strays from 1 g, largest since the last fix.
      this.impact = Math.max(this.impact || 0, Math.abs(this.motion[this.motion.length - 1].a - 1));
      while (this.motion.length > 1 && m.t - this.motion[0].t > 1000) this.motion.shift();
      if (this.motion.length < 8) return;
      const mean = this.motion.reduce((s, x) => s + x.a, 0) / this.motion.length;         // slow part: gravity plus sustained g
      const ms = this.motion.reduce((s, x) => s + (x.a - mean) ** 2, 0) / this.motion.length;
      this.roughness = Math.sqrt(ms);
    }
  }

  /** Collects frames into 5 m samples (CLAUDE.md spatial binning) and writes the ApexDrive CSV the analysis page imports. */
  class Recorder {
    constructor() { this.rows = []; this.dist = 0; this.prev = null; this.nextAt = 0; this.startedAt = null; this.last = null; this.peaks = []; this.peaksLost = false; }
    add(fr) {
      if (!fr || !fr.has_fix) return;
      if (!this.startedAt) this.startedAt = fr.t || Date.now();
      const locked = fr.calibration === 'locked';                            // camber/crest/spikes are only meaningful in a solved chassis frame
      // The app's vertical spike (max |>8 Hz vertical| since its last frame) arrives ~10 times between GPS fixes, which all share one
      // position. Keep each frame's spike in order (null when unmeasured or crawling: door slams are not road) and place it on the road
      // when the next fix moves, at its share of the way between the two fixes.
      // Over ~3 s without a new position (tunnel, GPS outage, a stop) the frames can no longer be placed: they are dropped, not guessed.
      if (this.peaks.length <= 30) this.peaks.push(locked && finite(fr.vert_peak_g) && finite(fr.speed_mps) && fr.speed_mps >= 1 ? fr.vert_peak_g : null);
      else this.peaksLost = true;
      if (this.prev) {
        const seg = metres(this.prev, fr), d0 = this.dist;
        if (seg < 0.5) { this.last = fr; return; }                          // stationary: no new road
        this.dist += seg;
        const gOk = typeof fr.calibration !== 'string' || locked;            // the app's IMU g likewise; browser frames carry GPS-derived g and no calibration
        while (this.nextAt <= this.dist) {                                   // interpolate each 5 m crossing
          const f = (this.nextAt - d0) / seg, mix = (a, b) => (finite(a) && finite(b) ? a + (b - a) * f : (finite(b) ? b : null));
          this.rows.push({ distance_m: this.nextAt, lat: this.prev.lat + (fr.lat - this.prev.lat) * f, lon: this.prev.lon + (fr.lon - this.prev.lon) * f,
            elevation_m: mix(this.prev.elevation_m, fr.elevation_m), speed_mps: mix(this.prev.speed_mps, fr.speed_mps),
            lon_g: gOk && finite(fr.lon_g) ? fr.lon_g : null, lat_g: gOk && finite(fr.lat_g) ? fr.lat_g : null, roughness_rms: finite(fr.roughness_rms) ? fr.roughness_rms : null,
            camber_deg: locked && finite(fr.camber_deg) ? fr.camber_deg : null, crest_vertical_g: locked && finite(fr.crest_vertical_g) ? fr.crest_vertical_g : null,
            vert_peak_g: null });
          this.nextAt += 5;
        }
        const n = this.peaks.length;
        if (!this.peaksLost && seg <= 100) this.peaks.forEach((p, k) => {                                      // frame k of n since the last move: (k + 1) / n of the way along
          const row = this.rows[Math.floor((d0 + seg * (k + 1) / n) / 5)];
          if (p != null && row) row.vert_peak_g = row.vert_peak_g == null ? p : Math.max(row.vert_peak_g, p);
        });
      } else if (!this.rows.length) this.nextAt = 0;                      // after a pause the distance carries on, nothing filled in
      this.peaks = []; this.peaksLost = false;
      this.prev = fr; this.last = fr;
    }
    /** A gap (a privacy zone, IDEAS Z-02): the next fix starts a new stretch; no samples are placed between the two. */
    pause() { this.prev = null; this.peaks = []; this.peaksLost = false; }
    get km() { return this.dist / 1000; }
    get samples() { return this.rows.length; }
    /** CSV in the ApexDrive column layout; missing values are left blank, never zero. */
    toCsv() {
      const num = (v, d) => (finite(v) ? v.toFixed(d) : '');
      const head = 'segment_index,distance_m,lat,lon,elevation_m,speed_mph,lon_g,lat_g,camber_deg,roughness_rms,crest_vertical_g,vert_peak_g,source';
      return [head, ...this.rows.map((r, i) => [i, num(r.distance_m, 1), num(r.lat, 7), num(r.lon, 7), num(r.elevation_m, 1), num(finite(r.speed_mps) ? r.speed_mps * 2.2369362921 : null, 2),
        num(r.lon_g, 4), num(r.lat_g, 4), num(r.camber_deg, 2), num(r.roughness_rms, 4), num(r.crest_vertical_g, 3), num(r.vert_peak_g, 3), 'web-gps'].join(','))].join('\n') + '\n';
    }
  }

  // ---- browser shell -------------------------------------------------------------------------------------------------------------------
  /** Request motion permission (iOS needs a user gesture). Resolves 'granted' | 'denied' | 'unavailable'. */
  async function motionPermission() {
    if (typeof DeviceMotionEvent === 'undefined') return 'unavailable';
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try { return (await DeviceMotionEvent.requestPermission()) === 'granted' ? 'granted' : 'denied'; } catch (_) { return 'denied'; }
    }
    return 'granted';
  }

  const GEO_MESSAGES = {
    1: 'Location is blocked. Allow it for this site in your browser settings, then try again.',
    2: 'Your phone could not get a location. Go outside or check that Location Services is on.',
    3: 'Waiting for GPS is taking a while. Keep the screen on and the sky in view.',
  };

  /**
   * Starts GPS + motion. Call from a click/tap handler. Callbacks: onFrame(frame), onStatus({gps, motion, wake, message}).
   * Returns { stop() } or throws Error with a message fit to show the user.
   */
  async function start({ onFrame, onStatus }) {
    if (!window.isSecureContext) throw new Error('Sensors need a secure (https) page.');
    if (!('geolocation' in navigator)) throw new Error('This browser has no location support.');
    const status = { gps: 'waiting', motion: 'off', wake: 'off', message: '' };
    const say = (patch) => { Object.assign(status, patch); if (onStatus) onStatus({ ...status }); };
    const fb = new FrameBuilder();
    say({ motion: await motionPermission() === 'granted' ? 'waiting' : (typeof DeviceMotionEvent === 'undefined' ? 'unavailable' : 'denied') });
    const onMotion = (e) => {
      const a = e.accelerationIncludingGravity; if (!a) return;
      fb.addMotion({ t: Date.now(), ax: a.x, ay: a.y, az: a.z });
      if (root.ApexLivePipeline) fb.addImu(root.ApexLivePipeline.fromDeviceMotion(e), (e.timeStamp || performance.now()) / 1000);
      if (status.motion !== 'on' && fb.roughness != null) say({ motion: 'on' });
    };
    if (status.motion === 'waiting') window.addEventListener('devicemotion', onMotion);
    const watch = navigator.geolocation.watchPosition((p) => {
      const c = p.coords, frame = fb.addFix({ t: p.timestamp || Date.now(), lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, speed: c.speed, heading: c.heading, altitude: c.altitude });
      say({ gps: frame.has_fix ? 'on' : 'weak', message: frame.has_fix ? '' : 'GPS signal is weak. Keep the sky in view.' });
      if (onFrame) onFrame(frame);
    }, (err) => say({ gps: err.code === 1 ? 'denied' : 'error', message: GEO_MESSAGES[err.code] || 'Location error.' }), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    let lock = null;
    const wake = async () => {
      try { if ('wakeLock' in navigator && document.visibilityState === 'visible') { lock = await navigator.wakeLock.request('screen'); say({ wake: 'on' }); } else say({ wake: 'unavailable' }); }
      catch (_) { say({ wake: 'unavailable' }); }
    };
    const onVis = () => { if (document.visibilityState === 'visible') wake(); };
    document.addEventListener('visibilitychange', onVis);
    wake();
    return {
      stop() {
        navigator.geolocation.clearWatch(watch); window.removeEventListener('devicemotion', onMotion); document.removeEventListener('visibilitychange', onVis);
        try { if (lock) lock.release(); } catch (_) {}
        say({ gps: 'off', motion: 'off', wake: 'off', message: '' });
      },
    };
  }

  const api = { FrameBuilder, Recorder, start, motionPermission, MAX_ACCURACY_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSensors = api;
})(typeof window !== 'undefined' ? window : globalThis);
