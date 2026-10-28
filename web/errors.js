// Crash and error reports without personal data (docs/IDEAS.md Y-02). Uncaught errors and unhandled promise rejections
// go to our own Worker (POST /api/errors), never a third-party SDK. Before anything leaves the phone it is scrubbed:
// query strings and fragments cut from URLs, e-mail addresses, precise numbers (coordinates) and long token-like strings
// replaced. No session, no account, no position, no drive data. At most 5 reports per page load, one per distinct error.
// The Worker scrubs again, writes one log line (Workers Logs, event client_error) and counts it per day in D1 error_counts.
(function (root) {
  const MAX_PER_PAGE = 5;
  const cut = (s, max) => (s.length > max ? s.slice(0, max) : s);

  /** Remove anything that could identify a person or a place. Pure; mirrored in backend/src/errors.ts. */
  function scrub(text, max = 300) {
    let s = String(text == null ? '' : text);
    s = s.replace(/\bdata:[^\s)'"]+/g, 'data:[…]');
    s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+/gi, (u) => u.replace(/[?#].*?((?::\d+){1,2})?$/, '$1'));        // keep where, drop what
    s = s.replace(/[\w.+-]+(?:@|%40)[\w-]+(\.[\w-]+)+/gi, '[email]');
    s = s.replace(/-?\d{1,3}\.\d{3,}/g, '[num]');                                                  // lat/lon and other precise numbers
    s = s.replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, '[token]');
    return cut(s, max);
  }

  /** The report for one error: { kind, message, stack, page, app }. */
  function reportOf(kind, err, fallbackMessage) {
    const message = err && err.message ? err.message : (fallbackMessage || String(err));
    const stack = err && err.stack ? err.stack : '';
    const loc = root.location || {};
    return { kind, message: scrub(message, 300), stack: scrub(stack, 2000), page: scrub(loc.pathname || '', 80),
             app: loc.protocol === 'apexnav:' ? 'ios' : 'web' };
  }

  /** Listens for uncaught errors; send(report) does the I/O (default: fetch to the Worker, failures ignored). */
  function install({ send = defaultSend, target = root } = {}) {
    const seen = new Set();
    let sent = 0;
    const handle = (kind, err, msg) => {
      try {
        const r = reportOf(kind, err, msg);
        const key = `${r.kind}|${r.message}`;
        if (seen.has(key) || sent >= MAX_PER_PAGE) return;
        seen.add(key); sent++;
        send(r);
      } catch (_) { /* reporting must never throw */ }
    };
    target.addEventListener('error', (e) => { if (e && (e.error || e.message)) handle('error', e.error, e.message); });
    target.addEventListener('unhandledrejection', (e) => handle('rejection', e && e.reason, 'unhandled rejection'));
    return { handle, get sent() { return sent; } };
  }

  // Anonymous on purpose: no cookie, no bearer token. The app posts cross-origin to the Worker like ApexSync does.
  function defaultSend(report) {
    if (root.navigator && root.navigator.onLine === false) return;
    const inApp = root.location && root.location.protocol === 'apexnav:';
    const base = inApp ? 'https://apexnav.senftns.workers.dev' : '';
    try {
      fetch(base + '/api/errors', { method: 'POST', keepalive: true, credentials: 'omit',
        headers: { 'content-type': 'application/json', 'x-apexnav': '1' }, body: JSON.stringify(report) }).catch(() => {});
    } catch (_) { /* no fetch: nothing to do */ }
  }

  const api = { scrub, reportOf, install, MAX_PER_PAGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.ApexErrors = api; if (root.addEventListener && root.fetch) install(); }
})(typeof window !== 'undefined' ? window : globalThis);
