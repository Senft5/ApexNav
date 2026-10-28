// What the co-driver says next (IDEAS V-03). Pure: the page pushes lines and takes the next one when the voice is free.
// - Hazards (bumps, cameras, convoy calls, remembered bumps) always go ahead of ordinary lines (corner notes, route and
//   traffic phrases) and are never trimmed to make room; ordinary lines keep at most MAX_ORDINARY waiting, newest kept.
// - Never stale: a line tied to a place on the route (`atM`) is dropped once the car is past it; every line has a
//   shelf life (`maxAgeMs`) after which it is dropped unsaid rather than read late.
// - Never duplicated: a line with a `key` already waiting, or said within `repeatMs`, is not queued again.
// `preempts(playing, next)` tells the page when a waiting hazard should cut off an ordinary line already playing;
// `ducks(line, spirited)` whether the app lowers the music for it (IDEAS V-08).
(function (root) {
  'use strict';
  const MAX_ORDINARY = 2, HAZARD_AGE_MS = 15000, ORDINARY_AGE_MS = 8000, REPEAT_MS = 30000, PASSED_M = 5;
  const isHazard = (it) => it.kind === 'hazard';

  function createSpeechQueue() {
    let items = [];
    const said = new Map();   // key -> when it was handed out, for the repeat window

    const fresh = (it, now, cursorM) => now - it.at <= it.maxAgeMs
      && !(typeof it.atM === 'number' && typeof cursorM === 'number' && it.atM < cursorM + PASSED_M);

    // Returns false when the line was refused (a duplicate, or nothing to say).
    function push(line, now) {
      if (!line || !line.text) return false;
      const it = { kind: line.kind === 'hazard' ? 'hazard' : 'ordinary', text: line.text, chain: line.chain || null,
                   sysToken: line.sysToken || null, duck: line.duck === true, key: line.key || null, atM: typeof line.atM === 'number' ? line.atM : null,
                   at: now, repeatMs: line.repeatMs ?? REPEAT_MS,
                   maxAgeMs: line.maxAgeMs ?? (line.kind === 'hazard' ? HAZARD_AGE_MS : ORDINARY_AGE_MS) };
      if (it.key && (items.some((q) => q.key === it.key) || now - (said.get(it.key) ?? -Infinity) < it.repeatMs)) return false;
      if (isHazard(it)) {
        const at = items.findIndex((q) => !isHazard(q));   // behind earlier hazards, ahead of every ordinary line
        items.splice(at < 0 ? items.length : at, 0, it);
      } else {
        items.push(it);
        const ordinary = items.filter((q) => !isHazard(q));
        if (ordinary.length > MAX_ORDINARY) {
          const drop = new Set(ordinary.slice(0, ordinary.length - MAX_ORDINARY));
          items = items.filter((q) => !drop.has(q));
        }
      }
      return true;
    }

    // The next line still worth saying, or null. Stale lines are dropped on the way.
    function take(now, cursorM) {
      items = items.filter((it) => fresh(it, now, cursorM));
      const it = items.shift() || null;
      if (it && it.key) said.set(it.key, now);
      return it;
    }

    // Lines that would be stale now are dropped; true when a hazard is waiting.
    function hazardWaiting(now, cursorM) {
      items = items.filter((it) => fresh(it, now, cursorM));
      return items.some(isHazard);
    }

    function clear() { items = []; }
    return { push, take, hazardWaiting, clear, get size() { return items.length; }, get items() { return items.slice(); } };
  }

  const preempts = (playing, next) => !!playing && !!next && !isHazard(playing) && isHazard(next);

  /**
   * Should this line duck the music (IDEAS V-08)? Hazards, pace notes (a chain), lines marked `duck` (directions, anything
   * you asked for) and every line while driving spirited: yes. A low-priority line in cruise ("Rerouting", traffic, a drive
   * name): no, it plays over the music at its own level.
   */
  const ducks = (it, spirited) => !!it && (isHazard(it) || !!it.chain || it.duck === true || !!spirited);

  const api = { createSpeechQueue, preempts, ducks, MAX_ORDINARY, HAZARD_AGE_MS, ORDINARY_AGE_MS, REPEAT_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexSpeechQueue = api;
})(typeof window !== 'undefined' ? window : globalThis);
