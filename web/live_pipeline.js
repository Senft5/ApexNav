// The live 100 Hz IMU pipeline and automatic mount calibration, for the browser (IDEAS A-02). A line-for-line port of
// core/live_pipeline.py (MountCalibrator, IMUPipeline), the reference ApexKit (Swift) is also held to; tests/test_web_live_parity.py
// replays ApexKit/Tests/Fixtures/live_fixture.json through this file and must reproduce every output and mount state.
// ISO 8855 vehicle frame, SI units, radians inside. Inputs as the Python: accel = acceleration with gravity removed, phone frame,
// m/s^2; gyro rad/s; gravity in g, pointing down. fromDeviceMotion() turns a W3C DeviceMotionEvent into those.
(function (root) {
  'use strict';
  const G = 9.80665, D2R = Math.PI / 180;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const mag = (a) => Math.sqrt(Math.max(0, dot(a, a)));
  const norm = (a) => { const m = Math.sqrt(Math.max(1e-12, dot(a, a))); return [a[0] / m, a[1] / m, a[2] / m]; };
  const reject = (a, axis) => sub(a, scale(axis, dot(a, axis)));
  const angle = (a, b) => Math.atan2(mag(cross(a, b)), dot(a, b));
  const alpha = (dt, tau) => 1 - Math.exp(-dt / tau);

  const C = {
    G_FAST_TAU: 0.1, G_SLOW_TAU: 0.8, OFF_AXIS_TAU: 0.2, SETTLE_ANGLE: 3 * D2R, SETTLE_RATE: 0.15, SETTLE_S: 2.0,
    REMOUNT_ANGLE: 15 * D2R, REMOUNT_RATE: 0.5, REMOUNT_S: 0.5, TRIM_TAU: 30.0, PERSIST_MATCH: 8 * D2R,
    IV_MIN_S: 0.8, IV_MAX_S: 3.0, EV_TAU: 90.0, MIN_SPEED: 3.0, LON_MIN: 0.5, LAT_MIN: 1.0, LON_GATE: 0.5, LAT_GATE: 0.7,
    A_MAX: 8.0, W_LOCK: 6.0, N_LOCK: 3, Q_LOCK: 0.7, Q_LOST: 0.3, DISAGREE_COS: Math.cos(45 * D2R),
  };

  class MountCalibrator {
    constructor() {
      this.rx = [1, 0, 0]; this.ry = [0, 1, 0]; this.rz = [0, 0, 1]; this.state = 'default'; this.persisted = false;
      this.gFast = null; this.gSlow = null; this.offAxisRate = 0; this.settledS = 0; this.settledSum = [0, 0, 0]; this.movedS = 0;
      this._resetEvidence();
    }
    restore(rows) { this.rx = rows.slice(0, 3); this.ry = rows.slice(3, 6); this.rz = rows.slice(6, 9); this.state = 'default'; this.persisted = true; }
    lockVertical(gravity) { this._setVertical(norm(scale(gravity, -1))); this.persisted = false; this._resetEvidence(); }
    _setVertical(up) {
      this.rz = up;
      const seed = Math.abs(this.rz[1]) < 0.9 ? [0, 1, 0] : [0, 0, -1];
      this.rx = norm(reject(seed, this.rz)); this.ry = norm(cross(this.rz, this.rx)); this.state = 'awaitingPull';
    }
    _resetEvidence() {
      this.evA = [0, 0, 0]; this.evW = 0; this.evN = 0; this.disW = 0; this.disN = 0;
      this.ivT = 0; this.ivH = [0, 0, 0]; this.ivYaw = 0; this.ivV0 = null;
    }
    observe(accel, gyro, gravity, dt, v) {
      if (gravity) this._trackGravity(gyro, gravity, dt);
      if (this.state !== 'default') this._forwardEvidence(accel, gyro, dt, v);
    }
    _trackGravity(gyro, g, dt) {
      if (!this.gFast) { this.gFast = g; this.gSlow = g; }
      this.gFast = add(this.gFast, scale(sub(g, this.gFast), alpha(dt, C.G_FAST_TAU)));
      this.gSlow = add(this.gSlow, scale(sub(g, this.gSlow), alpha(dt, C.G_SLOW_TAU)));
      const up = norm(scale(this.gFast, -1));
      this.offAxisRate += alpha(dt, C.OFF_AXIS_TAU) * (mag(reject(gyro, up)) - this.offAxisRate);
      const steady = angle(this.gFast, this.gSlow) < C.SETTLE_ANGLE && this.offAxisRate < C.SETTLE_RATE;
      if (steady) { this.settledS += dt; this.settledSum = add(this.settledSum, scale(g, dt)); }
      else { this.settledS = 0; this.settledSum = [0, 0, 0]; }
      if (this.state === 'default') { if (this.settledS >= C.SETTLE_S) this._settleVertical(); return; }
      const moved = angle(up, this.rz) > C.REMOUNT_ANGLE || this.offAxisRate > C.REMOUNT_RATE;
      this.movedS = moved ? this.movedS + dt : 0;
      if (this.movedS >= C.REMOUNT_S) { this.state = 'default'; this.persisted = false; this.movedS = 0; this._resetEvidence(); return; }
      if (steady) {
        this.rz = norm(add(this.rz, scale(sub(up, this.rz), alpha(dt, C.TRIM_TAU))));
        this.rx = norm(reject(this.rx, this.rz)); this.ry = norm(cross(this.rz, this.rx));
      }
    }
    _settleVertical() {
      const up = norm(scale(this.settledSum, -1));
      if (this.persisted && angle(up, this.rz) < C.PERSIST_MATCH) {
        this.rz = up; this.rx = norm(reject(this.rx, up)); this.ry = norm(cross(up, this.rx)); this.state = 'locked';
      } else this._setVertical(up);
      this.persisted = false; this.movedS = 0; this._resetEvidence();
    }
    _forwardEvidence(accel, gyro, dt, v) {
      if (this.ivV0 == null) this.ivV0 = v;
      this.ivH = add(this.ivH, scale(reject(accel, this.rz), dt));
      this.ivYaw += dot(this.rz, gyro) * dt;
      this.ivT += dt;
      if (!((v !== this.ivV0 && this.ivT >= C.IV_MIN_S) || this.ivT >= C.IV_MAX_S)) return;
      const T = this.ivT, v0 = this.ivV0, h = scale(this.ivH, 1 / T), aLon = (v - v0) / T, vBar = 0.5 * (v + v0), aLat = vBar * (this.ivYaw / T);
      this.ivT = 0; this.ivH = [0, 0, 0]; this.ivYaw = 0; this.ivV0 = v;
      if (!(vBar >= C.MIN_SPEED && Math.abs(aLon) <= C.A_MAX && Math.abs(aLat) <= C.A_MAX)) return;
      let sample, weight;
      if (Math.abs(aLon) >= C.LON_MIN && Math.abs(aLat) < C.LAT_GATE) { sample = scale(h, aLon * T); weight = aLon * aLon * T; }
      else if (Math.abs(aLat) >= C.LAT_MIN && Math.abs(aLon) < C.LON_GATE) { sample = scale(cross(h, this.rz), aLat * T); weight = aLat * aLat * T; }
      else return;
      if (this.state === 'locked') {
        const sH = reject(sample, this.rz);
        if (dot(sH, this.rx) >= C.DISAGREE_COS * mag(sH)) { this.disW = 0; this.disN = 0; }
        else {
          this.disW += weight; this.disN += 1;
          if (this.disN >= C.N_LOCK && this.disW >= C.W_LOCK) { this.state = 'awaitingPull'; this._resetEvidence(); }
        }
      }
      const decay = Math.exp(-T / C.EV_TAU);
      this.evA = add(scale(this.evA, decay), sample); this.evW = this.evW * decay + weight; this.evN += 1;
      if (this.evN < C.N_LOCK || this.evW < C.W_LOCK) return;
      const aH = reject(this.evA, this.rz), q = mag(aH) / this.evW;
      if (q >= C.Q_LOCK) { this.rx = norm(aH); this.ry = norm(cross(this.rz, this.rx)); this.state = 'locked'; }
      else if (q < C.Q_LOST && this.state === 'locked') { this.state = 'awaitingPull'; this._resetEvidence(); }
    }
    rows() { return [this.rx.slice(), this.ry.slice(), this.rz.slice()]; }
  }

  class IMUPipeline {
    constructor() {
      this.mount = new MountCalibrator(); this.lastT = null;
      this.lonAcc = 0; this.latAcc = 0; this.yawRate = 0; this.crestAcc = 0; this.hpVert = 0; this.vertPeak = 0; this.lastAz = 0;
      this.roughMeanSq = 0; this.segRoughSumSq = 0; this.segRoughCount = 0; this.camber = 0; this.engagement = 0;
    }
    /** One sample: t in seconds; gravity in g pointing down, or null; v the latest GPS speed (held between fixes). */
    step(accel, gyro, t, v, gravity = null) {
      let dt = 0.01;
      if (this.lastT != null) dt = Math.max(0.001, Math.min(0.1, t - this.lastT));
      this.lastT = t;
      this.mount.observe(accel, gyro, gravity, dt, v);
      const m = this.mount, ax = dot(m.rx, accel), ay = dot(m.ry, accel), az = dot(m.rz, accel), yaw = dot(m.rz, gyro);
      const aH = alpha(dt, 0.15);
      this.lonAcc += aH * (ax - this.lonAcc); this.latAcc += aH * (ay - this.latAcc); this.yawRate += aH * (yaw - this.yawRate);
      this.crestAcc += alpha(dt, 1 / (2 * Math.PI * 1.0)) * (az - this.crestAcc);
      const rc = 1 / (2 * Math.PI * 8.0), beta = rc / (rc + dt);
      this.hpVert = beta * (this.hpVert + az - this.lastAz); this.lastAz = az;
      this.vertPeak = Math.max(this.vertPeak, Math.abs(this.hpVert));
      const sq = this.hpVert * this.hpVert;
      this.roughMeanSq += alpha(dt, 0.5) * (sq - this.roughMeanSq); this.segRoughSumSq += sq; this.segRoughCount += 1;
      const aKin = v * this.yawRate;
      if (Math.abs(aKin) > 1.5) {
        const sinPhi = Math.max(-0.5, Math.min(0.5, (Math.abs(aKin) - Math.abs(this.latAcc)) / G));
        this.camber += alpha(dt, 0.3) * (Math.asin(sinPhi) - this.camber);
      } else this.camber -= alpha(dt, 0.6) * this.camber;
      const combined = Math.hypot(this.latAcc, this.lonAcc) / G, rough = Math.sqrt(Math.max(0, this.roughMeanSq)) / G;
      this.engagement = Math.min(1, (combined / 0.75) * 0.75 + (rough / 0.45) * 0.25);
    }
    takeSegmentRoughRms() { return this.segRoughCount ? Math.sqrt(this.segRoughSumSq / this.segRoughCount) : Math.sqrt(Math.max(0, this.roughMeanSq)); }
    takeVertPeak() { const p = this.vertPeak; this.vertPeak = 0; return p; }
    resetSegmentRough() { this.segRoughSumSq = 0; this.segRoughCount = 0; }
    outputs() { return [this.lonAcc, this.latAcc, this.yawRate, this.crestAcc, this.hpVert, this.roughMeanSq, this.camber, this.engagement, this.vertPeak]; }
  }

  /**
   * A W3C DeviceMotionEvent's numbers -> pipeline inputs, or null when the browser leaves any out. The spec's axes match iOS's
   * (x right, y to the top, z out of the screen); `acceleration` is the device's own acceleration (gravity removed),
   * `accelerationIncludingGravity` = acceleration - gravity (flat, face up at rest: +9.81 z), rotationRate in deg/s with
   * alpha about z, beta about x, gamma about y. So gravity (pointing down, g) = (acceleration - includingGravity) / G.
   */
  function fromDeviceMotion(e) {
    const a = e && e.acceleration, ag = e && e.accelerationIncludingGravity, r = e && e.rotationRate;
    const ok = (o, ks) => o && ks.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]));
    if (!ok(a, ['x', 'y', 'z']) || !ok(ag, ['x', 'y', 'z']) || !ok(r, ['alpha', 'beta', 'gamma'])) return null;
    const accel = [a.x, a.y, a.z], gravity = scale(sub(accel, [ag.x, ag.y, ag.z]), 1 / G);
    if (Math.abs(mag(gravity) - 1) > 0.3) return null;                    // not a gravity reading this pipeline can trust
    return { accel, gravity, gyro: [r.beta * D2R, r.gamma * D2R, r.alpha * D2R] };
  }

  /**
   * A browser's own sensors are not proven: their sign conventions have differed between engines. The calibrated lateral g
   * must agree with the GPS-derived one (sensors.js, independent of the phone) before camber or crest are kept: in turns
   * over 0.15 g, at least 8 of 10 with the same sign, from 10 or more fixes. Any failure after that withdraws it.
   */
  class CrossCheck {
    constructor() { this.pairs = []; }
    add(imuLatG, gpsLatG) {
      if (!(Number.isFinite(imuLatG) && Number.isFinite(gpsLatG)) || Math.abs(gpsLatG) < 0.15) return;
      this.pairs.push(Math.sign(imuLatG) === Math.sign(gpsLatG));
      if (this.pairs.length > 30) this.pairs.shift();
    }
    reset() { this.pairs = []; }
    get verified() { const n = this.pairs.length; return n >= 10 && this.pairs.filter(Boolean).length / n >= 0.8; }
  }

  const api = { G, MountCalibrator, IMUPipeline, CrossCheck, fromDeviceMotion, CONSTANTS: C };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexLivePipeline = api;
})(typeof window !== 'undefined' ? window : globalThis);
