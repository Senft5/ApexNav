// Meets on the map (IDEAS S-13, docs/SOCIAL.md 2.11): the Meets layer pins the public crews' listed drives coming up
// near the map (GET /api/events/near, 80 km), each at its meeting point with the day on the pin ("Sat", "Today").
// A tap opens the same meet cards as Crew → Meets near you: when, the crew, how many going, Directions, Add to calendar,
// Join the crew. Off by default, members only. Asked by the 0.1-degree cell of the map's centre (VI-1), never from inside a
// privacy zone, at most once per cell every REFRESH_MS. No handles: the server sends none (backend/src/events.ts eventsNear).
// Pure helpers: pinText, pins (tests/test_meets_map.py).
(function (root) {
  'use strict';
  const REFRESH_MS = 5 * 60_000, MAX_PINS = 20;

  /** The pin's word: "Today", "Tmrw", else the weekday ("Sat"); '--' when the time is unknown. Calendar days on this phone. */
  function pinText(iso, now = new Date(), locale) {
    const t = new Date(iso);
    if (!Number.isFinite(t.getTime())) return '--';
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((day(t) - day(now)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tmrw';
    return t.toLocaleDateString(locale, { weekday: 'short' });
  }

  /** Rows of /api/events/near as pins: one per meeting point (meets within ~50 m share a pin), soonest first, each pin's
   *  meets soonest first, at most MAX_PINS. Rows without a finite point or start time are left out. */
  function pins(rows) {
    const ok = (Array.isArray(rows) ? rows : []).filter((r) => r && Number.isFinite(r.meet_lat) && Number.isFinite(r.meet_lon)
      && Number.isFinite(Date.parse(r.starts_at)));
    ok.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    const out = new Map();
    for (const r of ok) {
      const key = `${Math.round(r.meet_lat * 2000)},${Math.round(r.meet_lon * 2000)}`;   // ~50 m
      if (!out.has(key)) out.set(key, { lat: r.meet_lat, lon: r.meet_lon, meets: [] });
      out.get(key).meets.push(r);
    }
    return [...out.values()].slice(0, MAX_PINS);
  }

  const STYLE = `
    .mm-pin { display: grid; place-items: center; min-width: 44px; min-height: 44px; background: none; border: 0; padding: 0; cursor: pointer; }
    .mm-pin span { background: var(--panel); color: var(--panel-ink); border: 1.5px solid var(--panel-ink); padding: 2px 6px; font-weight: 700; font-size: 13px; line-height: 1.15; white-space: nowrap; }
    .mm-pin span small { font-weight: 400; color: var(--panel-dim); margin-left: 4px; }
  `;

  /**
   * page: { el, btn, apiCall, jsonOf, map, mapCentre() → {lat, lon}, mayLookUp(p), card(e) → a meet card (crew_events.js) }.
   * Returns { setLayer(on), refresh() }.
   */
  function mount(page) {
    const { el, btn, apiCall, map } = page, d = root.document, Z = root.ApexPrivacyZones;
    if (d && !d.getElementById('meetsMapStyle')) d.head.append(el('style', { id: 'meetsMapStyle', textContent: STYLE }));
    let on = false, lastCell = '', lastAt = 0, markers = [], gen = 0;

    const clear = () => { for (const m of markers) m.remove(); markers = []; };
    function sheet(pin) {
      const ov = el('div', { className: 'overlay show' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Meets here');
      const close = () => ov.remove();
      const body = el('div', { className: 'stack-8', style: 'max-width:560px' },
        el('h3', { textContent: pin.meets.length > 1 ? `${pin.meets.length} meets here` : 'Meet' }),
        ...pin.meets.map((e) => page.card(e, () => { close(); refresh(true); })),
        el('div', { className: 'row' }, btn('Close', close, 'linkbtn')));
      ov.append(body);
      ov.addEventListener('click', (ev) => { if (ev.target === ov) close(); });
      d.body.append(ov);
    }
    function draw(rows) {
      clear();
      for (const p of pins(rows)) {
        const first = p.meets[0], more = p.meets.length - 1;
        const label = el('span', { textContent: pinText(first.starts_at) });
        if (more > 0) label.append(el('small', { textContent: `+${more}` }));
        const b = el('button', { type: 'button', className: 'mm-pin' }, label);
        b.addEventListener('click', (ev) => { ev.stopPropagation(); sheet(p); });
        const m = new root.maplibregl.Marker({ element: b, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map);
        // the marker sets its own generic label: ours goes on after
        m.getElement().setAttribute('aria-label', `${first.title}, ${pinText(first.starts_at)}${more > 0 ? `, and ${more} more` : ''}. Open the meet.`);
        markers.push(m);
      }
    }
    async function refresh(force) {
      if (!on || !Z || !map) return;
      const at = page.mapCentre ? page.mapCentre() : null;
      if (!at || (page.mayLookUp && !page.mayLookUp(at))) { clear(); lastCell = ''; return; }
      const q = Z.cellQuery(at.lat, at.lon);
      if (!q || (!force && q === lastCell && Date.now() - lastAt < REFRESH_MS)) return;
      lastCell = q; lastAt = Date.now();
      const mine = ++gen;
      const rows = await apiCall('GET', `/api/events/near?${q}`).then(page.jsonOf).catch(() => null);
      if (mine !== gen || !on) return;
      if (Array.isArray(rows)) draw(rows);
      else lastCell = '';                                  // no signal: ask again on the next move
    }
    if (map && map.on) map.on('moveend', () => { refresh(false); });
    function setLayer(next) {
      on = !!next;
      gen++;
      if (on) refresh(true); else { clear(); lastCell = ''; }
    }
    return { setLayer, refresh };
  }

  const api = { pinText, pins, mount, REFRESH_MS, MAX_PINS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexMeetsMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
