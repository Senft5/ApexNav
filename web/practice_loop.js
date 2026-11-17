// Practice Loop (the owner, 2026-11-17): the owner's endless ear-training and time player. Garage → Settings → Practice
// Loop, shown only when /api/me says moderator and only in the iOS app (cockpit.js paintPracticeRow), loaded lazily
// (lazy.js 'practice'). This page is only the remote: the player is native (PracticeLoop.swift, ApexKit PracticeLoop.swift)
// so it keeps time with the screen locked. The page sends {cmd: 'practice', action, settings} and paints what the shell
// answers ({type: 'practice', active, playing, title, settings}); the shell keeps the settings, so they survive the page.
// Pure DOM over an injected `post` (tests/test_practice_loop.py).
(function (root) {
  'use strict';
  const ROOTS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  // the standard markings (ApexKit PracticeTheory.bpmPool); 60 to 120 is the default range
  const BPMS = [40, 44, 48, 52, 56, 60, 66, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120,
    126, 132, 138, 144, 152, 160, 168, 176, 184, 192, 200, 208];
  const FOCUS = [['all', 'All'], ['modes', 'Modes'], ['scales', 'Scales'], ['arpeggios', 'Arps']];
  const SLEEP = [[0, 'Off'], [15, '15 m'], [30, '30 m'], [60, '1 h'], [90, '90 m']];
  // note values as 16ths per note (ApexKit PracticeTheory.values); a block plays all its notes in one of the chosen ones
  const VALUES = [[16, 'Whole'], [8, 'Half'], [4, 'Quarter'], [2, '8th'], [1, '16th']];
  const DEFAULTS = { lockRoot: null, focus: 'all', bpmMin: 60, bpmMax: 120, repsMin: 5, repsMax: 10, drone: true, volume: 0.8, sleepMin: 0, values: [16, 8, 4, 2, 1] };

  let ui = null;                     // the mounted sheet: { paint(state) }
  let viz = null;                    // its pictures (practice_viz.js), when loaded
  let range = { step: null };        // the voice range test: { step: 'low'|'high'|null, lo, hi, label, now, best, low, error }
  let last = { active: false, playing: false, settings: { ...DEFAULTS } };

  /** Whether this account and this app get the entry: the owner (moderator), inside the iOS app. */
  function allowed(me, native) { return !!(native && me && me.signed_in && me.member && me.moderator === true); }

  /** Mounts the sheet into `body`. deps: { post(msg), document? }. Asks the shell for its state at once. */
  function mount(body, deps) {
    const doc = deps.document || root.document;
    const post = (action, settings, on, step) => { try { deps.post({ cmd: 'practice', action, ...(settings ? { settings } : {}), ...(on != null ? { on: !!on } : {}), ...(step ? { step } : {}) }); } catch (_) { /* no shell */ } };
    const el = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'dataset') Object.assign(n.dataset, v); else if (k in n) n[k] = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
    const set = (patch) => { last.settings = { ...last.settings, ...patch }; post('settings', patch); paint(last); };

    const now = el('p', { className: 'pl-now', textContent: 'Not playing' });
    now.setAttribute('aria-live', 'polite');
    const play = el('button', { type: 'button', className: 'ink-btn solid', textContent: 'Play' });
    play.addEventListener('click', () => post(last.playing ? 'pause' : 'start', last.settings));
    const next = el('button', { type: 'button', className: 'ink-btn', textContent: 'Next' });
    next.addEventListener('click', () => post('next'));
    const stop = el('button', { type: 'button', className: 'ink-btn', textContent: 'Stop' });
    stop.addEventListener('click', () => post('stop'));

    const select = (label, options, value, onChange) => {
      const s = el('select', { className: 'field', 'aria-label': label });
      for (const [v, t] of options) s.append(el('option', { value: String(v), textContent: t }));
      s.value = String(value);
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    const detents = (label, options, key) => {
      const g = el('div', { className: 'detents', role: 'group', 'aria-label': label });
      for (const [v, t] of options) {
        const b = el('button', { type: 'button', textContent: t, dataset: { v: String(v) } });
        b.addEventListener('click', () => set({ [key]: typeof v === 'number' ? v : String(v) }));
        g.append(b);
      }
      return g;
    };
    const keyPick = select('Key', [['', 'Any key'], ...ROOTS.map((r, i) => [i, r])], '', (v) => set({ lockRoot: v === '' ? null : Number(v) }));
    const focus = detents('Play', FOCUS, 'focus');
    const bpmMin = select('Slowest tempo', BPMS.map((b) => [b, `${b}`]), 60, (v) => set({ bpmMin: Number(v) }));
    const bpmMax = select('Fastest tempo', BPMS.map((b) => [b, `${b}`]), 120, (v) => set({ bpmMax: Number(v) }));
    const reps = Array.from({ length: 20 }, (_, i) => [i + 1, `${i + 1}`]);
    const repsMin = select('Fewest repeats', reps, 5, (v) => set({ repsMin: Number(v) }));
    const repsMax = select('Most repeats', reps, 10, (v) => set({ repsMax: Number(v) }));
    const drone = el('button', { type: 'button', className: 'sw' }, el('i'), el('span', { textContent: 'Drone' }));
    drone.addEventListener('click', () => set({ drone: !last.settings.drone }));
    const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Volume' });
    vol.addEventListener('input', () => { last.settings.volume = Number(vol.value); post('settings', { volume: last.settings.volume }); });
    const sleep = detents('Stop after', SLEEP, 'sleepMin');
    // note values: any mix of the five may come up, one per block; at least one stays on
    const vals = el('div', { className: 'detents', role: 'group', 'aria-label': 'Note values' });
    for (const [v, t] of VALUES) {
      const b = el('button', { type: 'button', textContent: t, dataset: { v: String(v) } });
      b.addEventListener('click', () => {
        const cur = new Set(last.settings.values || DEFAULTS.values);
        if (cur.has(v)) { if (cur.size > 1) cur.delete(v); } else cur.add(v);
        set({ values: VALUES.map(([x]) => x).filter((x) => cur.has(x)) });
      });
      vals.append(b);
    }
    // the voice range (Nate 2026-11-17): sing your lowest and highest note; blocks stay inside it until the app quits
    const rangeNow = el('p', { className: 'pl-range' });
    rangeNow.setAttribute('aria-live', 'polite');
    const rangeGo = el('button', { type: 'button', className: 'ink-btn' });
    rangeGo.addEventListener('click', () => post('range', null, null, range.step ? 'done' : 'start'));
    const rangeOff = el('button', { type: 'button', className: 'ink-btn' });
    rangeOff.addEventListener('click', () => post('range', null, null, range.step ? 'cancel' : 'clear'));
    const vizBox = el('div', { className: 'pl-viz-box' });
    const lbl = (t) => el('p', { className: 'note group-label', textContent: t });

    body.append(
      now,
      vizBox,
      el('div', { className: 'row' }, play, next, stop),
      lbl('Key'), keyPick,
      lbl('Play'), focus,
      lbl('Tempo (BPM)'), el('div', { className: 'row' }, bpmMin, el('span', { textContent: 'to' }), bpmMax),
      lbl('Note values'), vals,
      lbl('Voice range'), rangeNow, el('div', { className: 'row' }, rangeGo, rangeOff),
      lbl('Repeats'), el('div', { className: 'row' }, repsMin, el('span', { textContent: 'to' }), repsMax),
      el('div', { className: 'row mt-8' }, drone),
      lbl('Volume'), vol,
      lbl('Stop after'), sleep,
      el('p', { className: 'note', textContent: 'Keeps playing with the screen locked. Lock screen: play, pause, next.' }));

    function paint(st) {
      const s = { ...DEFAULTS, ...(st.settings || {}) };
      now.textContent = st.error ? st.error : st.active ? `${st.title || 'Starting…'}${st.playing ? '' : ' · paused'}` : 'Not playing';
      play.textContent = st.playing ? 'Pause' : 'Play';
      next.disabled = !st.active; stop.disabled = !st.active;
      keyPick.value = s.lockRoot == null ? '' : String(s.lockRoot);
      for (const b of focus.children) b.setAttribute('aria-pressed', String(b.dataset.v === s.focus));
      bpmMin.value = String(s.bpmMin); bpmMax.value = String(s.bpmMax);
      repsMin.value = String(s.repsMin); repsMax.value = String(s.repsMax);
      drone.classList.toggle('on', !!s.drone); drone.setAttribute('aria-pressed', String(!!s.drone));
      if (doc.activeElement !== vol) vol.value = String(s.volume);
      for (const b of sleep.children) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === Number(s.sleepMin)));
      for (const b of vals.children) b.setAttribute('aria-pressed', String((s.values || DEFAULTS.values).includes(Number(b.dataset.v))));
      paintRange();
      if (viz) viz.state(st);
    }
    function paintRange() {
      const r = range;
      const heard = [r.now && `Hearing ${r.now}`, r.best && `${r.step === 'low' ? 'lowest' : 'highest'} held ${r.best}`].filter(Boolean).join(' · ');
      rangeNow.textContent = r.step === 'low' ? `Sing your lowest note and hold it.${heard ? ` ${heard}` : ''}`
        : r.step === 'high' ? `Now your highest note, and hold it.${heard ? ` ${heard}` : ''}`
          : r.error ? r.error
            : r.label ? `${r.label}, for this session` : 'Any octave. Sing your lowest and highest notes to keep every block inside them.';
      rangeGo.textContent = r.step ? (r.best ? 'Got it' : 'Listening…') : (r.label ? 'Test again' : 'Test my range');
      rangeGo.disabled = !!r.step && !r.best;
      rangeOff.textContent = r.step ? 'Cancel' : 'Clear';
      rangeOff.hidden = !r.step && !r.label;
    }
    ui = { paint, paintRange };
    if (deps.viz) viz = deps.viz.mount(vizBox, { document: doc, watch: (on) => post('watch', null, on) });
    paint(last);
    post('state');
    return ui;
  }

  /** The shell's answer (cockpit.js onNative, type 'practice'). */
  function onNative(msg) {
    if (msg && msg.type === 'practiceClock') { if (viz) viz.clock(msg); return; }
    if (msg && msg.type === 'practiceRange') { range = { ...msg }; if (ui) ui.paintRange(); return; }
    if (!msg || msg.type !== 'practice') return;
    if (msg.error) { last = { ...last, active: false, playing: false, title: null }; if (ui) ui.paint({ ...last, error: msg.error }); return; }
    if (msg.range) range = { ...msg.range };
    last = { active: !!msg.active, playing: !!msg.playing, title: msg.title || null, settings: { ...DEFAULTS, ...(msg.settings || last.settings) } };
    if (ui) ui.paint(last);
  }

  const api = { ROOTS, BPMS, VALUES, DEFAULTS, allowed, mount, onNative };
  root.ApexPracticeLoop = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
