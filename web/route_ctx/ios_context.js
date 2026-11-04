// Route context: what the phone knows about the driver's time (builder E). Only in the iOS app, only when the driver asks:
//   "My free time": the calendar (EventKit, read-only). The shell asks iOS for calendar access at that tap, never before,
//     and returns only the START TIME of the next timed event in the next 24 h (no title, place, notes or attendees); the
//     loop is sized to end FREE_BUFFER_MIN before it.
//   "This album": what is playing in the Music app (MPMusicPlayerController.systemMusicPlayer). iOS lets an app read the
//     now-playing item; it does not let an app read the system queue, so "as long as this album" is the rest of the album the
//     song belongs to, from the media library (permission asked at that tap). A streamed song not in the library gives only
//     its own remaining time, and the card says so.
// Nothing here leaves the phone. Bridge: page -> shell { cmd: 'context', op: 'calendar' | 'music', id }; shell -> page
// onNative({ type: 'context', op, id, granted, next?, remainingS?, scope?, album? }) (ApexNavApp.swift ApexContext).
//
// Provider (ApexRouteCtx 'ios_context'), only after the driver asked (ApexIosContext.state is filled by the tap):
//   channel free_min   min   minutes left before the next event, minus the buffer, at each sample's ETA (negative = late);
//                            NaN when the calendar wasn't asked
//   span past_next_event (hard: false) from the sample whose ETA is past (event - buffer) to the end, value minutes late
//   point album_ends   where the ETA passes the end of the album
// Pure parts exported for tests (tests/test_route_ctx_ios_context.py).
(function (root) {
  'use strict';
  const U = typeof module !== 'undefined' && module.exports ? require('./ctx_util.js') : root.ApexRouteCtxUtil;
  const FREE_BUFFER_MIN = 15, MIN_LOOP_MIN = 20, MAX_LOOP_MIN = 240, STEP_MIN = 15, TIMEOUT_MS = 30000;
  const CH = ['free_min'];
  const state = { nextEventAt: null, albumEndsAt: null, asked: {} };
  const pending = new Map();
  let seq = 1;

  /** True inside the iOS app (the shell's bridge is there). */
  const available = () => !!(root.APEX_EMBED && root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.apex);

  /** Asks the shell; resolves its reply, or { unavailable: true, why } on the web, or { timeout: true } after TIMEOUT_MS. */
  function ask(op, { post, timeoutMs = TIMEOUT_MS } = {}) {
    const send = post || (available() ? (m) => root.webkit.messageHandlers.apex.postMessage(m) : null);
    if (!send) return Promise.resolve({ unavailable: true, why: 'web' });
    const id = seq++;
    return new Promise((resolve) => {
      const t = setTimeout(() => { pending.delete(id); resolve({ timeout: true }); }, timeoutMs);
      pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
      try { send({ cmd: 'context', op, id }); } catch (_) { clearTimeout(t); pending.delete(id); resolve({ unavailable: true, why: 'bridge' }); }
    });
  }
  /** The shell's answer (cockpit.js onNative routes type 'context' here). */
  function receive(msg) {
    const f = msg && pending.get(msg.id);
    if (!f) return false;
    pending.delete(msg.id); f(msg);
    return true;
  }

  /**
   * Loop minutes that fit before the next event: the time to it less FREE_BUFFER_MIN, down to STEP_MIN steps, at most
   * MAX_LOOP_MIN; null when under MIN_LOOP_MIN (no loop fits) or unknown.
   */
  function minutesFree(nextMs, now = Date.now()) {
    if (!Number.isFinite(nextMs)) return null;
    const m = Math.floor(((nextMs - now) / 60000 - FREE_BUFFER_MIN) / STEP_MIN) * STEP_MIN;
    return m >= MIN_LOOP_MIN ? Math.min(MAX_LOOP_MIN, m) : null;
  }
  /** Loop minutes for the album's remaining time, the same steps; null when unknown or too short. */
  function minutesOfMusic(remainingS) {
    if (!Number.isFinite(remainingS) || remainingS <= 0) return null;
    const m = Math.round(remainingS / 60 / STEP_MIN) * STEP_MIN;
    return m >= MIN_LOOP_MIN ? Math.min(MAX_LOOP_MIN, m) : null;
  }

  /**
   * What to do with a reply, as the plan sheet says it: { minutes, text } to plan a loop, or { minutes: null, text } to say why
   * not. fmtTime(ms) writes a clock time in the driver's locale.
   */
  function plan(op, reply, { now = Date.now(), fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) } = {}) {
    if (!reply || reply.unavailable) return { minutes: null, text: 'Only in the Vetta app on iPhone.' };
    if (reply.timeout) return { minutes: null, text: 'The phone didn’t answer. Try again.' };
    if (op === 'calendar') {
      if (!reply.granted) return { minutes: null, text: 'Calendar access is off. Turn it on in Settings > Vetta > Calendars to fit a loop to your free time.' };
      if (!Number.isFinite(reply.next)) return { minutes: MAX_LOOP_MIN, text: 'Nothing in your calendar for a day: a 4 h loop.', next: null };
      const m = minutesFree(reply.next, now);
      return m ? { minutes: m, next: reply.next, text: `Free until ${fmtTime(reply.next)}: a ${m} min loop, back ${FREE_BUFFER_MIN} min before.` }
        : { minutes: null, text: `Your next event is at ${fmtTime(reply.next)}: not long enough for a loop.` };
    }
    if (op === 'music') {
      if (reply.granted === false) return { minutes: null, text: 'Media library access is off. Turn it on in Settings > Vetta > Media & Apple Music.' };
      if (!Number.isFinite(reply.remainingS)) return { minutes: null, text: 'Nothing is playing in Music. Start the album, then ask again.' };
      const m = minutesOfMusic(reply.remainingS);
      const what = reply.scope === 'album' ? `the rest of ${reply.album ? `“${reply.album}”` : 'this album'}` : 'this song (iOS doesn’t share the rest of the queue)';
      return m ? { minutes: m, endsAt: now + reply.remainingS * 1000, text: `A ${m} min loop, as long as ${what}.` }
        : { minutes: null, text: `${what[0].toUpperCase()}${what.slice(1)} is too short for a loop.` };
    }
    return { minutes: null, text: '' };
  }

  /** free_min, the late span and the album point for one corridor (pure). */
  function channelsFor(t, st) {
    const n = t.lat.length, free = U.nan(n), spans = [], points = [];
    const eta = t.etaAt && t.etaAt.length === n ? t.etaAt : null;
    if (eta && Number.isFinite(st.nextEventAt)) {
      const by = st.nextEventAt - FREE_BUFFER_MIN * 60000;
      for (let i = 0; i < n; i++) free[i] = (by - eta[i]) / 60000;
      const late = free.findIndex((v) => v < 0);
      if (late >= 0) spans.push({ fromM: Math.round(t.distM[late]), toM: Math.round(t.distM[n - 1]), kind: 'past_next_event', hard: false, value: Math.round(-free[n - 1]), label: `${Math.round(-free[n - 1])} min past your free time` });
    }
    if (eta && Number.isFinite(st.albumEndsAt)) {
      const i = Array.prototype.findIndex.call(eta, (v) => v >= st.albumEndsAt);
      if (i >= 0) points.push({ atM: Math.round(t.distM[i]), kind: 'album_ends', label: 'The album ends here' });
    }
    return { channels: { free_min: free }, spans, points };
  }

  async function fetchCtx(corridors, opts = {}) {
    const st = opts.state || state, out = {};
    const asked = Number.isFinite(st.nextEventAt) || Number.isFinite(st.albumEndsAt);
    for (const c of corridors) out[c.id] = asked ? { status: 'ok', ...channelsFor(c, st) } : { status: 'unavailable', note: 'Not asked', channels: { free_min: U.nan(c.lat.length) }, spans: [], points: [] };
    return out;
  }

  const provider = { id: 'ios_context', version: 1, channels: CH, needs: { network: false }, budgetMs: 50, fetch: fetchCtx };
  U.registry().register(provider);

  const api = { provider, state, available, ask, receive, minutesFree, minutesOfMusic, plan, channelsFor, FREE_BUFFER_MIN, MIN_LOOP_MIN, MAX_LOOP_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexIosContext = api;
})(typeof window !== 'undefined' ? window : globalThis);
