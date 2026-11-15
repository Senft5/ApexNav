(function (root) {
  'use strict';

  async function read(url, options, format, timeoutMs) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Route service took too long. Check signal and try again.'));
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, { ...options, signal: controller.signal });
          if (!response.ok) throw new Error(`Route service returned HTTP ${response.status}`);
          return response[format]();
        })(),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function optional(task, timeoutMs = 5000) {
    let timer;
    try {
      return await Promise.race([
        task,
        new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Valhalla (Quick routes, drive-time matrices, map matching): our own router first (POST /api/valhalla/<action>,
  // backend/src/valhalla.ts), the public FOSSGIS server when ours answers anything but 200: outside its region, while it
  // starts, or off (previews). After "starting" or no answer, ours is skipped for OWN_REST_MS so a plan isn't slowed.
  const PUBLIC_VALHALLA = 'https://valhalla1.openstreetmap.de';
  const OWN_MS = 8000, OWN_REST_MS = 60000;
  let ownRestUntil = 0;
  const ownBase = () => {
    const sync = root.ApexSync;
    return sync && typeof sync.apiBase === 'string' && typeof location !== 'undefined' && /^https?:|^apexnav:/.test(location.protocol) ? sync.apiBase : null;
  };
  const holed = (j) => !j || !Array.isArray(j.sources_to_targets) || j.sources_to_targets.some((row) => !Array.isArray(row) || row.some((c) => !c || !Number.isFinite(c.time)));
  async function valhalla(action, body, timeoutMs = 20000, now = Date.now) {
    const text = typeof body === 'string' ? body : JSON.stringify(body), base = ownBase(), t0 = now();
    if (base !== null && now() >= ownRestUntil) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.min(OWN_MS, timeoutMs / 2));
      try {
        const r = await fetch(`${base}/api/valhalla/${action}`, { method: 'POST', body: text, signal: controller.signal, credentials: 'omit',
          headers: { 'Content-Type': 'application/json', 'X-Apexnav': '1' } });
        // x-router: own marks our router's answer (a stand-in API that answers 200 to everything is not a route)
        if (r.ok && r.headers.get('x-router') === 'own') {
          const j = await r.json();
          // a matrix with an empty pair: ours gives up on long pairs sooner than the public server, so it is asked too
          if (action !== 'sources_to_targets' || !holed(j)) { api.lastRouter = 'own'; return j; }
        }
        const why = r.status === 503 ? ((await r.json().catch(() => ({}))).reason || '') : '';
        if (why !== 'outside_region' && why !== 'no_points' && r.status >= 500) ownRestUntil = now() + OWN_REST_MS;
      } catch (_) {
        ownRestUntil = now() + OWN_REST_MS;
      } finally {
        clearTimeout(timer);
      }
    }
    api.lastRouter = 'public';
    return read(`${PUBLIC_VALHALLA}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text }, 'json', Math.max(5000, timeoutMs - (now() - t0)));
  }

  const api = {
    json: (url, options = {}, timeoutMs = 20000) => read(url, options, 'json', timeoutMs),
    valhalla,
    PUBLIC_VALHALLA,
    lastRouter: null,
    resetValhallaForTest: () => { ownRestUntil = 0; },
    arrayBuffer: (url, options = {}, timeoutMs = 20000) => read(url, options, 'arrayBuffer', timeoutMs),
    yieldToUI: () => new Promise(resolve => setTimeout(resolve, 0)),
    optional,
  };
  root.ApexRouteLoading = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
