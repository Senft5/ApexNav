// The crew page (docs/design/REVIEW.md roadmap 20, mockup docs/design/09-crew-page.html): the Crew tab opens your crew.
// Its face (a cover photo or the drawn hills, a stock crest, the motto, one stripe colour: the Plain livery), then what a
// clubhouse is for, in this order (docs/design/REVIEW_PEOPLE.md P-03): the run this week (its card in four states,
// crew_events.js, or the last one remembered), the members with who is out now, the chat, the Vetta Score board, and the
// livery as one line at the foot (its meter and stickers in Edit livery). Everything people typed is set as text.
// backend/src/crew_page.ts. The pure helpers (dateBlock, ago, goingFaces, stripeOk, outNow) are tested in
// tests/test_crew_page.py.
(function (root) {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  // The stock crests: drawn in a shield, one stroke colour (backend CRESTS lists the same ids).
  const CRESTS = {
    apex: ['M14 30 C20 30 22 18 34 16', 'circle:27,21,2.6'],
    peak: ['M10 32 L20 18 L25 24 L29 19 L38 32', 'M17 22 L20 18 L23 22'],
    tulip: ['circle:24,33,2.6', 'M24 31 V20', 'M24 20 L32 14', 'M28 13 L32 14 L31 18'],
    wheel: ['circle:24,23,9', 'circle:24,23,2', 'M24 14 V21', 'M16.5 27.5 L22.3 24', 'M31.5 27.5 L25.7 24'],
    wing: ['M12 20 C20 20 26 22 36 30', 'M14 25 C20 25 25 26 32 31', 'M16 30 C21 30 24 30 28 32'],
    crown: ['M13 30 L15 17 L20 24 L24 15 L28 24 L33 17 L35 30 Z', 'M13 33 H35'],
  };
  const CREST_NAMES = { apex: 'Apex', peak: 'Peak', tulip: 'Tulip', wheel: 'Wheel', wing: 'Wing', crown: 'Crown' };
  // Plain livery: one stripe colour from a short list that reads on paper and on ink.
  const STRIPES = ['#c8102e', '#d9661f', '#c9a227', '#2e7d4f', '#1f5fa8', '#6b3fa0', '#5a5a5a', '#111111'];
  const STRIPE_NAMES = ['Red', 'Orange', 'Gold', 'Green', 'Blue', 'Purple', 'Grey', 'Black'];
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /** The black date block of a drive: { day: '2', mon: 'NOV' } in the phone's time zone; '--' when the time is unknown. */
  function dateBlock(iso) {
    const t = new Date(iso);
    if (!Number.isFinite(t.getTime())) return { day: '--', mon: '' };
    return { day: String(t.getDate()), mon: MONTHS[t.getMonth()] };
  }
  /** A chat time: "now", "12 min", "3 h", "yesterday" up to 48 h, then "Oct 12" (P-35: no "Oct 29" beside "3 h" inside
   *  a day and a half). `at` is D1's UTC 'YYYY-MM-DD HH:MM:SS'. */
  function ago(at, now = Date.now()) {
    const t = Date.parse(String(at || '').replace(' ', 'T') + 'Z');
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, (now - t) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)} min`;
    if (s < 86400) return `${Math.floor(s / 3600)} h`;
    if (s < 172800) return 'yesterday';
    const d = new Date(t);
    return `${MONTHS[d.getMonth()].charAt(0)}${MONTHS[d.getMonth()].slice(1).toLowerCase()} ${d.getDate()}`;
  }
  /** Who's going, as at most three initials and a "+n". */
  function goingFaces(handles, max = 3) {
    const list = (handles || []).filter(Boolean);
    const faces = list.slice(0, max).map((h) => String(h).replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?');
    return { faces, more: Math.max(0, list.length - max), n: list.length };
  }
  const stripeOk = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
  /** The members strip (P-06): the owner first, then who is on the road now (`liveSet`, handles), then the rest by handle;
   *  and how many are out. */
  function outNow(members, liveSet) {
    const live = new Set(liveSet || []);
    const list = (members || []).filter((m) => m && m.handle).map((m) => ({ ...m, live: live.has(m.handle) && !m.mine }));
    list.sort((a, b) => (b.role === 'owner') - (a.role === 'owner') || b.live - a.live || String(a.handle).localeCompare(String(b.handle)));
    return { list, out: list.filter((m) => m.live).length };
  }
  /** The livery's one line on the page (P-03): "Club livery · 6 Decals"; nothing to count, where Decals come from. */
  function liveryShort(l) {
    const t = TIER_NAME[(l && l.tier) || 'plain'] || 'Plain';
    if (l && l.granted) return 'Factory livery · every option open (early access)';
    if (!l || !l.decals) return `${t} livery · Decals come from crew-mates with Vetta Pro`;
    return `${t} livery · ${l.decals} Decal${l.decals === 1 ? '' : 's'}`;
  }
  // Livery tiers (REVIEW.md 5.1; backend/src/livery.ts): what each unlocks on this page.
  const TIER_AT = { plain: 0, club: 5, works: 12, factory: 20 };
  const TIER_NAME = { plain: 'Plain', club: 'Club', works: 'Works', factory: 'Factory' };
  const PATTERNS = ['blocks', 'bands', 'chevron', 'checker', 'pinstripe'];
  const PATTERN_NAMES = { blocks: 'Blocks', bands: 'Bands', chevron: 'Chevron', checker: 'Checker', pinstripe: 'Pinstripe' };
  const atLeast = (have, need) => (TIER_AT[have] ?? 0) >= (TIER_AT[need] ?? 0);
  /** The livery line: "14 Decals from 5 supporters · Factory at 20"; Plain with none says where Decals come from. */
  function liveryLine(l) {
    if (!l || !l.decals) return 'Decals come from crew-mates with Vetta Pro.';
    const n = (l.supporters || []).length;
    const head = `${l.decals} Decal${l.decals === 1 ? '' : 's'} from ${n} supporter${n === 1 ? '' : 's'}`;
    return l.next ? `${head} \u00b7 ${TIER_NAME[l.next.tier]} at ${l.next.at}` : head;
  }
  /** The stripe band's CSS background for a pattern and up to three colours (ink fills the gaps). */
  function stripeCss(pattern, a, b, c, ink = 'var(--panel-ink)', k = 1) {
    const A = stripeOk(a) ? a : 'var(--accent)', B = stripeOk(b) ? b : ink, C = stripeOk(c) ? c : B;
    switch (pattern) {
      case 'bands': return `linear-gradient(180deg, ${A} 0 34%, ${B} 34% 67%, ${C} 67% 100%)`;
      case 'chevron': return `repeating-linear-gradient(135deg, ${A} 0 10px, ${B} 10px 16px, ${C} 16px 22px)`;
      case 'checker': return `repeating-conic-gradient(${A} 0 25%, ${B} 0 50%) 0 0 / 12px 12px`;
      case 'pinstripe': return `linear-gradient(180deg, ${B} 0 40%, ${A} 40% 60%, ${C} 60% 100%)`;
      default: return `repeating-linear-gradient(90deg, ${ink} 0 ${92 * k}px, ${A} ${92 * k}px ${124 * k}px, ${B === ink ? ink : B} ${124 * k}px ${136 * k}px, transparent ${136 * k}px ${148 * k}px)`;
    }
  }

  function crestSvg(id, px = 64) {
    const d = root.document, svg = d.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('width', px); svg.setAttribute('height', px);
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'cp-crest-svg');
    const add = (tag, attrs) => { const n = d.createElementNS(SVG, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
    add('path', { d: 'M24 5 L40 11 V24 C40 33 33 40 24 44 C15 40 8 33 8 24 V11 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linejoin': 'round' });
    for (const p of CRESTS[id] || CRESTS.apex) {
      if (p.startsWith('circle:')) {
        const [cx, cy, r] = p.slice(7).split(',');
        add('circle', { cx, cy, r, fill: r < 3 ? 'var(--cp-stripe, var(--accent))' : 'none', stroke: r < 3 ? 'none' : 'currentColor', 'stroke-width': 2.2 });
      } else add('path', { d: p, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    }
    return svg;
  }
  // The cover when there is no photo: hills and a road, drawn (never a stock photograph).
  function hills() {
    const d = root.document, svg = d.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 390 140'); svg.setAttribute('preserveAspectRatio', 'xMidYMid slice'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'cp-hills');
    const add = (tag, attrs) => { const n = d.createElementNS(SVG, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
    add('rect', { width: 390, height: 140, fill: 'var(--cp-sky)' });
    add('path', { d: 'M0 70 C60 40 120 60 180 45 S300 20 390 50 V140 H0 Z', fill: 'var(--cp-far)' });
    add('path', { d: 'M0 100 C80 70 150 95 230 80 S340 60 390 75 V140 H0 Z', fill: 'var(--cp-near)' });
    add('path', { d: 'M100 140 C160 120 200 115 250 104 S350 96 390 98', fill: 'none', stroke: 'var(--cp-road)', 'stroke-width': 9, 'stroke-linecap': 'round' });
    add('path', { d: 'M100 140 C160 120 200 115 250 104 S350 96 390 98', fill: 'none', stroke: 'var(--cp-far)', 'stroke-width': 1.2, 'stroke-dasharray': '6 6' });
    return svg;
  }

  const STYLE = `
    .crew-page { --cp-stripe: var(--accent); --cp-sky: #b9ad94; --cp-far: #8c826f; --cp-near: #6c6455; --cp-road: #efe6d4; margin: 0 -16px; }
    .cp-head { position: relative; height: 150px; overflow: hidden; background: var(--cp-near); }
    .cp-head > img, .cp-head > .cp-hills { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
    .cp-head .cp-edit { position: absolute; top: 10px; right: 12px; background: var(--panel); }
    .cp-stripe { height: 12px; background: repeating-linear-gradient(90deg, var(--panel-ink) 0 92px, var(--cp-stripe) 92px 124px, var(--panel-ink) 124px 136px, transparent 136px 148px); }
    .cp-crest { position: relative; width: 76px; height: 76px; margin: -58px 0 0 16px; background: var(--panel); color: var(--panel-ink);
      border: 2px solid var(--panel-ink); box-shadow: 0 3px 0 var(--panel-dim); display: grid; place-items: center; overflow: hidden; }
    .cp-crest img { width: 100%; height: 100%; object-fit: cover; }
    .cp-body { padding: 8px 16px 0; display: grid; gap: 14px; }
    .cp-title { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .cp-title h2 { margin: 0; font-size: 30px; line-height: 1.05; overflow-wrap: anywhere; }
    .cp-motto { font-style: italic; color: var(--panel-dim); margin: 2px 0 0; }
    .cp-meta { font-weight: 600; font-size: 13px; margin: 4px 0 0; }   /* fits one line at 361 pt */
    .cp-livery-line { margin: 0; }
    .cp-livery > .linkbtn { justify-self: start; color: var(--panel-dim); }   /* Take them off: left, in pencil */
    .cp-sec { display: flex; justify-content: space-between; align-items: baseline; }
    .crew-page .cp-sec h3 { margin: 0; font-size: 22px; border: 0; padding: 0; }
    .cp-sec { margin-top: 10px; }
    .cp-board-row { display: grid; grid-template-columns: 28px 1fr auto; align-items: baseline; gap: 8px; padding: 8px 0; border-top: 1px solid var(--rule); }
    .cp-board-row .rank { font-family: var(--font-num); color: var(--panel-dim); font-size: 18px; }
    .cp-board-row .who { min-width: 0; overflow-wrap: anywhere; } .cp-board-row .who small { color: var(--panel-dim); margin-left: 6px; }
    .cp-board-row .score { font-family: var(--font-num); font-size: 26px; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; }
    .cp-board-row.mine .who b { text-decoration: underline; text-decoration-thickness: 2px; }
    /* P-06: the members as faces, the owner marked, the ones on the road lit */
    .cp-members { display: flex; gap: 12px; overflow-x: auto; scrollbar-width: none; padding: 2px 0 4px; }
    .cp-members::-webkit-scrollbar { display: none; }
    .cp-member { position: relative; flex: none; width: 56px; display: grid; justify-items: center; align-content: start; gap: 8px; padding: 0; border: 0; background: none; color: var(--panel-ink); font: inherit; }
    .cp-member .avatar { position: relative; }
    .cp-member.live .avatar { box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--gain, #2a6); }
    .cp-member small { max-width: 56px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--panel-dim); }
    .cp-member em { position: absolute; top: 34px; left: 50%; transform: translateX(-50%); font-style: normal; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; border: 1.2px solid var(--panel-ink); padding: 0 3px; background: var(--panel); line-height: 1.3; }
    /* P-17: a message is its handle, time and words; what can be done with it is behind one key */
    .cp-msg .cp-dots { margin-left: auto; min-width: 44px; min-height: 32px; border: 0; background: none; color: var(--panel-dim); font: 700 18px var(--font-ui); letter-spacing: 0.1em; }
    /* P-03: the livery at the foot, one line */
    .cp-livery-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; border-top: 1px solid var(--rule); padding-top: 10px; }
    /* P-16: the crew switcher in the text face, one line that scrolls, the gear fixed beside it */
    .crew-head .cp-switch { flex: 1 1 auto; scrollbar-width: none; }
    .crew-head .cp-switch::-webkit-scrollbar { display: none; }
    .cp-switch.stamps > button { flex: none; font: 600 15px var(--font-ui); letter-spacing: 0; text-transform: none; white-space: nowrap; max-width: 14em; overflow: hidden; text-overflow: ellipsis; }
    .cp-msg { display: grid; grid-template-columns: 40px 1fr; gap: 10px; padding: 8px 0; border-top: 1px solid var(--rule); }
    .cp-msg p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .cp-msg .row { gap: 10px; align-items: baseline; }
    .cp-say { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; }
    .cp-say textarea { resize: none; }
    .cp-crests { display: flex; flex-wrap: wrap; gap: 8px; }
    .cp-crests button { width: 64px; height: 64px; display: grid; place-items: center; background: var(--panel); color: var(--panel-ink); border: 1.5px solid var(--rule); }
    .cp-crests button[aria-pressed="true"] { border: 2.5px solid var(--panel-ink); box-shadow: 0 2px 0 var(--panel-dim); }
    .cp-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
    .cp-swatches button { width: 40px; height: 40px; border: 2px solid var(--panel); outline: 1.5px solid var(--rule); }
    .cp-swatches button[aria-pressed="true"] { outline: 3px solid var(--panel-ink); }
    .cp-switch { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .cp-livery { border: 1.5px solid var(--panel-ink); padding: 12px 14px; display: grid; gap: 8px; }
    .cp-livery h3 { margin: 0; font-size: 22px; border: 0; padding: 0; }
    .cp-meter { position: relative; height: 12px; border: 1.5px solid var(--panel-ink); }
    .cp-meter i { position: absolute; inset: 0 auto 0 0; background: var(--panel-ink); }
    .cp-meter b { position: absolute; top: -5px; bottom: -5px; width: 1.5px; background: var(--panel-ink); }
    .cp-stickers { display: flex; flex-wrap: wrap; gap: 6px; }
    .cp-stickers span { width: 34px; height: 34px; border: 1.5px solid var(--panel-ink); display: grid; place-items: center; font-family: var(--font-num); font-size: 17px; font-weight: 800; color: #fff; }
    .cp-badge { display: inline-block; margin-left: 6px; padding: 0 6px; border: 1.5px solid var(--panel-ink); font-size: 13px; font-weight: 600; transform: rotate(-2deg); }
    .cp-pin { border-left: 3px solid var(--cp-stripe); padding: 4px 0 4px 10px; }
    .cp-pin .cp-badge { margin: 0 8px 0 0; }
    .cp-pin p { margin: 2px 0 0; overflow-wrap: anywhere; }
    .cp-factory { color: var(--accent); }
    .cp-factory .cp-crest-svg path, .cp-factory .cp-crest-svg circle { stroke-dasharray: 160; stroke-dashoffset: 160; animation: cp-draw 1.6s ease-out forwards; }
    @keyframes cp-draw { to { stroke-dashoffset: 0; } }
    @media (prefers-reduced-motion: reduce) { .cp-factory .cp-crest-svg path, .cp-factory .cp-crest-svg circle { animation: none; stroke-dashoffset: 0; } }
    .cp-pinned { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .cp-lock { display: inline-block; margin-left: 8px; padding: 1px 6px; border: 1.5px solid var(--panel-dim); color: var(--panel-dim); font-size: 13px; transform: rotate(-2deg); }
    .cp-livery-ed fieldset[disabled] { opacity: 0.5; }
    .cp-livery-ed fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 8px; }
    .cp-patterns { display: flex; flex-wrap: wrap; gap: 8px; }
    .cp-patterns button { width: 72px; height: 30px; border: 1.5px solid var(--rule); }
    .cp-patterns button[aria-pressed="true"] { outline: 3px solid var(--panel-ink); }
  `;

  function mount(page) {
    const { el, btn, toast, apiCall, jsonOf } = page;
    const P = () => root.ApexPhotos;
    if (!root.document.getElementById('crewPageStyle')) root.document.head.append(el('style', { id: 'crewPageStyle', textContent: STYLE }));

    async function load(id) {
      let r; try { r = await apiCall('GET', `/api/crews/${encodeURIComponent(id)}/page`); } catch (_) { return null; }
      return r && r.ok ? r.json() : null;
    }

    /** The page for one crew: an element that fills itself in. */
    function view(id) {
      const box = el('div', { className: 'crew-page' });
      const draw = async () => {
        const c = await load(id);
        if (!c || !c.id || !Array.isArray(c.board)) { box.replaceChildren(el('p', { className: 'note', style: 'padding:0 16px', textContent: 'Couldn’t load the crew. Check signal.' }), btn('Try again', draw, 'ink-btn')); return; }
        if (stripeOk(c.stripe)) box.style.setProperty('--cp-stripe', c.stripe);
        // Going and Share redraw only their own part, so a half-typed chat message stays put
        let driveSec = null, boardSec = null;
        const part = (make, get, set) => async () => { const c2 = await load(id); if (c2 && Array.isArray(c2.board)) { const n = make(c2); get().replaceWith(n); set(n); } };
        const redoDrive = part((c2) => thisWeek(c2, redoDrive), () => driveSec, (n) => { driveSec = n; });
        const redoBoard = part((c2) => board(c2, redoBoard), () => boardSec, (n) => { boardSec = n; });
        driveSec = thisWeek(c, redoDrive); boardSec = board(c, redoBoard);
        // P-03: the run, the people, what they said, then the board; the livery last, as one line
        box.replaceChildren(header(c, draw), el('div', { className: 'cp-body' }, titleBlock(c), driveSec, members(c), chat(c, draw), boardSec,
          ...(c.house ? [houseBoard(c)] : []), ...(c.pinned ? [pinnedRow(c)] : []), buildsRow(c), liveryFoot(c, draw)));
      };
      draw();
      return box;
    }

    function header(c, redo) {
      const head = el('div', { className: 'cp-head' });
      if (c.cover_photo_id && P()) { const i = P().img(c.cover_photo_id, '', `${c.name}'s cover`); head.append(hills(), i); } else head.append(hills());
      if (c.is_owner) head.append(btn('Edit livery', () => editLivery(c, redo), 'ink-btn cp-edit'));
      const crest = el('div', { className: 'cp-crest' });
      crest.append(c.crest_photo_id && P() ? P().img(c.crest_photo_id, '', `${c.name}'s crest`) : crestSvg(c.crest || 'apex'));
      if (atLeast(c.livery && c.livery.tier, 'factory')) crest.classList.add('cp-factory');   // Factory: the crest draws itself in the theme's accent
      const band = el('div', { className: 'cp-stripe' });
      band.style.background = stripeCss(c.pattern, c.stripe, c.stripe2, c.stripe3);
      return el('div', {}, head, band, crest);
    }

    function titleBlock(c) {
      const meta = [`${c.members} ${c.members === 1 ? 'member' : 'members'}`, c.visibility === 'public' ? 'Public' : 'Private', c.area_name].filter(Boolean).join(' · ');
      const left = el('div', { style: 'min-width:0' }, el('h2', { textContent: c.name }));
      if (c.motto) left.append(el('p', { className: 'cp-motto', textContent: c.motto }));
      left.append(el('p', { className: 'cp-meta', textContent: meta }));
      const right = el('div', { className: 'stack-8', style: 'align-items:flex-end' }, ...((c.can_invite ?? c.is_owner) && page.invite ? [btn('Invite', () => page.invite(c), 'ink-btn')] : []));   // P-07: any member, unless the owner keeps invites. No image-card Share (feedback 08): Invite shares the link
      return el('div', { className: 'cp-title' }, left, right);
    }

    // The livery at the foot of the page (P-03): one line. The people who care (the owner, a Pro supporter) open it: the
    // owner's Edit livery, or for a supporter the meter and their own Decals; for everyone else it is a line, not a key.
    function liveryFoot(c, redo) {
      const l = c.livery || { tier: 'plain', decals: 0, next: { tier: 'club', at: 5 }, supporters: [] };
      const line = el('p', { className: 'note cp-livery-line', textContent: liveryShort(l) });
      const foot = el('div', { className: 'cp-livery-foot' }, line);
      if (!c.is_owner && l.mine && l.mine.pro && !l.granted) foot.append(btn('Your Decals', () => liverySheet(c, redo), 'linkbtn'));
      return foot;
    }
    function liverySheet(c, redo) {
      const ov = el('div', { className: 'overlay dim show cp-livery-sheet' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', `${c.name}'s livery`);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      ov.append(el('div', { className: 'card-sheet' }, liveryBox(c, () => { close(); redo(); }), btn('Done', close, 'linkbtn')));
      root.document.body.append(ov);
    }
    // The livery (REVIEW.md 5.1, mockup 09): the tier, the Decals and the next threshold, supporters as tilted stickers. In
    // Edit livery and the supporter's sheet now (P-03), never above the run.
    function liveryBox(c, redo) {
      const l = c.livery || { tier: 'plain', decals: 0, next: { tier: 'club', at: 5 }, supporters: [] };
      // the whole livery granted by hand (livery_grants): no Decals to count, every option open
      if (l.granted) return el('p', { className: 'note', textContent: 'Factory livery · every option open (early access)' });
      // nothing to count yet: one pencil line, no box and no empty gauge (REVIEW2.md crew page)
      if (!l.decals && !(l.mine && l.mine.pro)) return el('p', { className: 'note', textContent: `${TIER_NAME[l.tier] || 'Plain'} livery · Decals come from crew-mates with Vetta Pro` });
      const box = el('div', { className: 'cp-livery' }, el('h3', { textContent: `${TIER_NAME[l.tier] || 'Plain'} livery` }),
        el('span', { className: 'note', textContent: liveryLine(l) }));
      const meter = el('div', { className: 'cp-meter', role: 'img' });
      meter.setAttribute('aria-label', `${l.decals} of 20 Decals`);
      const fill = el('i'); fill.style.width = `${Math.min(100, (l.decals / 20) * 100)}%`; meter.append(fill);
      for (const t of ['club', 'works']) { const tick = el('b'); tick.style.left = `${(TIER_AT[t] / 20) * 100}%`; meter.append(tick); }
      box.append(meter);
      if ((l.supporters || []).length) {
        const stickers = el('div', { className: 'cp-stickers' });
        l.supporters.forEach((s, i) => {
          // the supporter's initial, not a count: numbers on tilted squares read as dice (REVIEW2.md U-42)
          const tag = el('span', { textContent: (String(s.handle || '?').replace(/^@/, '')[0] || '?').toUpperCase(), title: `@${s.handle || '?'}` });
          tag.style.background = [c.stripe, c.stripe2, c.stripe3, '#111111'].filter(stripeOk)[i % 2] || 'var(--accent)';
          tag.style.transform = `rotate(${[-6, 4, -5, 7, -8][i % 5]}deg)`;
          tag.setAttribute('aria-label', `@${s.handle || '?'}: ${s.decals} Decal${s.decals === 1 ? '' : 's'}`);
          stickers.append(tag);
        });
        box.append(stickers);
      }
      const mine = l.mine;
      if (mine && mine.pro) {
        box.append(btn(mine.on ? `Your ${mine.decals} Decal${mine.decals === 1 ? ' is' : 's are'} on ${c.name}. Take them off` : `Put your Decals on ${c.name}`, async () => {
          const r = await apiCall('PUT', `/api/crews/${encodeURIComponent(c.id)}/decals`, { on: !mine.on }).catch(() => null);
          if (r && r.ok) redo(); else toast('Couldn\u2019t change that. Try again.');
        }, 'linkbtn'));
      }
      return box;
    }
    function pinnedRow(c) {
      return el('div', { className: 'cp-pinned' }, el('span', { className: 'note', textContent: 'Pinned route' }), el('b', { textContent: c.pinned.name }),
        page.openRoute ? btn('Open', () => page.openRoute(c.pinned.id), 'linkbtn') : '');
    }

    // This week (P-03, P-18): the run's card from crew_events.js, the same card as the Crew drives sheet; in the days after
    // a drive, the drive remembered (who came, the best Score) above the next one; no drive at all, a way to plan one.
    function thisWeek(c, redo) {
      const all = page.onAllDrives ? btn('All drives', page.onAllDrives, 'linkbtn') : '';
      const now = Date.now(), next = c.next || null, last = c.last ? { ...c.last, crew_id: c.id, crew_name: c.name } : null;
      const soon = next && Date.parse(next.starts_at) - now < 7 * 86400e3;
      const recent = last && now - Date.parse(last.starts_at) < 3 * 86400e3;
      const sec = el('div', { className: 'stack-8 cp-week' }, el('div', { className: 'cp-sec' }, el('h3', { textContent: next ? (soon ? 'This week' : 'Next drive') : last ? 'Last drive' : 'This week' }), all));
      const card = (e) => (page.driveCard && page.driveCard(e, { redo })) || el('b', { textContent: e.title });
      const CE = root.ApexCrewEvents, onDay = next && CE && CE.onTheDay(next, now);
      if (last && (!next || (recent && !onDay))) sec.append(card(last));
      if (next) sec.append(card(next));
      if (!next) {
        sec.append(el('div', { className: 'row', style: 'align-items:center;justify-content:space-between' },
          el('p', { className: 'note', textContent: last ? 'Nothing planned next.' : 'No drive planned.' }), page.onPlan ? btn(last ? 'Plan the next one' : 'Plan one', () => page.onPlan(c), 'ink-btn') : ''));
      }
      return sec;
    }

    // The members (P-06): faces, the owner marked, the ones on the road now lit (from what they share with you on the map:
    // friends_map.js friendState; nothing shared, no light); a tap is the person, with Report and Block one tap in.
    function members(c) {
      const strip = el('div', { className: 'cp-members', role: 'list' });
      const note = el('span', { className: 'note' });
      const sec = el('div', { className: 'stack-8' }, el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Members' }), note), strip);
      const get = (path) => apiCall('GET', path).then((r) => (r && r.ok ? r.json() : null)).catch(() => null);
      Promise.all([get(`/api/crews/${encodeURIComponent(c.id)}/members`), get('/api/presence')]).then(([list, where]) => {
        if (!Array.isArray(list) || !list.length) { strip.replaceChildren(el('p', { className: 'note', textContent: 'Couldn\u2019t load the members. Check signal.' })); return; }
        const FM = root.ApexFriendsMap, at = new Map((Array.isArray(where) ? where : []).map((p) => [p.handle, p]));
        const lit = [...at.keys()].filter((h) => FM && FM.friendState(at.get(h)).live);
        const m = outNow(list, lit);
        note.textContent = [`${m.list.length} ${m.list.length === 1 ? 'member' : 'members'}`, m.out ? `${m.out} out now` : ''].filter(Boolean).join(' \u00b7 ');
        strip.replaceChildren(...m.list.map((x) => {
          const b = el('button', { type: 'button', className: 'cp-member' + (x.live ? ' live' : ''), role: 'listitem' },
            P() ? P().avatar(x.photo_id || null, x.handle, 44) : el('b', { textContent: String(x.handle).charAt(0).toUpperCase() }),
            ...(x.role === 'owner' ? [el('em', { textContent: 'OWNER' })] : []), el('small', { textContent: x.mine ? 'You' : `@${x.handle}` }));
          b.setAttribute('aria-label', `@${x.handle}${x.mine ? ' (you)' : ''}${x.role === 'owner' ? ', owner' : ''}${x.live ? ', on the road now' : ''}`);
          b.addEventListener('click', () => member(c, x, x.live && FM ? FM.friendState(at.get(x.handle)).text : null));
          return b;
        }));
      });
      return sec;
    }
    // A member, one tap in: who they are in this crew, and Report and Block at the foot (P-06), never on the strip.
    function member(c, m, state) {
      const ov = el('div', { className: 'overlay dim show cp-member-sheet' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', `@${m.handle}`);
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
      const sub = [m.name, m.role === 'owner' ? `Runs ${c.name}` : `In ${c.name}`].filter(Boolean).join(' \u00b7 ');
      const foot = el('div', { className: 'row' }, btn('Done', close, 'linkbtn'));
      if (!m.mine && page.report) foot.append(btn('Report', () => { close(); page.report({ kind: 'user', target: m.handle, label: `@${m.handle} in ${c.name}`, who: m.handle }); }, 'linkbtn'));
      if (!m.mine && page.block) foot.append(btn('Block', () => { close(); page.block(m.handle); }, 'linkbtn'));
      ov.append(el('div', { className: 'card-sheet' },
        el('div', { className: 'row', style: 'align-items:center;gap:12px' }, P() ? P().avatar(m.photo_id || null, m.handle, 56) : '', el('h2', { textContent: `@${m.handle}` })),
        el('p', { className: 'note', textContent: sub }), ...(state ? [el('p', { textContent: state })] : []), foot));
      root.document.body.append(ov);
    }

    function board(c, redo) {
      const sec = el('div', { className: 'stack-8' }, el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Vetta Score board' }), el('span', { className: 'note', textContent: 'This month' })));
      const list = el('div');
      c.board.forEach((r, i) => {
        const who = el('span', { className: 'who' }, el('b', { textContent: `@${r.handle || '?'}` }));
        if (r.badge) who.append(el('span', { className: 'cp-badge', textContent: r.badge }));   // Works livery
        if (r.car) who.append(el('small', { textContent: r.car }));
        list.append(el('div', { className: 'cp-board-row' + (r.mine ? ' mine' : '') },
          el('span', { className: 'rank', textContent: r.score == null ? '' : String(i + 1) }), who,
          el('span', { className: 'score', textContent: r.score == null ? '--' : String(r.score) })));
      });
      sec.append(list, el('p', { className: 'note', textContent: 'Best Score this month, only from people who share Scores with the crew.' }));
      if (!c.sharing_scores) {
        sec.append(btn('Share my Scores with the crew', async () => {
          const r = await apiCall('PUT', '/api/grants', { audience_type: 'crew', audience_id: c.id, share_scores: true, share_times: false }).catch(() => null);
          if (r && r.ok) { toast(`${c.name} sees your Scores from your next drive on.`); redo(); } else toast('Couldn’t change that. Try again.');
        }, 'ink-btn'));
      }
      return sec;
    }

    // Builds (REVIEW.md 5.3): crew-mates' build threads you can see; nothing at all when there are none.
    function buildsRow(c) {
      const sec = el('div', { className: 'stack-8' }), B = page.builds && page.builds();
      if (!B) return sec;
      apiCall('GET', `/api/builds?crew=${encodeURIComponent(c.id)}`).then((r) => (r && r.ok ? r.json() : [])).catch(() => []).then((list) => {
        if (Array.isArray(list) && list.length) sec.replaceChildren(el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Builds' })), B.rows(list));
      });
      return sec;
    }

    // The house stage (Works livery): the stage the crew calls its own, best Score as published to the crew.
    function houseBoard(c) {
      const h = c.house, list = el('div');
      h.board.forEach((r, i) => list.append(el('div', { className: 'cp-board-row' }, el('span', { className: 'rank', textContent: String(i + 1) }),
        el('span', { className: 'who' }, el('b', { textContent: `@${r.handle || '?'}` })), el('span', { className: 'score', textContent: String(r.score) }))));
      if (!h.board.length) list.append(el('p', { className: 'note', textContent: 'Nobody has shared a Score on it yet.' }));
      return el('div', { className: 'stack-8' }, el('div', { className: 'cp-sec' }, el('h3', { textContent: 'House stage' }), el('span', { className: 'note', textContent: h.name })), list);
    }

    const plain = (s) => (root.ApexFormat && root.ApexFormat.noEmoji ? root.ApexFormat.noEmoji(s) : s);   // chat renders emoji as text: none (REVIEW.md "Not doing")
    function chat(c, redraw) {
      const list = el('div'); list.setAttribute('aria-live', 'polite');
      const club = atLeast(c.livery && c.livery.tier, 'club'), pinnedId = c.pinned_chat ? c.pinned_chat.id : null;
      const pin = (id) => async () => {
        const r = await apiCall('PUT', `/api/crews/${encodeURIComponent(c.id)}/page`, { pinned_chat_id: id }).catch(() => null);
        if (r && r.ok) redraw(); else toast('Couldn\u2019t change the pin. Try again.');
      };
      const pinned = c.pinned_chat ? el('div', { className: 'cp-pin' }, el('span', { className: 'cp-badge', textContent: 'Pinned' }),
        el('b', { textContent: `@${c.pinned_chat.handle || '?'}` }), el('p', { textContent: plain(c.pinned_chat.body) }), ...(c.is_owner ? [btn('Unpin', pin(null), 'linkbtn')] : [])) : '';
      const sec = el('div', { className: 'stack-8' }, el('div', { className: 'cp-sec' }, el('h3', { textContent: 'Chat' }), el('span', { className: 'note', textContent: 'Kept 30 days' })), pinned, list);
      const fill = async () => {
        const r = await apiCall('GET', `/api/crews/${encodeURIComponent(c.id)}/chat`).catch(() => null);
        const msgs = r && r.ok ? await r.json() : null;
        if (!msgs) { list.replaceChildren(el('p', { className: 'note', textContent: 'Couldn’t load the chat. Check signal.' })); return; }
        if (!msgs.length) { list.replaceChildren(el('p', { className: 'note', textContent: 'Nothing said yet.' })); return; }
        list.replaceChildren(...msgs.map((m) => {
          // P-17: Delete, Report and Pin behind one key on the message, chosen on the app's own sheet
          const acts = [];
          if (m.mine || c.is_owner) acts.push(['delete', 'Delete', true]);
          if (!m.mine && page.report) acts.push(['report', 'Report', false]);
          if (c.is_owner && club && m.id !== pinnedId) acts.push(['pin', 'Pin it', false]);   // Club livery
          const dots = acts.length ? el('button', { type: 'button', className: 'cp-dots', textContent: '\u2026' }) : null;
          if (dots) {
            dots.setAttribute('aria-label', `More for the message from @${m.handle || '?'}`);
            dots.addEventListener('click', async () => {
              const pickd = root.ApexConfirm && root.ApexConfirm.choose ? await root.ApexConfirm.choose(`@${m.handle || '?'}: \u201c${plain(m.body).slice(0, 60)}${m.body.length > 60 ? '\u2026' : ''}\u201d`, acts.map(([k, l, danger]) => ({ key: k, label: l, danger }))) : null;
              if (pickd === 'delete') {
                if (!(await ApexConfirm.ask('Delete this message?', 'Delete'))) return;
                const d = await apiCall('DELETE', `/api/crews/${encodeURIComponent(c.id)}/chat/${encodeURIComponent(m.id)}`).catch(() => null);
                if (d && d.ok) fill(); else toast('Couldn\u2019t delete it. Try again.');
              } else if (pickd === 'report') page.report({ kind: 'chat', target: m.id, label: `a message from @${m.handle} in ${c.name}`, who: m.handle, done: fill });
              else if (pickd === 'pin') pin(m.id)();
            });
          }
          return el('div', { className: 'cp-msg' }, P() ? P().avatar(m.photo_id, m.handle, 40) : el('span'),
            el('div', { style: 'min-width:0' }, el('div', { className: 'row' }, el('b', { textContent: `@${m.handle || '?'}` }), el('span', { className: 'note', textContent: ago(m.created_at) }), ...(dots ? [dots] : [])),
              el('p', { textContent: plain(m.body) })));
        }));
      };
      const input = el('textarea', { className: 'field', maxLength: 500, rows: 1, placeholder: `Say something to ${c.name}` });
      input.setAttribute('aria-label', `Message to ${c.name}`);
      const send = btn('Send', async () => {
        const text = input.value.trim();
        if (!text) return;
        send.disabled = true;
        const r = await apiCall('POST', `/api/crews/${encodeURIComponent(c.id)}/chat`, { body: text }).catch(() => null);
        send.disabled = false;
        if (r && r.ok) { input.value = ''; input.style.height = ''; fill(); }
        else toast(r && r.status === 429 ? 'That’s a lot of messages. Wait a while.' : 'Couldn’t send. Check signal.');
      }, 'ink-btn solid');
      sec.append(el('div', { className: 'cp-say' }, input, send));
      fill();
      return sec;
    }

    // The owner's livery editor, Plain tier: motto, crest, stripe colour, cover photo.
    function editLivery(c, redo) {
      const d = root.document, ov = el('div', { className: 'overlay show cp-livery-ed' });
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Edit livery');
      let crest = c.crest || 'apex', stripe = stripeOk(c.stripe) ? c.stripe.toLowerCase() : STRIPES[0];
      const motto = el('input', { className: 'field', maxLength: 80, value: c.motto || '', placeholder: 'A line under the name' });
      const crests = el('div', { className: 'cp-crests', role: 'group' }), swatches = el('div', { className: 'cp-swatches', role: 'group' });
      crests.setAttribute('aria-label', 'Crest'); swatches.setAttribute('aria-label', 'Stripe colour');
      const paint = () => {
        crests.replaceChildren(...Object.keys(CRESTS).map((id) => {
          const b = el('button', { type: 'button', onclick: () => { crest = id; paint(); } }, crestSvg(id, 44));
          b.setAttribute('aria-pressed', String(crest === id)); b.setAttribute('aria-label', CREST_NAMES[id]); return b;
        }));
        swatches.replaceChildren(...STRIPES.map((s) => {
          const b = el('button', { type: 'button', style: `background:${s}`, onclick: () => { stripe = s; paint(); } });
          b.setAttribute('aria-pressed', String(stripe === s)); b.setAttribute('aria-label', STRIPE_NAMES[STRIPES.indexOf(s)]); return b;
        }));
      };
      paint();
      const close = () => ov.remove();
      const save = btn('Save', async () => {
        const body = { motto: motto.value.trim() || null, crest, stripe };
        if (club) { body.stripe2 = stripe2; body.pinned_route_id = routeSel.value || null; }
        if (factory && regroupLine.value.trim() !== (c.regroup_line || '')) body.regroup_line = regroupLine.value.trim() || null;
        if (factory) body.hazard_kinds = hazardKinds.value.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 4);
        if (works) { body.stripe3 = stripe3; body.pattern = pattern; body.call_sign = callSign.value.trim() || null; body.house_canon_id = houseSel.value || null; }
        const r = await apiCall('PUT', `/api/crews/${encodeURIComponent(c.id)}/page`, body).catch(() => null);
        if (r && r.ok) { close(); redo(); } else toast('Couldn’t save the livery. Try again.');
      }, 'ink-btn solid');
      const cover = P() ? P().picker(c.cover_photo_id ? 'Change cover photo' : 'Add a cover photo', 'crew', c.id, () => { close(); redo(); }, { toast }) : '';
      const tier = (c.livery && c.livery.tier) || 'plain', club = atLeast(tier, 'club'), works = atLeast(tier, 'works');
      const lock = (t) => el('span', { className: 'cp-lock', textContent: `${TIER_NAME[t]} livery` });
      let stripe2 = c.stripe2 || null, stripe3 = c.stripe3 || null, pattern = c.pattern || 'blocks', pinned = c.pinned ? c.pinned.id : '';
      const sw2 = el('div', { className: 'cp-swatches', role: 'group' }), sw3 = el('div', { className: 'cp-swatches', role: 'group' }), pats = el('div', { className: 'cp-patterns', role: 'group' });
      sw2.setAttribute('aria-label', 'Second colour'); sw3.setAttribute('aria-label', 'Third colour'); pats.setAttribute('aria-label', 'Pattern');
      const paintMore = () => {
        const swatch = (cur, set, list) => list.map((s) => { const b = el('button', { type: 'button', style: `background:${s}`, onclick: () => { set(s); paintMore(); } });
          b.setAttribute('aria-pressed', String(cur === s)); b.setAttribute('aria-label', STRIPE_NAMES[STRIPES.indexOf(s)]); return b; });
        sw2.replaceChildren(...swatch(stripe2, (s) => { stripe2 = s; }, STRIPES));
        sw3.replaceChildren(...swatch(stripe3, (s) => { stripe3 = s; }, STRIPES));
        pats.replaceChildren(...PATTERNS.map((p) => { const b = el('button', { type: 'button', onclick: () => { pattern = p; paintMore(); } });
          b.style.background = stripeCss(p, stripe, stripe2, stripe3, undefined, 0.35); b.setAttribute('aria-pressed', String(pattern === p)); b.setAttribute('aria-label', PATTERN_NAMES[p]); return b; }));
      };
      paintMore();
      const routeSel = el('select', { className: 'field' });
      routeSel.setAttribute('aria-label', 'Pinned route');
      routeSel.append(el('option', { value: '', textContent: 'No pinned route' }), ...(c.routes || []).map((r) => el('option', { value: r.id, textContent: r.name, selected: r.id === pinned })));
      if (c.pinned && !(c.routes || []).some((r) => r.id === c.pinned.id)) routeSel.append(el('option', { value: c.pinned.id, textContent: c.pinned.name, selected: true }));
      const crestPick = P() ? P().picker(c.crest_photo_id ? 'Change crest photo' : 'Use a photo as the crest', 'crest', c.id, () => { close(); redo(); }, { toast }) : '';
      const clubSet = el('fieldset', { disabled: !club }, el('legend', {}, el('b', { textContent: 'Second colour' }), club ? '' : lock('club')), sw2,
        el('b', { textContent: 'Pinned route' }), routeSel, el('div', { className: 'row' }, crestPick));
      const callSign = el('input', { className: 'field', maxLength: 12, value: c.call_sign || '', placeholder: 'Convoy call sign, like RIDGE', autocomplete: 'off' });
      callSign.setAttribute('aria-label', 'Convoy call sign');
      const houseSel = el('select', { className: 'field' }, el('option', { value: '', textContent: 'No house stage' }),
        ...(c.stages || []).map((st) => el('option', { value: st.id, textContent: st.name, selected: c.house && c.house.id === st.id })));
      houseSel.setAttribute('aria-label', 'House stage');
      const badgeWho = el('select', { className: 'field' }, ...(c.board || []).map((r) => el('option', { value: r.handle || '', textContent: `@${r.handle}` })));
      const badgeText = el('input', { className: 'field', maxLength: 16, placeholder: 'Badge, like Sweep', autocomplete: 'off' });
      badgeWho.setAttribute('aria-label', 'Member'); badgeText.setAttribute('aria-label', 'Badge');
      const setBadge = btn('Set badge', async () => {
        const r = await apiCall('PUT', `/api/crews/${encodeURIComponent(c.id)}/badges`, { handle: badgeWho.value, badge: badgeText.value.trim() || null }).catch(() => null);
        if (r && r.ok) { badgeText.value = ''; toast('Badge set.'); } else toast('Couldn\u2019t set the badge.');
      }, 'ink-btn');
      const factory = atLeast(tier, 'factory');
      const hazardKinds = el('input', { className: 'field', maxLength: 90, value: (c.hazard_kinds || []).join(', '), placeholder: 'Up to four, like Cattle grid, Logging trucks', autocomplete: 'off' });
      hazardKinds.setAttribute('aria-label', 'Crew hazard categories');
      // the crew's regroup line in each pack's voice: rendered here on the website by the packs' own Kokoro voices, then uploaded
      const regroupLine = el('input', { className: 'field', maxLength: 60, value: c.regroup_line || '', placeholder: `${c.name}, regroup.`, autocomplete: 'off' });
      regroupLine.setAttribute('aria-label', 'Crew regroup line');
      const V = root.ApexVoice, canRender = !!(V && V.canRenderLine && V.canRenderLine());
      const voiceNote = el('p', { className: 'note', textContent: (c.voice_packs || []).length ? `Recorded in ${(c.voice_packs || []).length} of 3 voices.` : 'Not recorded yet.' });
      const renderVoices = btn('Record it in the three voices', async () => {
        const line = regroupLine.value.trim(); if (!line) { toast('Write the line first.'); return; }
        const s1 = await apiCall('PUT', `/api/crews/${encodeURIComponent(c.id)}/page`, { regroup_line: line }).catch(() => null);
        if (!s1 || !s1.ok) { toast('Couldn\u2019t save the line.'); return; }
        let done = 0;
        for (const pack of ['marguerite', 'kit', 'hale']) {
          voiceNote.textContent = `Recording in ${pack[0].toUpperCase() + pack.slice(1)}\u2019s voice\u2026 (the voice model loads once, about 90 MB)`;
          const m = await fetch(`voices/${pack}/manifest.json`).then((r) => r.json()).catch(() => null);
          const out = m && m.kokoro_voice ? await V.renderLine(line, m.kokoro_voice, m.speed || 1) : null;
          if (!out) continue;
          const r = await root.ApexSync.apiFetch(`/api/crews/${encodeURIComponent(c.id)}/voice/${pack}`, { method: 'PUT', headers: { 'content-type': 'audio/wav' }, body: root.ApexCrewVoice.wav(out.audio, out.sampling_rate) }).catch(() => null);
          if (r && r.ok) done++;
        }
        voiceNote.textContent = done === 3 ? 'Recorded in all three voices.' : `Recorded in ${done} of 3 voices. Try again for the rest.`;
      }, 'ink-btn');
      renderVoices.disabled = !canRender;
      const factorySet = el('fieldset', { disabled: !factory }, el('legend', {}, el('b', { textContent: 'Crew hazard categories' }), factory ? '' : lock('factory')), hazardKinds,
        el('p', { className: 'note', textContent: 'Members report them from the report sheet and read your word on the plate; other drivers see Debris.' }),
        el('b', { textContent: 'Crew regroup line' }), regroupLine,
        el('div', { className: 'row' }, renderVoices),
        el('p', { className: 'note', textContent: canRender ? 'Members hear it in their co-driver\u2019s voice when your convoy regroups.' : 'Record it on the Vetta website: the voices are made there, the app only plays them.' }), voiceNote);
      const worksSet = el('fieldset', { disabled: !works }, el('legend', {}, el('b', { textContent: 'Third colour and pattern' }), works ? '' : lock('works')), sw3, pats,
        el('b', { textContent: 'Convoy call sign' }), callSign, el('b', { textContent: 'House stage' }), houseSel,
        el('b', { textContent: 'Member badges' }), el('div', { className: 'row' }, badgeWho, badgeText, setBadge));
      ov.append(el('div', { className: 'stack-8', style: 'max-width:520px' },
        el('h2', { textContent: `${TIER_NAME[tier]} livery` }),
        liveryBox(c, () => { close(); redo(); }),                       // P-03: the meter and the stickers live here now
        el('label', { className: 'stack-8' }, el('b', { textContent: 'Motto' }), motto),
        el('b', { textContent: 'Crest' }), crests,
        el('b', { textContent: 'Stripe' }), swatches,
        el('b', { textContent: 'Cover' }), el('div', { className: 'row' }, cover),
        el('p', { className: 'note', textContent: 'Photos lose their location data before they leave your phone.' }),
        clubSet, worksSet, factorySet,
        el('p', { className: 'note', textContent: club ? liveryLine(c.livery) : `Club at 5 Decals, Works at 12. ${liveryLine(c.livery)}` }),
        el('div', { className: 'row' }, save, btn('Cancel', close, 'linkbtn'))));
      d.body.append(ov);
      if (root.ApexRowSelect) for (const s of [routeSel, houseSel, badgeWho]) root.ApexRowSelect.enhance(s);   // the app's row lists, now that they are on the sheet
      motto.focus();
    }

    /** Several crews: a row of their names to switch between; `pick(id)` opens one. */
    function switcher(crews, current, pick) {
      const row = el('div', { className: 'cp-switch stamps', role: 'group' });
      row.setAttribute('aria-label', 'Your crews');
      for (const c of crews) {
        const b = btn(c.name, () => pick(c.id), 'chip');
        b.setAttribute('aria-pressed', String(c.id === current));
        if (c.id === current) b.classList.add('on');
        row.append(b);
      }
      return row;
    }

    return { view, switcher };
  }

  const api = { mount, dateBlock, ago, goingFaces, stripeOk, outNow, liveryShort, crestSvg, liveryLine, stripeCss, atLeast, CRESTS: Object.keys(CRESTS), STRIPES, PATTERNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ApexCrewPage = api;
})(typeof window !== 'undefined' ? window : globalThis);
