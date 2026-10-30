// Modules the launch does not carry (REVIEW_FEEL F-03): a driver who opens the app to drive gets the map, the deck, the
// drive loop and the strip; People, the Garage, crews, builds, the convoy, friends on the map and the phonemizer load
// when they are first used (or, for the social group, once the map is idle after the launch, so a convoy resumes and
// friends see you without a tap). Plain scripts, as before: each still sets its window.Apex* global,
// and a group's files run in the order listed (async = false), the order they had in index.html.
(function (root) {
  'use strict';
  const GROUPS = {
    social: ['photos.js', 'safety_ui.js', 'crew_standings.js', 'crew_events.js', 'crew_page.js', 'crew_voice.js', 'spots_feed.js',
      'feedback.js', 'profile_view.js', 'friends_map.js', 'who_sees.js', 'car_lookup.js', 'builds.js', 'garage_ui.js',
      'convoy.js', 'convoy_ui.js'],
    g2p: ['g2p.js'],                 // the neural voice's phonemizer (voice.js), only when a neural voice first speaks
  };
  const files = new Map();           // file -> Promise, so a file is fetched and run once whoever asks
  const groups = new Map();
  function file(src) {
    if (files.has(src)) return files.get(src);
    const p = new Promise((ok, fail) => {
      const sc = root.document.createElement('script');
      sc.src = src; sc.async = false;
      sc.onload = () => ok(); sc.onerror = () => { files.delete(src); sc.remove(); fail(new Error(`lazy: ${src}`)); };
      root.document.head.append(sc);
    });
    files.set(src, p);
    return p;
  }
  /** Loads a group once; resolves when all its files have run. A failed load (offline website) can be asked again. */
  function load(name) {
    const list = GROUPS[name];
    if (!list) return Promise.reject(new Error(`lazy: no group ${name}`));
    if (!groups.has(name)) groups.set(name, Promise.all(list.map(file)).catch((e) => { groups.delete(name); throw e; }));
    return groups.get(name);
  }
  root.ApexLazy = { GROUPS, load };
  if (typeof module !== 'undefined' && module.exports) module.exports = { GROUPS };
})(typeof window !== 'undefined' ? window : globalThis);
