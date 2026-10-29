// Plan presets (docs/design/REVIEW.md 3.3): a power user's setup (Roads, Avoid, corner mix) saved under a name, shown as a
// stamp on the plan sheet so it is one tap next time. On this phone only. Pure over a Storage (tests/test_plan_presets.py).
(function (root) {
  'use strict';
  const KEY = 'apex.planPresets', MAX = 6, NAME_MAX = 24;
  const LEVELS = ['quick', 'fun', 'max'];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);

  function clean(p) {
    if (!p || typeof p !== 'object') return null;
    const name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!name) return null;
    const avoid = {};
    for (const [k, v] of Object.entries(p.avoid || {})) if (/^[a-z]+$/.test(k)) avoid[k] = !!v;
    const prefs = {};
    for (const k of ['tight', 'fast']) { const v = p.prefs && p.prefs[k]; prefs[k] = finite(v) ? Math.max(-1, Math.min(1, Math.round(v))) : 0; }
    return { name, fun: LEVELS.includes(p.fun) ? p.fun : 'fun', avoid, prefs };
  }

  function list(store) {
    let raw = [];
    try { raw = JSON.parse(store.getItem(KEY) || '[]'); } catch (_) { raw = []; }
    return (Array.isArray(raw) ? raw : []).map(clean).filter(Boolean).slice(0, MAX);
  }

  /** Saves (or replaces, by name, any case) a preset; newest first. 'saved', 'full' (MAX already and a new name) or 'bad'. */
  function save(store, p) {
    const c = clean(p);
    if (!c) return 'bad';
    const all = list(store), same = (x) => x.name.toLowerCase() === c.name.toLowerCase();
    if (!all.some(same) && all.length >= MAX) return 'full';
    try { store.setItem(KEY, JSON.stringify([c, ...all.filter((x) => !same(x))])); } catch (_) { return 'bad'; }
    return 'saved';
  }

  function remove(store, name) {
    const n = String(name || '').toLowerCase();
    try { store.setItem(KEY, JSON.stringify(list(store).filter((x) => x.name.toLowerCase() !== n))); } catch (_) {}
  }

  /** The preset whose settings match what is set now (its stamp shows inked), or null. */
  function matching(store, now) {
    const c = clean({ ...now, name: 'x' });
    if (!c) return null;
    const key = (p) => JSON.stringify([p.fun, Object.keys(p.avoid).filter((k) => p.avoid[k]).sort(), p.prefs.tight, p.prefs.fast]);
    return list(store).find((p) => key(p) === key(c)) || null;
  }

  const api = { KEY, MAX, list, save, remove, matching };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexPlanPresets = api;
})(typeof window !== 'undefined' ? window : globalThis);
